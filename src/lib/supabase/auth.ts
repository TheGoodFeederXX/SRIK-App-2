/**
 * Supabase auth operations — SRIK.
 *
 * Reference: docs/srik/03_PHASE_1_SUPABASE_AUTH.md
 *
 * This module is the single place the app talks to Supabase Auth. Keeping it
 * separate from the UI means the login screen keeps its existing shape while
 * the credential check underneath changes, and it gives one place to translate
 * Supabase's error codes into the sentences the UI already shows.
 *
 * DESIGN NOTES
 *   * Sign-in is EMAIL ONLY. The old screen accepted an email OR a
 *     `school_generated_id` (e.g. SCH01_BR02_TCH_005). Supabase Auth has no
 *     concept of a school ID, and the ID format is a multi-tenant concept being
 *     removed, so that path is deliberately gone.
 *   * Errors are returned, not thrown, so callers can render them in the
 *     existing error panel without a try/catch shape change.
 *   * A missing Supabase configuration is a first-class error result rather
 *     than a crash, because the app must stay usable while any legacy path is
 *     still present during cutover.
 */

import { supabase, isSupabaseConfigured } from './client';

/** Result shape the login screen already understands. */
export interface AuthResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    /** True when sign-in failed only because the email is not confirmed yet. */
    requiresVerification?: boolean;
}

/** The app-side identity, derived from the Supabase session + profile row. */
export interface SrikIdentity {
    id: string;
    email: string | null;
    /** From the `profiles` table. */
    fullName: string;
    displayName: string | null;
    phone: string | null;
    avatarStorageKey: string | null;
    /** 'ACTIVE' | 'DISABLED' | 'ARCHIVED' — DISABLED users are rejected. */
    status: string;
    /**
     * True when an administrator created the account with a temporary password.
     * The credential is therefore known to a second person, so the app must
     * require the owner to replace it before the account is used for real work.
     */
    mustChangePassword: boolean;
    /** Role codes from `user_roles`, e.g. ['ADMIN'] or ['TEACHER']. */
    roles: string[];
    /** Effective permission codes (role grants UNION individual grants). */
    permissions: string[];
}

/**
 * Maps Supabase error messages to the wording the login screen already shows.
 *
 * The original screen surfaced "Invalid credentials" for a bad login. Keeping
 * that exact string (rather than Supabase's "Invalid login credentials")
 * preserves what the user sees, which is the point of this migration.
 */
function translateAuthError(message: string | undefined): string {
    const m = (message || '').toLowerCase();

    if (m.includes('invalid login credentials')) {
        return 'Invalid credentials';
    }
    if (m.includes('email not confirmed')) {
        return 'Please verify your email before logging in';
    }
    if (m.includes('user is banned') || m.includes('banned')) {
        return 'This account has been disabled. Contact the school administrator.';
    }
    if (m.includes('password should be at least')) {
        return 'Password is too short.';
    }
    if (m.includes('unable to validate email') || m.includes('invalid email')) {
        return 'Please enter a valid email address.';
    }
    if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
        return 'Too many attempts. Please wait a moment and try again.';
    }
    if (m.includes('failed to fetch') || m.includes('networkerror')) {
        return 'Connection failed. Please check your internet connection.';
    }
    // Unknown errors are passed through rather than flattened, so a real
    // problem is not disguised as a wrong password.
    return message || 'Invalid credentials';
}

const NOT_CONFIGURED =
    'Authentication is not configured yet. Set VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY, then restart.';

/**
 * Sign in with email and password.
 *
 * On success the Supabase session is established and persisted by the client;
 * the caller then loads the identity via fetchIdentity().
 */
export async function signInWithEmail(
    email: string,
    password: string
): Promise<AuthResult<{ userId: string; email: string | null }>> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return { success: false, error: 'Please enter both email and password.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
    });

    if (error) {
        const translated = translateAuthError(error.message);
        return {
            success: false,
            error: translated,
            // Surfaced so the caller can route to a verification screen instead
            // of just showing a red message. The old screen dropped this flag.
            requiresVerification: /verify your email/i.test(translated),
        };
    }

    if (!data.user) {
        return { success: false, error: 'Invalid credentials' };
    }

    // A DISABLED profile must not get past sign-in, even though Supabase Auth
    // itself has no concept of our profile status. Cut the session immediately.
    const identity = await fetchIdentity(data.user.id);
    if (identity.data && identity.data.status !== 'ACTIVE') {
        await signOut();
        return {
            success: false,
            error: 'This account has been disabled. Contact the school administrator.',
        };
    }

    return {
        success: true,
        data: { userId: data.user.id, email: data.user.email ?? null },
    };
}

/** Sign out locally and revoke the refresh token at Supabase. */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: true };
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
        // A failed remote sign-out must not trap the user in a signed-in UI.
        // The local session is cleared regardless by the caller's state reset.
        return { success: false, error: translateAuthError(error.message) };
    }
    return { success: true };
}

/** The current session, restored from storage. Null when signed out. */
export async function getSession() {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session ?? null;
}

/**
 * Loads the app-side identity for a user: profile, roles and effective
 * permissions.
 *
 * Permissions are read from the database rather than trusted from the token,
 * because 03_PHASE_1 requires the database to be the source of current
 * permissions and warns against relying on a stale token.
 */
export async function fetchIdentity(userId: string): Promise<AuthResult<SrikIdentity>> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, phone, avatar_storage_key, status, must_change_password')
        .limit(2000)
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
        return { success: false, error: profileError.message };
    }
    if (!profile) {
        // The trigger creates a profile on signup; a missing row means the
        // account exists in Auth but has no application profile.
        return { success: false, error: 'No profile found for this account.' };
    }

    const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role_code')
        .limit(2000)
        .eq('user_id', userId);

    const roles = (roleRows ?? []).map((r) => r.role_code as string);

    // Effective permissions: role grants UNION individual grants. Computed
    // here from the two tables the RLS policies also use, so the UI and the
    // database cannot disagree about what a user may do.
    const permissionSet = new Set<string>();

    if (roles.length > 0) {
        const { data: rolePerms } = await supabase
            .from('role_permissions')
            .select('permission_code')
            .limit(2000)
            .in('role_code', roles);
        for (const row of rolePerms ?? []) permissionSet.add(row.permission_code as string);
    }

    const { data: userPerms } = await supabase
        .from('user_permissions')
        .select('permission_code')
        .limit(2000)
        .eq('user_id', userId);
    for (const row of userPerms ?? []) permissionSet.add(row.permission_code as string);

    return {
        success: true,
        data: {
            id: profile.id,
            email: null, // filled by the caller from the session
            fullName: profile.full_name ?? '',
            displayName: profile.display_name ?? null,
            phone: profile.phone ?? null,
            avatarStorageKey: profile.avatar_storage_key ?? null,
            status: profile.status,
            mustChangePassword: profile.must_change_password ?? false,
            roles,
            permissions: [...permissionSet].sort(),
        },
    };
}

/**
 * Sends a password-reset email.
 *
 * Note the deliberate asymmetry with the old flow: it used a 6-digit code.
 * Supabase sends a link by default. The caller's UI already has both a code and
 * a link wording path, so the screen keeps working; the code entry simply is
 * not required for the link flow.
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
        return { success: false, error: 'Email is required' };
    }

    const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
    if (error) {
        return { success: false, error: translateAuthError(error.message) };
    }
    return { success: true };
}

/** Updates the signed-in user's password. Used by the reset-email landing. */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }
    if (!newPassword) {
        return { success: false, error: 'All fields are required' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
        return { success: false, error: translateAuthError(error.message) };
    }
    return { success: true };
}

/**
 * Change the signed-in user's password, checking the current one first.
 *
 * WHY THE CURRENT PASSWORD IS RE-CHECKED RATHER THAN IGNORED. Supabase's
 * `updateUser` will happily set a new password for whoever holds the session. In a
 * staffroom that matters: a teacher who leaves a laptop unlocked has handed over
 * the account either way, but without this check they have also handed over the
 * ability to LOCK THE REAL OWNER OUT — changing the password to something they do
 * not know. Asking for the current one means the person typing must already know
 * it, so a walk-up cannot take the account away.
 *
 * The check is a real sign-in against the same account, not a string comparison,
 * so it is the provider's own answer rather than ours.
 */
export async function changePassword(
    currentPassword: string,
    newPassword: string,
): Promise<AuthResult> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }
    if (!currentPassword || !newPassword) {
        return { success: false, error: 'All fields are required' };
    }
    if (newPassword.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
    }

    const session = await getSession();
    const email = session?.user?.email;
    if (!email) {
        return { success: false, error: 'You are not signed in' };
    }

    // Re-authenticate against the SAME account. A wrong current password is
    // reported as such and stops here, so the new one is never applied.
    const check = await signInWithEmail(email, currentPassword);
    if (!check.success) {
        return { success: false, error: 'Your current password is not correct' };
    }

    return updatePassword(newPassword);
}

/**
 * Subscribe to auth state changes (sign-in, sign-out, token refresh, and
 * session expiry). Returns an unsubscribe function.
 */
export function onAuthStateChange(
    callback: (event: string, session: unknown) => void
): () => void {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
    return () => data.subscription.unsubscribe();
}

/**
 * True when the signed-in user holds the given permission.
 * Mirrors the database's has_permission() so the UI can hide what the database
 * would refuse. Never a substitute for RLS: the database remains authoritative.
 */
/**
 * Records that the owner has replaced their temporary password.
 *
 * The password itself is set by Supabase Auth (updatePassword). This only
 * clears the flag marking the credential as "known to an administrator", so it
 * must be called AFTER the password change succeeds. Calling it first would
 * mark the account as safe while the temporary password still worked.
 */
export async function completePasswordChange(): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
        return { success: false, error: NOT_CONFIGURED };
    }

    // `complete_password_change` requires EVIDENCE that the password was actually
    // changed — Supabase Auth writes the account's `updated_at`, and the function
    // compares it against `created_at`. The old `clear_temporary_password_flag`
    // took the caller's word for it, so the flag could be cleared without the
    // password ever changing (audit F14).
    const { error } = await supabase.rpc('complete_password_change');
    if (error) {
        return { success: false, error: translateAuthError(error.message) };
    }
    return { success: true };
}

export function identityHasPermission(identity: SrikIdentity | null, permission: string): boolean {
    if (!identity) return false;
    return identity.permissions.includes(permission);
}

/** True when the signed-in user holds at least one of the given roles. */
export function identityHasRole(identity: SrikIdentity | null, ...roles: string[]): boolean {
    if (!identity) return false;
    return roles.some((r) => identity.roles.includes(r));
}
