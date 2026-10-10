/**
 * The school day's period structure, in one place — shared by the Timetable
 * Builder and the Timetable Editor so a change made in one shows up in the other.
 *
 * THE REAL STRUCTURE LIVES IN THE DATABASE. The published timetable and the
 * times each period actually runs are stored per school in `timetable_periods`,
 * written by the Timetable Editor and read by `src/lib/supabase/timetable.ts`.
 * This file is the editable DRAFT that sits behind that, and its defaults now
 * match the school's real day rather than the defaults of the product this code
 * came from.
 *
 * WHAT WAS WRONG BEFORE. The defaults here were eight periods starting at 08:00
 * with a Monday-to-Friday week. SRIK's day is twelve periods starting at 07:30,
 * and the week runs Sunday to Thursday. An office that opened the builder and
 * accepted the defaults would have produced a timetable for the wrong days and
 * the wrong times, and the mistake would only surface when a teacher found
 * themselves timetabled on a Friday.
 */
export interface PeriodDef {
    name: string;
    start: string; // 'HH:MM'
    end: string;   // 'HH:MM'
    isBreak?: boolean;
}

/**
 * The school's real day: twelve slots, 07:30 to 14:30.
 *
 * The dinner break and the Zohor prayer are part of the day, not gaps in it, so
 * they are listed with their times and flagged as non-teaching. Leaving them out
 * would number the teaching periods wrongly: a timetable that called the 13:20
 * slot "Period 11" when it is a prayer would put a lesson where the school
 * prays.
 */
export const DEFAULT_PERIODS: PeriodDef[] = [
    { name: 'Waktu 1', start: '07:30', end: '08:10' },
    { name: 'Waktu 2', start: '08:10', end: '08:50' },
    { name: 'Waktu 3', start: '08:50', end: '09:30' },
    { name: 'Waktu 4', start: '09:30', end: '09:50' },
    // Named "Rehat" because that is what the office calls it; a period without a
    // name would appear in the builder as a blank the office has to fill in.
    { name: 'Rehat', start: '09:50', end: '10:25', isBreak: true },
    { name: 'Waktu 5', start: '10:25', end: '11:05' },
    { name: 'Waktu 6', start: '11:05', end: '11:45' },
    { name: 'Waktu 7', start: '11:45', end: '12:25' },
    { name: 'Waktu 8', start: '12:25', end: '13:05' },
    { name: 'Waktu 9', start: '13:05', end: '13:20' },
    { name: 'Zohor', start: '13:20', end: '14:00', isBreak: true },
    { name: 'Waktu 10', start: '14:00', end: '14:30' },
];

/**
 * The school week: Sunday to Thursday.
 *
 * Malaysia's weekend for this school is Friday and Saturday, so a Monday-first
 * list is not merely mislabelled — it puts the wrong days in the grid.
 */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

const storeKey = (schoolId?: string, branchId?: string) =>
    `timetable_schedule_${schoolId || 'x'}_${(branchId && branchId !== 'all') ? branchId : 'main'}`;

/** Load the saved schedule for this school+branch, else the default. */
export function loadSchedule(schoolId?: string, branchId?: string): PeriodDef[] {
    try {
        const raw = localStorage.getItem(storeKey(schoolId, branchId));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length && parsed.every((p) => p && p.name && p.start && p.end)) {
                return parsed;
            }
        }
    } catch { /* ignore */ }
    return DEFAULT_PERIODS.map((p) => ({ ...p }));
}

/** Persist the schedule (e.g. after editing break times). */
export function saveSchedule(periods: PeriodDef[], schoolId?: string, branchId?: string) {
    try { localStorage.setItem(storeKey(schoolId, branchId), JSON.stringify(periods)); } catch { /* ignore */ }
}

// --- Per-day overrides: a specific day (e.g. Wed/Fri) can have different times. ---
const dayKey = (schoolId: string | undefined, day: string) => `${storeKey(schoolId)}_day_${day}`;

/** The schedule for a specific day — its override if set, otherwise the base. */
export function loadDaySchedule(schoolId: string | undefined, day: string): PeriodDef[] {
    try {
        const raw = localStorage.getItem(dayKey(schoolId, day));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) return parsed;
        }
    } catch { /* ignore */ }
    return loadSchedule(schoolId);
}

export function saveDaySchedule(periods: PeriodDef[], schoolId: string | undefined, day: string) {
    try { localStorage.setItem(dayKey(schoolId, day), JSON.stringify(periods)); } catch { /* ignore */ }
}

export function hasDayOverride(schoolId: string | undefined, day: string): boolean {
    try { return !!localStorage.getItem(dayKey(schoolId, day)); } catch { return false; }
}

export function clearDayOverride(schoolId: string | undefined, day: string) {
    try { localStorage.removeItem(dayKey(schoolId, day)); } catch { /* ignore */ }
}

/** Only the teaching periods (no breaks) — what the Builder drops subjects into. */
export const teachingPeriods = (periods: PeriodDef[]) => periods.filter((p) => !p.isBreak);

/**
 * A day number from the database to the day it names.
 *
 * The database stores Sunday as 1, matching `EXTRACT(DOW)` and the `SCHOOL_DAYS`
 * list used everywhere else. The old version of this function subtracted one,
 * which was correct only for a Monday-first week — so it read Sunday's periods as
 * Monday's and reported the last day of the school week as Friday.
 *
 * Returns null rather than guessing. A silent fallback to "Monday" is how the
 * previous timetable showed a Monday's lessons on a Sunday.
 */
export const dayName = (dow: number): string | null => DAY_NAMES[dow - 1] ?? null;

/** 'Sunday' -> 1. Returns null for a name that is not a school day. */
export const dayNumber = (name: string): number | null => {
    const index = DAY_NAMES.indexOf(name);
    return index === -1 ? null : index + 1;
};
