import prisma from '../config/database';

/**
 * Term lookup service.
 *
 * The Malaysian school year runs January to November and is divided into terms.
 * Dates live in the academic_calendars table so the office can set them each year
 * when the school publishes its calendar — no redeploy required.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT MATTERED. It described "the Lagos State /
 * Nigerian academic year", three terms a session, edited each July when Lagos
 * published its harmonised calendar. That is not a wording problem: a Nigerian
 * session runs September to July, which is the OPPOSITE half of the year from a
 * Malaysian one. Anything reading these dates — a fee period, a report card
 * heading, a result term — would have been anchored to the wrong school year.
 *
 * All comparisons use Asia/Kuala_Lumpur (UTC+8, no DST). We compare against `Date`
 * objects because the DB stores TIMESTAMPTZ.
 */

export interface TermInfo {
    session: string;          // the calendar year, e.g. '2026'
    term: number;             // 1 | 2 | 3
    resumption_date: Date;    // Term resumption (school resumes)
    closing_date: Date;       // Term closing (last day of school)
    label: string;            // 'Penggal 2 — 2026'
    is_vacation: boolean;     // true if `date` is in vacation, term is upcoming
}

/**
 * Get the current term for a given date.
 *   - If date falls inside a term window → returns that term.
 *   - If date is in vacation → returns the NEXT upcoming term with is_vacation=true.
 *   - If no calendar rows match (e.g. past the last seeded session) → null.
 */
export async function getCurrentTerm(date: Date = new Date()): Promise<TermInfo | null> {
    // 1. In-term lookup
    const current = await prisma.academicCalendar.findFirst({
        where: {
            is_active: true,
            resumption_date: { lte: date },
            closing_date: { gte: date },
        },
        orderBy: { resumption_date: 'asc' },
    });

    if (current) {
        return {
            session: current.session,
            term: current.term,
            resumption_date: current.resumption_date,
            closing_date: current.closing_date,
            // "Penggal" is the Malay word for a school term, and the school year
            // is named by a single year (2026), not a span (2025/2026).
            label: `Penggal ${current.term} — ${current.session}`,
            is_vacation: false,
        };
    }

    // 2. Vacation — return next upcoming term
    const upcoming = await prisma.academicCalendar.findFirst({
        where: {
            is_active: true,
            resumption_date: { gt: date },
        },
        orderBy: { resumption_date: 'asc' },
    });

    if (upcoming) {
        return {
            session: upcoming.session,
            term: upcoming.term,
            resumption_date: upcoming.resumption_date,
            closing_date: upcoming.closing_date,
            label: `Penggal ${upcoming.term} — ${upcoming.session} (akan datang)`,
            is_vacation: true,
        };
    }

    return null;
}

/**
 * Boot-time seed: if academic_calendars is empty, insert this year's dates.
 * Safe to call multiple times. Real source of truth is the SQL migration —
 * this is a safety net for fresh dev databases.
 */
export async function seedAcademicCalendarIfEmpty(): Promise<void> {
    const count = await prisma.academicCalendar.count();
    if (count > 0) return;

    // The session is the CALENDAR YEAR, and each term sits inside it. The rows
    // here used to carry the session '2025/2026' with a +01:00 offset — a school
    // year that starts in September and a timezone one hour ahead of UTC. This
    // school's year starts in January and its offset is +08:00, so a date written
    // as midnight in Lagos fell at 07:00 the same morning in Kuala Nerang, moving
    // every term boundary.
    const y = new Date().getFullYear();
    const at = (d: string, end = false) => new Date(`${d}T${end ? '23:59:59' : '00:00:00'}+08:00`);
    await prisma.academicCalendar.createMany({
        data: [
            { session: `${y}`, term: 1, resumption_date: at(`${y}-01-02`), closing_date: at(`${y}-03-20`, true) },
            { session: `${y}`, term: 2, resumption_date: at(`${y}-03-30`), closing_date: at(`${y}-05-29`, true) },
            { session: `${y}`, term: 3, resumption_date: at(`${y}-06-08`), closing_date: at(`${y}-11-20`, true) },
        ],
        skipDuplicates: true,
    });
    console.log('🌱 [TermService] Seeded the academic calendar.');
}

/**
 * Standard term windows for the school year that starts in January of `year`.
 *
 * Used only when the calendar has no rows covering a date, so the school is never
 * blocked from recording a payment because nobody has entered next year's dates
 * yet. The office can edit the generated rows afterwards.
 *
 * WHAT THIS USED TO DO. It generated a Lagos-style session starting in SEPTEMBER
 * and running to the following July, with three terms that resumed in September,
 * January and May. Malaysia's school year is the calendar year, and its long
 * holiday falls at the END of the year — so the generated calendar put the third
 * term across the long holidays and named a session "2026/2027" that this school
 * does not have.
 *
 * Dates are built at `+08:00`, the school's own offset, not Lagos's `+01:00`.
 */
function standardSessionTerms(year: number) {
    const y = year;
    // 23:59:59 on the closing day, in Malaysian time.
    const kl = (d: string, end = false) => new Date(`${d}T${end ? '23:59:59' : '00:00:00'}+08:00`);
    return [
        { session: `${y}`, term: 1, resumption_date: kl(`${y}-01-02`), closing_date: kl(`${y}-03-20`, true) },
        { session: `${y}`, term: 2, resumption_date: kl(`${y}-03-30`), closing_date: kl(`${y}-05-29`, true) },
        { session: `${y}`, term: 3, resumption_date: kl(`${y}-06-08`), closing_date: kl(`${y}-11-20`, true) },
    ];
}

/**
 * Make sure the calendar has a term at (or after) `date`. Without this, the day
 * the last seeded session closes every paid activation fails with "No active
 * academic term configured" until someone adds the next session by hand.
 * Generates the standard windows for the session containing `date` (Sept → July)
 * when neither an in-term nor an upcoming row exists. Safe to call repeatedly.
 */
export async function ensureAcademicCalendarCoversDate(date: Date = new Date()): Promise<void> {
    if (await getCurrentTerm(date)) return;

    // A session starts in September: Jan–Aug belongs to the session that began the previous year.
    const startYear = date.getUTCMonth() >= 8 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    const terms = standardSessionTerms(startYear);
    const session = terms[0].session;

    const existing = await prisma.academicCalendar.count({ where: { session } });
    if (existing > 0) return; // rows exist but are inactive/edited — leave SuperAdmin's choice alone

    await prisma.academicCalendar.createMany({ data: terms, skipDuplicates: true });
    console.log(`🌱 [TermService] Calendar had no term covering ${date.toISOString().slice(0, 10)} — generated standard ${session} session.`);
}

/**
 * List all terms in the active calendar — used by SuperAdmin UI to edit dates.
 */
export async function listAllTerms() {
    return prisma.academicCalendar.findMany({
        orderBy: [{ session: 'desc' }, { term: 'asc' }],
    });
}
