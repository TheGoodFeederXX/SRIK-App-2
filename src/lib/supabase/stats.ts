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
import { todayInKualaLumpur } from './attendance';

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
 * Thrown when a dashboard figure cannot be read.
 *
 * This exists because returning 0 was WRONG, and the reason is worth keeping.
 *
 * The old version logged the failure and returned 0. The comment claimed a tile
 * reading "0" is a smaller problem than a dashboard that will not render. That
 * reasoning misses what 0 means here: on a register of ~250 people, "0 students"
 * is not a missing number, it is a DECLARATION that the school has no students.
 * The reader cannot tell it apart from an empty school, and the log line is not
 * visible to the person looking at the screen.
 *
 * This is the same mistake, one layer down, that this whole module was written to
 * fix: the dashboard said "Total Staff 0" when the school had 18 teachers, and
 * nothing looked broken.
 *
 * So the failure now travels. `getDashboardCounts` rejects, the query reports an
 * error, and the screen can say the figures could not be loaded — which is true,
 * and which someone can act on.
 */
export class StatsUnavailableError extends Error {
    constructor(
        public readonly table: string,
        cause: string,
    ) {
        super(`Could not read the ${table} figure: ${cause}`);
        this.name = 'StatsUnavailableError';
    }
}

/**
 * Counts rows matching a filter, without transferring any of them.
 *
 * THROWS rather than returning 0 when the count cannot be read. See
 * `StatsUnavailableError` for why a silent 0 is the defect and not the fix.
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
        throw new StatsUnavailableError(table, error.message);
    }
    // `count` is null only when the request was not a count request, which would
    // be a bug in this function rather than a database problem — so it is also a
    // failure, not a zero.
    if (n === null || n === undefined) {
        throw new StatsUnavailableError(table, 'the database returned no count');
    }
    return n;
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

/**
 * Classes running THIS academic year.
 *
 * Not simply "classes with status ACTIVE". `classes` carries an
 * `academic_year_id` and next year's classes are created while this year's still
 * run, so an unfiltered count grows every year and eventually reports twice the
 * real number. The figure is "how many classes are running now", so it is scoped
 * to the year that is CURRENT.
 *
 * `academic_years.status` is the database's own enum: PLANNED, CURRENT, CLOSED.
 * Exactly one year should be CURRENT.
 */
export async function countActiveClasses(): Promise<number> {
    // Two steps, not one nested filter.
    //
    // The obvious version — `classes?status=eq.ACTIVE&academic_years.status=eq.CURRENT`
    // — is REFUSED by the API with PGRST108, because a related table cannot be
    // filtered unless it is also selected, and selecting it here would return rows
    // we then throw away. That was verified against the live API rather than
    // assumed; the request came back 400.
    //
    // So the current year is resolved first and the count is filtered by its id. If
    // no year is CURRENT the count is 0, which is correct: the school has not set up
    // the year yet, so no classes are running.
    const { data: year, error } = await requireSupabase()
        .from('academic_years')
        .select('id')
        .eq('status', 'CURRENT')
        .limit(1)
        .maybeSingle();

    if (error) throw new StatsUnavailableError('academic_years', error.message);
    if (!year) return 0;

    return count('classes', (q) =>
        q.eq('status', 'ACTIVE').eq('academic_year_id', year.id),
    );
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
 *
 * THE DATE COMES FROM `todayInKualaLumpur`, the attendance module's helper, imported
 * rather than copied. The first version of this fix wrote its own Malaysian-date
 * function and the project's own branding check failed it: `en-CA` is a foreign
 * locale and only two files may name one. The guard was right — a second copy of a
 * date rule is a second thing to keep correct, and two dates that disagree about
 * which day it is would be a nasty bug to find.
 *
 * NOT `new Date().toISOString().slice(0, 10)`, which is UTC. Malaysia is UTC+8, so for
 * the first eight hours of every Malaysian day the UTC date is still YESTERDAY there:
 * a charge due today would count as overdue and the office would chase the family a
 * day early — in the morning, when the reminders go out.
 */
export function countOverdueCharges(): Promise<number> {
    return count('student_charges', (q) =>
        q.in('status', ['OUTSTANDING', 'PARTIAL']).lt('due_date', todayInKualaLumpur()),
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
    // ALL OR NOTHING, deliberately.
    //
    // Letting a partial success through would put a screen in front of the office
    // showing five real figures beside one made-up zero, with nothing to say which
    // was which. A screen that says the figures could not be loaded is less useful
    // and more honest, and it is the one that gets fixed.
    //
    // `Promise.all` short-circuits on the first failure, so a leak of the other
    // five requests is prevented by the caller not retrying in a loop.
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
