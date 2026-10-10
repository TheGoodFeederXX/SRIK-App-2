/**
 * Dashboard counts — SRIK.
 *
 * WHY THIS EXISTS.
 *
 * The dashboard read its numbers from `api.getDashboardStats()`, which called the
 * legacy Express endpoint `/dashboard/stats`. That server is no longer deployed,
 * so the figures were silently wrong rather than visibly broken: the school had
 * 18 active teachers and the dashboard said "Total Staff 0". A wrong number is
 * worse than an error message, because nothing looks broken — the reader simply
 * believes the school is empty.
 *
 * EVERY QUERY HERE USES A COUNT, NEVER A ROW FETCH.
 *
 * Two reasons, both of which have bitten this project before:
 *
 *   1. PostgREST caps a single response at 1000 rows. Counting by fetching rows
 *      would silently start under-reporting the day a school exceeds that, and
 *      the number would be wrong in the quiet direction.
 *   2. Counting by fetching rows also loads every column of every row into the
 *      browser to discard all but the length. `head: true` asks the database for
 *      the number itself and transfers nothing.
 *
 * The count is exact rather than estimated: this is a school of ~250 people, and
 * an exact count on tables this small costs nothing while an estimate could
 * report "about 90" where the office expects 93.
 */

import { requireSupabase } from './client';

/** The headline figures shown on the admin dashboard. */
export interface DashboardCounts {
    students: number;
    staff: number;
    guardians: number;
    classes: number;
    /** Charges whose due date has passed and that still carry a balance. */
    overdueCharges: number;
    /** Published announcements the school has not withdrawn. */
    activeAnnouncements: number;
}

/**
 * Counts rows matching a filter, without transferring any of them.
 *
 * Returns 0 when the count cannot be read. That is deliberate: a dashboard tile
 * reading "0" is a smaller problem than a dashboard that will not render. The
 * caller can tell the difference between "empty" and "unreadable" because the
 * failure is logged.
 */
async function count(
    table: string,
    apply?: (q: any) => any,
): Promise<number> {
    const db = requireSupabase();
    let q = db.from(table).select('id', { count: 'exact', head: true });
    if (apply) q = apply(q);

    const { count: n, error } = await q;
    if (error) {
        // Named, because a silent zero is exactly the failure this module was
        // written to remove.
        console.error(`[stats] Could not count ${table}:`, error.message);
        return 0;
    }
    return n ?? 0;
}

/** Students currently on roll. ARCHIVED and withdrawn students are not on roll. */
export function countActiveStudents(): Promise<number> {
    return count('students', (q) => q.eq('status', 'ACTIVE'));
}

/** Teachers currently employed. */
export function countActiveTeachers(): Promise<number> {
    return count('teachers', (q) => q.eq('status', 'ACTIVE'));
}

/** Guardians with a record, whether or not they have a login yet. */
export function countGuardians(): Promise<number> {
    return count('guardians');
}

/** Classes running this year. */
export function countActiveClasses(): Promise<number> {
    return count('classes', (q) => q.eq('status', 'ACTIVE'));
}

/**
 * Charges still owed and already past their due date.
 *
 * The status values are the database's own enum (`charge_status`):
 * OUTSTANDING, PARTIAL, PAID, WAIVED, CANCELLED. Only the first two are money
 * still owed — PAID is settled, WAIVED was forgiven, CANCELLED never happened.
 * These are read from the enum rather than guessed: an invented value such as
 * 'UNPAID' is not an error, it simply matches nothing, and the overdue figure
 * would sit at 0 while the school chased families who owed nothing.
 */
export function countOverdueCharges(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    return count('student_charges', (q) =>
        q.in('status', ['OUTSTANDING', 'PARTIAL']).lt('due_date', today),
    );
}

/** Announcements the school has published and not withdrawn. */
export function countActiveAnnouncements(): Promise<number> {
    return count('announcements', (q) => q.eq('status', 'PUBLISHED'));
}

/**
 * All dashboard figures, fetched together.
 *
 * `Promise.all` rather than a sequence: these are independent, and a dashboard
 * is on the critical path of every admin visit. If one count fails it resolves to
 * 0 rather than rejecting the whole set, so one unreadable table cannot blank the
 * entire dashboard.
 */
export async function getDashboardCounts(): Promise<DashboardCounts> {
    const [students, staff, guardians, classes, overdueCharges, activeAnnouncements] =
        await Promise.all([
            countActiveStudents(),
            countActiveTeachers(),
            countGuardians(),
            countActiveClasses(),
            countOverdueCharges(),
            countActiveAnnouncements(),
        ]);

    return { students, staff, guardians, classes, overdueCharges, activeAnnouncements };
}
