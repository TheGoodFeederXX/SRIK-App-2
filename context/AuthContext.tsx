import React, { createContext, useContext, useEffect, useState } from 'react';
import { DashboardType, School } from '../types';
import { DEMO_SCHOOL_ID, DEMO_BRANCH_ID } from '../lib/mockAuth';
// Session restore / login run before first paint, so this path deliberately
// imports only the lean eager module plus the shared core client — importing
// the full `api` here put all ~600 of its domain methods on the initial
// bundle, none of which this file calls.
import * as api from '../lib/api/eager';
import { apiCore } from '../lib/api/core';
import { queryClient, idbPersister } from '../lib/react-query';
import { offlineStorage } from '../lib/offlineStorage';
import { onAuthStateChange, fetchIdentity, signOut as supabaseSignOut } from '../src/lib/supabase/auth';
import { sendPasswordReset as supabaseSendPasswordReset } from '../src/lib/supabase/auth';
import { isSupabaseConfigured } from '../src/lib/supabase/client';

interface AuthContextType {
    session: any | null;
    user: any | null;
    role: DashboardType | null;
    currentSchool: School | null;
    currentBranchId: string | null;
    loading: boolean;
    isDemo: boolean;
    memberships: any[];
    signIn: (dashboard: DashboardType, user: any) => Promise<void>;
    signOut: () => Promise<void>;
    switchSchool: (schoolId: string) => Promise<void>;
    switchDemoRole: (roleKey: string) => Promise<void>;
    userProfile: any | null;
    refreshUser: () => Promise<void>;
    refreshCurrentSchool: () => Promise<void>;
    isAuthenticated: boolean;
    /**
     * True when the signed-in user has not yet replaced the temporary password
     * an administrator set for them. The credential is known to a second person
     * until they do, so the app must require a change before real use.
     */
    mustChangePassword: boolean;
    switchDashboardRole: (role: DashboardType) => void;
    forgotPassword: (email: string) => Promise<any>;
    resetPassword: (data: any) => Promise<any>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<any | null>(null);
    const [session, setSession] = useState<any | null>(null);
    const [role, setRole] = useState<DashboardType | null>(null);
    const [currentSchool, setCurrentSchool] = useState<School | null>(null);
    const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // Defaults to false: an account is only "temporary password" when the
    // database says so, never by omission.
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [memberships, setMemberships] = useState<any[]>([]);
    const [isDemo, setIsDemo] = useState(() => sessionStorage.getItem('is_demo_mode') === 'true');

    // Guards against a stale demo-login/sign-out race: if the user fires off a
    // second "Try Demo" tile click (or navigates away) before the first
    // switchDemoRole() request resolves, the first request's late response
    // must not be allowed to clobber whatever session is active by the time
    // it comes back. Bump on every login/sign-out attempt; a resolved
    // request only commits its result if it's still the most recent one.
    const authActionSeqRef = React.useRef(0);

    /**
     * Map a role code onto a dashboard.
     *
     * THE FALLBACK IS THE IMPORTANT PART. It used to be `DashboardType.Admin`,
     * so ANY role this function did not recognise opened the administration
     * dashboard — the one with the most power. The database's real parent role is
     * `GUARDIAN`, which was not listed, so a guardian fell through to Admin.
     *
     * `GUARDIAN` and `PARENT` are both accepted because the database says one and
     * the UI is built around the other; a mismatch between them is exactly how the
     * admin fallback was reachable.
     */
    const getDashboardTypeFromUserType = (userType: string): DashboardType => {
        const normalized = (userType || '').toUpperCase().replace(/[\s_]/g, '');
        if (normalized === 'ADMIN') return DashboardType.Admin;
        if (normalized === 'TEACHER') return DashboardType.Teacher;
        if (normalized === 'GUARDIAN' || normalized === 'PARENT') return DashboardType.Guardian;
        if (normalized === 'STUDENT') return DashboardType.Student;
        // Least privilege, not most: an unrecognised role gets the smallest
        // dashboard rather than the administration one.
        return DashboardType.Student;
    };

    const signOut = async () => {
        // Invalidate any in-flight login/demo-switch so a late response can't
        // resurrect a session right after the user signed out.
        authActionSeqRef.current += 1;
        // Tab-scoped tokens — only this tab's session is cleared.
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_refresh_token');
        sessionStorage.removeItem('is_demo_mode');
        sessionStorage.removeItem('school');
        sessionStorage.removeItem('demo_school_id');
        sessionStorage.removeItem('active_dashboard_role');
        // Per-role navigation memory: the highlighted bottom tab and remembered
        // screen data. Left behind, the next sign-in opened on Home with the
        // previous tab (e.g. Settings) still highlighted.
        for (const k of Object.keys(sessionStorage)) {
            if (k.endsWith('_activeBottomNav') || k.startsWith('nav_props:')) sessionStorage.removeItem(k);
        }
        // Defensive: clear any legacy localStorage tokens left behind.
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_refresh_token');
        localStorage.removeItem('last_school_id');
        sessionStorage.removeItem('cached_user_profile');
        localStorage.removeItem('selected_branch_id');
        // Defense in depth: drop the in-memory + roster_cache reads so a
        // shared device's next sign-in can't observe this tab's cached
        // responses (queued offline writes are separately isolated by
        // per-action user_scope in syncEngine.ts).
        apiCore.invalidateCache();

        // queryClient.clear() below only empties the IN-MEMORY cache. It is
        // also persisted to IndexedDB (index.tsx's PersistQueryClientProvider
        // + idbPersister), which survives a plain clear() untouched — on a
        // shared device, the NEXT sign-in's restoreClient() would rehydrate
        // this account's cached queries, up to the 24h gcTime, until each one
        // happened to be re-fetched. BranchContext's school-switch flow
        // already does this correctly (removeClient + offlineStorage.clearAll
        // alongside queryClient.clear()); signOut needs the exact same
        // cleanup, not a lighter version of it.
        try { await idbPersister.removeClient(); } catch { /* noop */ }
        try { await offlineStorage.clearAll(); } catch { /* noop */ }

        React.startTransition(() => {
            setUser(null);
            setRole(null);
            setSession(null);
            setCurrentSchool(null);
            setCurrentBranchId(null);
            setIsDemo(false);
            setMemberships([]);
            setLoading(false);
            // Clear React Query cache to prevent data leakage between users
            queryClient.clear();
        });

        // Clear everything - App.tsx will automatically show Login/Signup because user/role is null
        // No more window.location.href = '/login' to avoid full page reloads
    };

    const initializeAuth = async () => {
        // Read tab-scoped token. No app code path writes auth tokens to localStorage
        // anymore (signIn writes sessionStorage only),
        // so any leftover localStorage.auth_token is stale/foreign — e.g. from a script,
        // an old browser tab predating the sessionStorage migration, or another tool.
        // Previously this was silently adopted into the current tab's session ("one-time
        // migration"), which meant a stale foreign token could hijack an active session on
        // any remount. Purge it defensively instead of trusting it.
        const token = sessionStorage.getItem('auth_token');
        if (!token) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_refresh_token');
        }

        if (!token) {
            sessionStorage.removeItem('cached_user_profile');
            React.startTransition(() => {
                setUser(null);
                setRole(null);
                setLoading(false);
            });
            return;
        }

        // 0. Quick check for cached user to speed up initial render
        const cachedUser = sessionStorage.getItem('cached_user_profile');
        if (cachedUser) {
            try {
                const userData = JSON.parse(cachedUser);
                
                // STALENESS PROTECTION: If the cached data has a mock name but we are not in 
                // demo mode (or vice-versa), do not load it optimistically.
                const isCachedDemo = !!(userData.is_demo || userData.isDemo);
                const currentIsDemo = sessionStorage.getItem('is_demo_mode') === 'true';
                const hasMockName = userData.school?.name === 'Global Demo School';

                if (isCachedDemo === currentIsDemo && (!hasMockName || currentIsDemo)) {
                    React.startTransition(() => {
                        setUser(userData);
                        setIsDemo(currentIsDemo);
                        setSession({ access_token: token, user: userData });
                        setLoading(false);

                        // Priority: Session (tab-specific) > Default role. In demo mode the
                        // visitor's underlying account role (usually ADMIN — the demo
                        // school owner) is never the right fallback: it would silently
                        // show an Admin dashboard to someone who picked Student/Teacher/
                        // Parent, if the tab-scoped role marker is ever lost (e.g. the
                        // lazy-chunk-retry reload path). Only fall back to the account's
                        // real role for non-demo accounts, where it's actually correct.
                        const savedRole = sessionStorage.getItem('active_dashboard_role') as DashboardType;
                        if (savedRole) {
                            setRole(savedRole);
                        } else if (!currentIsDemo) {
                            setRole(getDashboardTypeFromUserType(userData.role));
                        } else {
                            setRole(null);
                        }

                        if (userData.school) {
                            setCurrentSchool(userData.school);
                            setCurrentBranchId(userData.branch_id || userData.school.branch_id);
                        }
                    });
                    console.log("⚡ [Auth] Optimistic load from cache...");
                } else {
                    console.log("⚠️ [Auth] Cache ignored (potential mock/stale data detected)");
                    sessionStorage.removeItem('cached_user_profile');
                }
            } catch (e) {
                console.warn("Failed to parse cached user");
            }
        }

        if (!token) {
            React.startTransition(() => {
                setLoading(false);
            });
            return;
        }

        try {
            // 2. Fetch current user from custom backend
            const userData = await api.getMe();

            if (userData) {
                // Normalize ID
                if (!userData.id && userData.userId) {
                    userData.id = userData.userId;
                }

                // Apply the account's saved UI language so it follows the user to a new
                // device. A live local choice (already in localStorage) is respected.
                if (userData.preferred_language && !localStorage.getItem('app_language')) {
                    import('../lib/i18n').then((m) => m.setAppLanguage(userData.preferred_language)).catch(() => {});
                }

                // Cache for next time (tab-scoped — must never leak across browser tabs)
                sessionStorage.setItem('cached_user_profile', JSON.stringify(userData));

                React.startTransition(() => {
                    setUser(userData);

                    const isDemoAccount = !!(userData.is_demo || userData.isDemo || (userData.id && String(userData.id).startsWith('d3300')));

                    // Priority: Session (tab-specific) > Default role. Same demo-safety
                    // rule as the optimistic-cache path above: a demo visitor whose
                    // tab-scoped role marker was lost must never be silently shown the
                    // underlying demo account's real role (usually ADMIN) — force back
                    // to the role picker instead.
                    const savedRole = sessionStorage.getItem('active_dashboard_role') as DashboardType;
                    const dashboardRole = savedRole || (isDemoAccount ? null : getDashboardTypeFromUserType(userData.role));
                    setRole(dashboardRole);
                    if (savedRole) {
                        sessionStorage.setItem('active_dashboard_role', savedRole);
                    }

                    if (userData.school) {
                        setCurrentSchool(userData.school);
                        setCurrentBranchId(userData.branch_id || userData.school.branch_id);
                    }

                    setIsDemo(isDemoAccount);

                    if (isDemoAccount) {
                        sessionStorage.setItem('is_demo_mode', 'true');
                    } else {
                        sessionStorage.removeItem('is_demo_mode');
                    }

                    fetchMemberships(userData.id);
                    setSession({ access_token: token, user: userData });
                    setLoading(false);
                });
            } else {
                signOut();
            }
        } catch (err: any) {
            const isAuthError = err.message?.includes('401') ||
                err.message?.includes('No token provided') ||
                err.message?.includes('Invalid credentials');

            if (!isAuthError) {
                console.error("Auth initialization failed:", err);
            }

            signOut();
        } finally {
            React.startTransition(() => {
                setLoading(false);
            });
        }
    };

    const fetchMemberships = async (userId: string | null | undefined) => {
        if (!userId) return;

        const userIdStr = String(userId);
        // Skip for demo accounts to avoid 404s
        if (userIdStr.startsWith('d3300') || sessionStorage.getItem('is_demo_mode') === 'true') {
            setMemberships([{
                school_id: DEMO_SCHOOL_ID,
                role: role || 'admin',
                is_active: true,
                school: { name: 'Demo School', id: DEMO_SCHOOL_ID }
            }]);
            return;
        }

        try {
            const { api } = await import('../lib/api');
            const data = await api.getMemberships(userIdStr);
            setMemberships(data || []);
        } catch (err) {
            console.error("Error fetching memberships:", err);
        }
    };

    useEffect(() => {
        initializeAuth();
    }, []);

    // Supabase session bridge.
    //
    // This runs ALONGSIDE the legacy restore path above rather than replacing
    // it. During cutover both auth sources must be able to establish a session,
    // and neither may be removed until the other provably covers every case —
    // the rule from CLAUDE.md ("never leave two auth sources") applies to the
    // END state, and this bridge exists precisely so the legacy path can be
    // deleted once Supabase sign-in is the only way in.
    //
    // A session signed in through Supabase is translated into the same context
    // shape the rest of the app already consumes, so none of the 200+ consumers
    // of useAuth() need to know which source produced it.
    useEffect(() => {
        if (!isSupabaseConfigured) return;

        let cancelled = false;

        const applySupabaseSession = async (nextSession: any) => {
            if (cancelled) return;

            if (!nextSession?.user) {
                // A Supabase sign-out must clear app state. Without this the UI
                // would keep showing a signed-in shell after the session ends.
                await signOut();
                return;
            }

            const identity = await fetchIdentity(nextSession.user.id);
            if (cancelled) return;

            if (!identity.success || !identity.data) {
                // The account exists in Supabase Auth but has no usable profile
                // (or is not ACTIVE). Treat it as signed out rather than
                // rendering a half-authenticated app.
                await signOut();
                return;
            }

            const data = identity.data;
            // A GUARDIAN must reach the guardian dashboard. This used to be
            // "ADMIN, else TEACHER", so a parent — whose real role code is
            // GUARDIAN — was given the TEACHER dashboard, complete with its
            // navigation and screens. Checked in privilege order, and an
            // unrecognised role falls to the smallest dashboard rather than a
            // larger one.
            const dashboard: DashboardType = data.roles.includes('ADMIN')
                ? DashboardType.Admin
                : data.roles.includes('TEACHER')
                    ? DashboardType.Teacher
                    : data.roles.includes('GUARDIAN')
                        ? DashboardType.Guardian
                        : DashboardType.Student;

            const userRecord = {
                id: data.id,
                email: nextSession.user.email,
                fullName: data.fullName,
                displayName: data.displayName,
                phone: data.phone,
                avatarStorageKey: data.avatarStorageKey,
                status: data.status,
                roles: data.roles,
                permissions: data.permissions,
                userType: dashboard,
            };

            React.startTransition(() => {
                setSession(nextSession);
                setUser(userRecord);
                setRole(dashboard);
                setMustChangePassword(data.mustChangePassword);
                setLoading(false);
            });
        };

        const unsubscribe = onAuthStateChange((event, session) => {
            // Token refresh events carry no new identity, so re-applying them
            // would cause needless profile reads on every periodic refresh.
            if (event === 'TOKEN_REFRESHED') return;
            void applySupabaseSession(session);
        });

        // A session may already exist on load (restored from storage), which no
        // event announces. Check once explicitly.
        void (async () => {
            const { getSession } = await import('../src/lib/supabase/auth');
            const existing = await getSession();
            if (existing) void applySupabaseSession(existing);
        })();

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [signOut]);

    useEffect(() => {
        const handleForceLogout = () => {
            signOut();
        };

        window.addEventListener('force-logout', handleForceLogout);
        return () => window.removeEventListener('force-logout', handleForceLogout);
    }, [signOut]);

    const signIn = async (dashboard: DashboardType, userData: any) => {
        // Clear any old state or demo remnants first. A visitor commonly tries the
        // demo (or another school) in this SAME tab, then uses "Create Your School"
        // and logs in as the new admin without ever going through signOut() — without
        // this, cached API responses (dashboard stats, school info, roster data) from
        // that prior session/school would still be sitting in the in-memory + offline
        // caches and could render under the new school's admin until each entry
        // happened to be naturally refetched.
        apiCore.invalidateCache();
        sessionStorage.removeItem('cached_user_profile');
        sessionStorage.removeItem('is_demo_mode');

        if (userData.token) {
            sessionStorage.setItem('auth_token', userData.token);
        }
        if (userData.refreshToken) {
            sessionStorage.setItem('auth_refresh_token', userData.refreshToken);
        }

        // Resiliently extract user object and demo status
        let userObj = userData.user || { ...userData };

        // Normalize ID (ensure .id exists if .userId was provided)
        if (!userObj.id && userObj.userId) {
            userObj.id = userObj.userId;
        }

        const isDemoAccount = !!(userObj.is_demo || userData.isDemo || userObj.isDemo || (userObj.id && String(userObj.id).startsWith('d3300')));

        React.startTransition(() => {
            setUser(userObj);
            setRole(dashboard);
            sessionStorage.setItem('active_dashboard_role', dashboard);
            setIsDemo(isDemoAccount);

            if (isDemoAccount) {
                sessionStorage.setItem('is_demo_mode', 'true');
                if (userData.school?.id) {
                    sessionStorage.setItem('demo_school_id', userData.school.id);
                }
            } else {
                sessionStorage.removeItem('is_demo_mode');
                sessionStorage.removeItem('demo_school_id');
            }

            if (userData.school) {
                setCurrentSchool(userData.school);
                setCurrentBranchId(userData.branch_id || userData.school?.branch_id);
                // Also update userObj with school info for caching
                userObj.school = userData.school;
            }

            // Cache the enriched user profile for instant reload (tab-scoped — must never leak across browser tabs)
            sessionStorage.setItem('cached_user_profile', JSON.stringify(userObj));

            setSession({ access_token: userData.token, user: userObj });
            setLoading(false);
        });

        // Defer memberships fetching to background - don't block UI
        const userId = userObj.id || userObj.userId;
        if (userId) {
            // Use setTimeout to defer this to next tick
            setTimeout(() => {
                fetchMemberships(userId);
            }, 100);
        }
    };

    const switchSchool = async (schoolId: string) => {
        setLoading(true);
        try {
            const { api } = await import('../lib/api');
            const result = await api.switchSchool(user.id, schoolId);

            if (result.token) {
                sessionStorage.setItem('auth_token', result.token);
                // Same account, different tenant — cached API responses (dashboard
                // stats, rosters, school info) from the OUTGOING school must not
                // survive into the new one. Without this, a user who owns multiple
                // schools could see the previous school's data until each cache
                // entry happened to be naturally refetched.
                apiCore.invalidateCache();
                sessionStorage.removeItem('cached_user_profile');
                // No more window.location.reload(); to avoid full page reloads
                // Instead, we'll refresh the user profile to get the new school context
                await initializeAuth();
            }
        } catch (err) {
            console.error("Error switching school:", err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const switchDemoRole = async (roleKey: string) => {
        // Capture this request's sequence number. If another switchDemoRole /
        // signOut fires before this one's network round-trip completes (e.g. a
        // double click, or clicking a different demo tile before the first
        // finishes, or navigating away and back), that call bumps the ref and
        // this stale response is discarded below instead of overwriting the
        // session that's actually active by the time it resolves.
        const seq = ++authActionSeqRef.current;
        setLoading(true);
        try {
            // Instant Backend fetch - bypassing cached mock logic
            const { token, refreshToken, user: userData } = await api.demoLogin(roleKey);

            if (seq !== authActionSeqRef.current) {
                console.warn(`[Auth] Discarding stale demo login response for role "${roleKey}" — a newer auth action has since started.`);
                return;
            }

            if (token && userData) {
                // Determine dashboard type based on true DB role
                let dashType = DashboardType.Admin;
                const userRole = (userData.role || '').toLowerCase();

                if (userRole === 'teacher') dashType = DashboardType.Teacher;
                else if (userRole === 'student') dashType = DashboardType.Student;
                else if (userRole === 'parent' || userRole === 'guardian') dashType = DashboardType.Guardian;

                // invalidateCache() (not clearCache()) — clears the in-memory
                // response cache AND the persistent offlineDB.roster_cache, so
                // no reads cached under the outgoing role can leak into the
                // incoming one. (Queued offline writes in sync_queue are
                // separately protected by per-action user_scope stamping in
                // syncEngine.ts, so they don't need clearing here.)
                apiCore.invalidateCache();
                sessionStorage.removeItem('cached_user_profile');
                sessionStorage.removeItem('demo_role_token');

                // Explicitly set the token first to ensure any immediate API calls have it
                sessionStorage.setItem('auth_token', token);
                if (refreshToken) sessionStorage.setItem('auth_refresh_token', refreshToken);
                // Keep the persisted dashboard role in lockstep with the NEW token's role,
                // so a later reload doesn't restore a stale role that mismatches the token
                // (which would make the backend reject role-gated actions).
                sessionStorage.setItem('active_dashboard_role', dashType);

                await signIn(dashType, { ...userData, token, refreshToken });
            }
        } catch (err: any) {
            console.error("Demo Database Login failed:", err);
        } finally {
            if (seq === authActionSeqRef.current) setLoading(false);
        }
    };

    const value = React.useMemo(() => ({
        session,
        user,
        role,
        currentSchool,
        currentBranchId,
        loading,
        isDemo,
        memberships,
        signIn,
        signOut,
        switchSchool,
        switchDemoRole,
        userProfile: user,
        refreshUser: initializeAuth,
        refreshCurrentSchool: async () => {
            if (!currentSchool?.id) return;
            try {
                const updatedSchool = await api.getSchoolById(currentSchool.id);
                if (updatedSchool) {
                    setCurrentSchool(updatedSchool);
                    // Also update user.school if it exists to maintain consistency
                    if (user && user.school) {
                        setUser({ ...user, school: updatedSchool });
                        sessionStorage.setItem('cached_user_profile', JSON.stringify({ ...user, school: updatedSchool }));
                    }
                }
            } catch (err) {
                console.error("Error refreshing school:", err);
            }
        },
        isAuthenticated: !!user,
        mustChangePassword,
        switchDashboardRole: (newRole: DashboardType) => {
            React.startTransition(() => {
                setRole(newRole);
                sessionStorage.setItem('active_dashboard_role', newRole);
            });
        },
        // Password recovery now goes through Supabase, which emails a LINK
        // rather than the 6-digit code the legacy backend used. The old code
        // path could never have worked once Supabase owned identity: it asked
        // the user for a code that would never arrive.
        forgotPassword: async (email: string) => {
            const result = await supabaseSendPasswordReset(email);
            if (!result.success) throw new Error(result.error || 'Failed to send reset link');
            return result;
        },
        // Choosing the new password happens on SetPasswordScreen (reached via
        // the emailed link), so there is nothing to do here but report that
        // this path is no longer used. Kept so existing callers do not break.
        resetPassword: async () => {
            throw new Error('Use the link sent to your email to set a new password.');
        }
    }), [session, user, role, currentSchool, currentBranchId, loading, isDemo, memberships, initializeAuth]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
