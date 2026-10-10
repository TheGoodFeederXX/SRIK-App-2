/**
 * Parent accounts — the office's side.
 *
 * Reference: docs/srik/02_PHASE_1_AUTH.md, 07_PHASE_5_FINANCE.md
 *
 * Giving a parent a login and connecting them to their children is the most
 * sensitive thing the office does in this system, because the result is a
 * person who can read a child's records from home.
 *
 * Four rules, all enforced by the database rather than by this file:
 *
 * 1. THE ROLE IS ALWAYS GUARDIAN. The function takes no role argument, so a
 *    mistake here cannot create an administrator. That is deliberate: the
 *    dangerous input is the one that does not exist.
 *
 * 2. AN ACCOUNT WITHOUT A CHILD SEES NOTHING. Creating the login and linking a
 *    child are separate steps. Getting halfway is harmless, and the parent sees
 *    an empty screen rather than the whole school.
 *
 * 3. UNLINKING IS IMMEDIATE. Access comes from the family record, read at the
 *    moment of each request, so removing a link removes access at once. There is
 *    no cached permission list to expire.
 *
 * 4. EVERY ACTION NEEDS A REASON. Who created an account for whom, and who
 *    connected which child, are questions a school will be asked. They are all
 *    recorded with the reason the clerk typed.
 */

import { requireSupabase } from './client';
import { friendlyFinanceError } from './finance';

export interface GuardianRow {
    guardian_id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    has_login: boolean;
    child_count: number;
    child_names: string;
}

/** Every guardian, whether they can log in, and which children they see. */
export async function listGuardians(): Promise<GuardianRow[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('list_guardians_with_children');
    if (error) throw error;

    return ((data ?? []) as GuardianRow[]).map(row => ({
        ...row,
        // The RPC returns bigint for the count, which arrives as a string over
        // JSON in some clients. Coercing here keeps every screen's arithmetic
        // working on numbers.
        child_count: Number(row.child_count),
    }));
}

/** Turns a database error into something an office clerk can act on. */
export function friendlyGuardianError(error: unknown): string {
    const raw = (error as { message?: string })?.message ?? '';

    if (/already has a login/i.test(raw)) {
        return 'Penjaga ini sudah mempunyai akaun.';
    }
    if (/email already exists/i.test(raw)) {
        return 'Emel itu sudah digunakan oleh akaun lain.';
    }
    if (/at least 8 characters/i.test(raw)) {
        return 'Kata laluan mesti sekurang-kurangnya 8 aksara.';
    }
    if (/valid email/i.test(raw)) {
        return 'Sila masukkan alamat emel yang sah.';
    }
    if (/must state a reason/i.test(raw)) {
        return 'Sila nyatakan sebab tindakan ini.';
    }
    if (/not linked to that child/i.test(raw)) {
        return 'Penjaga ini tidak terpaut kepada anak itu.';
    }
    if (/permission/i.test(raw)) {
        return 'Anda tiada kebenaran untuk urus akaun ibu bapa.';
    }
    return friendlyFinanceError(error);
}

/**
 * Creates a login for a guardian, and links their children.
 *
 * This calls an Edge Function rather than the database, because creating an account
 * needs a key that bypasses Row Level Security and that key must never reach the
 * browser. The account is made by the system's own sign-up path, so the real
 * password policy, email confirmation, password recovery and sign-in audit trail
 * all apply to it. The function then links the guardian, gives the GUARDIAN role
 * and links the children in one step.
 *
 * It replaced a database function that built the account's credentials itself. That
 * version applied a minimum password length of 8 while the project's configuration
 * says 12, and skipped every check listed above, because it wrote the account
 * directly instead of asking the system to create one (audit F16).
 *
 * The temporary password is returned exactly once so the clerk can hand it over,
 * and is not stored anywhere the app can read back.
 */
export async function provisionGuardianAccount(input: {
    guardianId: string;
    email: string;
    fullName?: string;
    studentIds?: string[];
}): Promise<{ email: string; temporaryPassword: string; childrenLinked: number }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.functions.invoke('provision-guardian-account', {
        body: {
            guardianId: input.guardianId,
            email: input.email,
            fullName: input.fullName,
            studentIds: input.studentIds,
        },
    });
    if (error) throw error;
    const result = data as {
        email: string;
        temporaryPassword: string;
        childrenLinked?: number;
    };
    if (!result?.temporaryPassword) {
        throw new Error('The account was created but no temporary password was returned.');
    }
    return {
        email: result.email,
        temporaryPassword: result.temporaryPassword,
        childrenLinked: result.childrenLinked ?? 0,
    };
}

/** Links or unlinks a guardian and a child. Unlinking removes access at once. */
export async function setGuardianChildLink(input: {
    guardianId: string;
    studentId: string;
    link: boolean;
    relationship: string;
    reason: string;
}): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc('set_guardian_child_link', {
        p_guardian_id: input.guardianId,
        p_student_id: input.studentId,
        p_link: input.link,
        p_relationship: input.relationship.trim() || 'GUARDIAN',
        p_reason: input.reason.trim(),
    });
    if (error) throw error;
}

/** A guardian as the office creates one, before they have a login. */
export async function createGuardian(input: {
    fullName: string;
    phone: string;
    email?: string | null;
}): Promise<{ id: string }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('guardians')
        .insert({
            full_name: input.fullName.trim(),
            phone: input.phone.trim(),
            email: input.email?.trim() || null,
        })
        .select('id')
        .single();
    if (error) throw error;
    return data as { id: string };
}

/** Children a parent can be linked to. */
export async function listStudentsForLinking(): Promise<
    { id: string; full_name: string; admission_no: string | null }[]
> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('students')
        .select('id, full_name, admission_no')
        .eq('status', 'ACTIVE')
        .order('full_name');
    if (error) throw error;
    return (data ?? []) as { id: string; full_name: string; admission_no: string | null }[];
}

/**
 * The children linked to one guardian, by identity.
 *
 * Read from the family link, which is the same source the database uses to
 * decide access. The alternative — matching a name against the student list —
 * breaks when a name is spelled differently in two places, and would leave the
 * office unable to correct a wrong link, which is exactly when they need to.
 */
export async function listLinkedStudents(
    guardianId: string
): Promise<{ id: string; full_name: string; admission_no: string | null }[]> {
    const supabase = requireSupabase();

    // The guardian's own child ids, then the children themselves. Two steps
    // because the join row carries only ids, and PostgREST cannot filter an
    // embedded resource unless it is named in the select.
    const { data: links, error: linkError } = await supabase
        .from('student_guardians')
        .select('student_id')
        .eq('guardian_id', guardianId);
    if (linkError) throw linkError;

    const ids = ((links ?? []) as { student_id: string }[]).map(l => l.student_id);
    if (!ids.length) return [];

    const { data, error } = await supabase
        .from('students')
        .select('id, full_name, admission_no')
        .in('id', ids)
        .order('full_name');
    if (error) throw error;

    return (data ?? []) as { id: string; full_name: string; admission_no: string | null }[];
}
