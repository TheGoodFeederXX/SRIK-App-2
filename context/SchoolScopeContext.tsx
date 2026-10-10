/**
 * SCHOOL SCOPE — which school's data is on screen, and the school ID badge.
 *
 * WHAT THIS FILE USED TO BE. It was `BranchContext`: a branch switcher for a
 * product where one account could belong to several branches of a school group.
 * This school is one school. There is no `branches` table in its database, so the
 * branch list was ALWAYS EMPTY — every branch screen showed nothing, and the
 * switcher that offered "All Branches" could never be used.
 *
 * WHAT REMAINS. Three things that are real and still needed:
 *   1. `currentBranch` — the school's own identity record. Screens pass its id to
 *      the server as a SCOPE parameter. That parameter is kept deliberately: it is
 *      how a screen asks for one school's data, and removing it would mean
 *      rewriting the API layer for no visible gain.
 *   2. `activeBranchGeneratedId` — the school ID shown in the header (e.g.
 *      SRIK_MAIN_ADM_0001). Despite the name, this is the SCHOOL's ID, not a
 *      branch's.
 *   3. `isMainAdmin` — whether this administrator manages the whole school. Still
 *      meaningful, and the server is the only place that truly knows.
 *
 * The branch-selection machinery (switching, "all branches", the multi-branch
 * teacher's list) was removed. The remaining names still say "branch" in places
 * because the server's fields do; renaming across the API boundary is a separate,
 * larger job.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Branch, DashboardType } from '../types';
// Lean eager module — see lib/api/core.ts for why the full client isn't
// imported on the first-paint path.
import * as api from '../lib/api/eager';

interface SchoolScope {
    /**
     * The school's identity record. Screens pass `currentBranch.id` to the server
     * as a scope parameter, and the header reads `currentBranch.name`.
     * Null until it has loaded.
     */
    currentBranch: Branch | null;
    /**
     * The school record(s) available to this account. In practice one, because this
     * school is a single school. Kept as a list so existing callers that read
     * `branches[0]` or `.find(...)` need no change; it is normally length 1.
     */
    branches: Branch[];
    refreshBranches: () => Promise<void>;
    isLoading: boolean;
    /**
     * The school ID shown in the header, e.g. `SRIK_MAIN_ADM_0001`.
     * The name says "branch" because the server's field does; the value is the
     * SCHOOL's ID.
     */
    activeBranchGeneratedId: string | null;
    /**
     * Whether this administrator manages the whole school. Resolved from the
     * server (`is_main_admin`), which is the only place that truly knows.
     * Null until resolved.
     */
    isMainAdmin: boolean | null;
}

const SchoolScopeContext = createContext<SchoolScope | undefined>(undefined);

export const SchoolScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, currentSchool, loading: authLoading } = useAuth();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeBranchGeneratedId, setActiveBranchGeneratedId] = useState<string | null>(null);
    const [isMainAdmin, setIsMainAdmin] = useState<boolean | null>(null);

    /**
     * Resolve the school's identity record.
     *
     * WHAT THIS REPLACED. A branch-list fetch plus ~50 lines choosing which branch
     * to select: a saved preference from localStorage, a teacher's assigned branch,
     * an "all branches" view, and careful guards against a transient empty list
     * bouncing the selection back to the main branch.
     *
     * At this school that list was ALWAYS EMPTY, so none of that logic ever ran —
     * but it also meant `currentBranch` stayed null. Screens pass `currentBranch.id`
     * to the server as a scope parameter, and the school-name display reads
     * `currentBranch.name`, so both were silently empty. Resolving the school's own
     * record fixes that properly.
     */
    const refreshBranches = useCallback(async () => {
        if (!currentSchool) return;
        try {
            setIsLoading(true);
            const data = await api.getAuthorizedBranches();
            if (data && data.length > 0) {
                setBranches(data);
                // Keep the current selection if it is still in the list, so a
                // refresh never blanks the school name on screen.
                setCurrentBranch(prev => {
                    const stillThere = data.find((b: Branch) => b.id === prev?.id);
                    return stillThere || data[0];
                });
            }
            // An empty response is left alone deliberately: it is usually a
            // transient gap during a token refresh, and clearing here would blank
            // the school name and the ID badge the user is already looking at.
        } catch (err) {
            console.error('Error fetching school scope:', err);
        } finally {
            setIsLoading(false);
        }
    }, [currentSchool]);

    useEffect(() => {
        if (authLoading) {
            setIsLoading(true);
            return;
        }
        if (!user || !currentSchool) {
            setIsLoading(false);
            return;
        }
        refreshBranches();
    }, [authLoading, user, currentSchool, refreshBranches]);

    // Resolve the school ID badge (e.g. SRIK_MAIN_ADM_0001) for the header.
    useEffect(() => {
        // user/currentSchool going null here means a real sign-out (AuthContext.signOut
        // clears them explicitly) — clear the badge so it can't leak into whatever
        // account logs in next. A profile edit/reload never nulls these; it just
        // recreates the object, so this branch is not hit on those flows.
        if (!user || !currentSchool) { setActiveBranchGeneratedId(null); return; }
        let cancelled = false;
        api.getActiveBranchId()
            .then(res => {
                if (cancelled) return;
                // Only overwrite with a real value; an empty response on a transient
                // failure must not blank the badge the user is already looking at.
                const newId = res?.school_generated_id;
                if (newId) setActiveBranchGeneratedId(newId);
                // else: keep whatever ID is already showing — an empty response here
                // is a timing gap (re-resolving after edit/reload/branch-switch), not
                // proof the ID is gone. It'll correct itself on the next real refresh.
                if (typeof res?.is_main_admin === 'boolean') setIsMainAdmin(res.is_main_admin);
            })
            .catch(() => { /* keep existing badge on transient network error */ });
        return () => { cancelled = true; };
    }, [currentBranch?.id, user, currentSchool]);

    const value = useMemo(
        () => ({ currentBranch, branches, refreshBranches, isLoading, activeBranchGeneratedId, isMainAdmin }),
        [currentBranch, branches, refreshBranches, isLoading, activeBranchGeneratedId, isMainAdmin]
    );

    return (
        <SchoolScopeContext.Provider value={value}>
            {children}
        </SchoolScopeContext.Provider>
    );
};

export const useSchoolScope = () => {
    const context = useContext(SchoolScopeContext);
    if (context === undefined) {
        throw new Error('useSchoolScope must be used within a SchoolScopeProvider');
    }
    return context;
};
