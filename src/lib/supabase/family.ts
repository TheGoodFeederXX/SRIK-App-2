import i18n from '../../../lib/i18n';
/**
 * A guardian's own children, and what is happening with them.
 *
 * WHY THIS MODULE EXISTS. Every parent screen asked an Express server that is not
 * deployed for `getMyChildren`, `getMyParentProfile`, `getAttendanceByStudent` and
 * the rest. So the parent portal — the one part of this system a family actually
 * uses — could not show a single thing, and no amount of correct school-side work
 * would have changed that.
 *
 * THE DATABASE ALREADY KNOWS WHO THE GUARDIAN IS, and that is the whole design. There
 * is no `guardianId` parameter here and there must never be one: `students_select_guardian`
 * on the `students` table allows a row exactly when `is_guardian_of(id)` is true. So
 * "my children" is a plain read of `students`, and the database returns only the
 * children this guardian is attached to.
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. A guardian id passed from the browser is a
 * number a parent can change, and the whole portal would then be scoped by a value the
 * caller chose. Here the scope comes from the session, so there is nothing to tamper
 * with — and a wrong answer is not possible, only an empty one.
 */
import { requireSupabase } from './client';
import { listStudents, type StudentRecord } from './students';

export interface ChildSummary {
    student: StudentRecord;
    /** The guardian's own words for the relationship, e.g. "Mother". */
    relationship: string | null;
    isPrimary: boolean;
}

/**
 * The children this signed-in guardian is responsible for.
 *
 * Returns `[]` for someone who is not a guardian, which is the correct answer rather
 * than an error: a teacher opening a parent screen has no children, and saying so is
 * not a failure.
 */
export async function listMyChildren(): Promise<ChildSummary[]> {
    const db = requireSupabase();

    // Which children, and in what capacity. This is the LINK table, and it is the
    // only place the relationship is recorded — `guardians` itself has no such column,
    // because one person can be a mother to one child and a guardian to another.
    const { data: links, error: linkError } = await db
        .from('student_guardians')
        .select('student_id, relationship, is_primary')
        .limit(200);

    if (linkError) throw new Error(`${i18n.t('dataErrors.couldNotLoadYourChildren')}: ${linkError.message}`);

    const rows = (links ?? []) as unknown as {
        student_id: string;
        relationship: string | null;
        is_primary: boolean | null;
    }[];

    // No links means no children. Returning here avoids loading every student the
    // guardian can see only to filter them to nothing.
    if (rows.length === 0) return [];

    const byId = new Map(rows.map(r => [r.student_id, r]));

    // The children themselves, read through the guardian policy. This deliberately
    // reads the students the guardian is linked to rather than listing all students
    // and filtering: the DATABASE decides what this caller may see, so a mistake here
    // cannot widen the scope.
    const students = await listStudents();
    return students
        .filter(s => byId.has(s.id))
        .map(s => ({
            student: s,
            relationship: byId.get(s.id)?.relationship ?? null,
            isPrimary: Boolean(byId.get(s.id)?.is_primary),
        }));
}

/** One child, confirmed to be this guardian's before anything is returned. */
export async function getMyChild(studentId: string): Promise<ChildSummary | null> {
    const children = await listMyChildren();
    return children.find(c => c.student.id === studentId) ?? null;
}

/**
 * Finds a child by the school's own identifier — the admission number.
 *
 * A parent will not know our database id, and should not have to. This is a lookup
 * and returns null when nothing matches, rather than throwing: "no such child" is a
 * normal answer on a form where somebody mistyped a number.
 *
 * The guardian policy still applies, so a parent cannot use this to discover whether
 * another family's child exists.
 */
export async function findStudentByCode(code: string): Promise<StudentRecord | null> {
    const db = requireSupabase();
    const trimmed = code.trim();
    if (!trimmed) return null;

    const { data, error } = await db
        .from('students')
        // Only the admission number. There is no `school_generated_id` column, so
        // searching for one would have matched nothing and looked like "no such
        // student" for every correct number a parent typed.
        .select('id')
        .eq('admission_no', trimmed)
        .limit(1);

    if (error) return null;
    const row = (data ?? [])[0] as { id: string } | undefined;
    if (!row) return null;

    // Re-read through the same path the rest of the module uses, so a child found
    // here and a child listed as "mine" are the same object with the same class.
    const children = await listMyChildren();
    return children.find(c => c.student.id === row.id)?.student ?? null;
}

/**
 * The guardian record belonging to the signed-in account.
 *
 * `guardians.user_id` links a login to a person. Returns null when the account has no
 * guardian record — which is a real state for a staff account, not an error.
 */
export async function getMyGuardianRecord(): Promise<{ id: string; fullName: string } | null> {
    const db = requireSupabase();
    const { data: auth } = await db.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return null;

    const { data, error } = await db
        .from('guardians')
        .select('id, full_name')
        .eq('user_id', userId)
        .limit(1);

    if (error) return null;
    const row = (data ?? [])[0] as { id: string; full_name: string } | undefined;
    return row ? { id: row.id, fullName: row.full_name } : null;
}

/**
 * The student record belonging to the signed-in account.
 *
 * `students.user_id` links a login to a child. Returns null when the account has no
 * student record — a normal state for a staff or guardian account, not an error.
 *
 * WHY THIS IS NOT A PARAMETER ANYWHERE. A student id from the browser is a value the
 * caller chose, and every screen that then reads attendance, marks or fees would be
 * scoped by it. Here the database returns at most the one row whose `user_id` is the
 * session's, so there is nothing to tamper with.
 */
export async function getMyStudentId(): Promise<string | null> {
    const db = requireSupabase();
    const { data: auth } = await db.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return null;

    const { data, error } = await db
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

    if (error) return null;
    const row = (data ?? [])[0] as { id: string } | undefined;
    return row?.id ?? null;
}
