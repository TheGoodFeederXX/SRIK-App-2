/**
 * The school's own name and marks, in one place.
 *
 * Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
 *
 * SRIK is a single school, so these are constants rather than per-tenant
 * configuration. Keeping them together means a rename or a new crest is one
 * edit, and it is what stopped the old vendor's name ("Oliskey School App")
 * from lingering in whichever screen nobody happened to look at.
 *
 * THE LOGO FILE
 *
 * `public/school-logo.png` is the school's crest. Drop the file there with that
 * exact name and it appears everywhere at once — the loading screen, the
 * installed app's icon path, and anywhere else that imports from here. Nothing
 * else needs changing.
 *
 * A PNG with a TRANSPARENT background is best: the loading screen turns the logo
 * as if it were a coin, and a white box would turn with it and look like a card
 * flipping rather than a crest. A square image, at least 512 x 512, will look
 * sharp on a phone.
 *
 * Until the file is present, `SCHOOL_LOGO_SRC` falls back to the school's
 * monogram drawn in text, so the app never shows a broken image.
 */

/** The school's full name, as it appears on documents. */
export const SCHOOL_NAME = 'SRI Al-Khairiah';

/** The short form, for tight spaces. */
export const SCHOOL_SHORT_NAME = 'SRIK';

/** The crest. See the note above about replacing this file. */
export const SCHOOL_LOGO_SRC = '/school-logo.png';

/**
 * A monogram, for when no logo file has been supplied.
 *
 * Rendered as styled text rather than an image, so it can never 404 and never
 * shows a broken-image placeholder on a school's phone.
 */
export const SCHOOL_MONOGRAM = 'SRIK';

/** Colours, so a change of crest does not need a search through the app. */
export const SCHOOL_COLOR = '#0F766E';
export const SCHOOL_COLOR_SOFT = '#CCFBF1';

/**
 * Dates, written the way a Malaysian school writes them.
 *
 * WHY THIS IS ONE PLACE AND NOT EIGHTY CALL SITES
 *
 * The app had 308 date-formatting calls across 174 files. 188 of them passed no
 * locale at all, which means the format followed the DEVICE: the same fee due
 * date read "3/2/2026" on one parent's phone and "2/3/2026" on another, and the
 * office could not tell which one a parent was looking at. 89 more hardcoded
 * `en-US`, `en-GB` or `en-NG` — so dates read "March 2, 2026" in a Malay school.
 * Only 4 calls used `ms-MY`.
 *
 * Fixing 308 call sites individually would have left the next one to be written
 * wrong. These helpers are the single answer, so a new screen has an obvious
 * right thing to reach for.
 *
 * WHY THE TIMEZONE IS PINNED
 *
 * The school's day is a MALAYSIAN day. A date formatted in the device's zone is
 * wrong for a teacher whose phone is still set to another country, and a date
 * built with `timeZone: 'UTC'` is wrong for everyone in Malaysia after 8pm — a
 * payment recorded at 11pm on the 2nd would print as the 2nd of the month before.
 * Every helper here pins `Asia/Kuala_Lumpur`.
 */

/** The school's timezone. Used by every date helper below. */
export const SCHOOL_TIME_ZONE = 'Asia/Kuala_Lumpur';

/** The school's locale. Malay, as spoken in Malaysia. */
export const SCHOOL_LOCALE = 'ms-MY';

/**
 * `2 Mac 2026` — the everyday date.
 *
 * This is the form a Malaysian school writes on a letter, a receipt and a report
 * card: day, then the Malay month name, then the year.
 */
export function formatDate(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        day: 'numeric', month: 'short', year: 'numeric',
        timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/**
 * `2 Mac 2026, 3:45 PTG` — when the time of day matters.
 *
 * Malay uses a 24-hour clock in formal school writing, so no AM/PM is invented.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/** `2 Mac 2026` where only the day and month are useful, as on a badge. */
export function formatDayMonth(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        day: 'numeric', month: 'short', timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/** `Januari 2026` — a month heading. */
export function formatMonthYear(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        month: 'long', year: 'numeric', timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/** `6:05 PG` where only the clock is shown. */
export function formatTime(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/**
 * `2026-10-09` — the machine form, for query parameters and database keys.
 *
 * `en-CA` is used deliberately: it is the one locale whose short date is already
 * `YYYY-MM-DD`, so no manual string assembly is needed. This is not a display
 * format and must never reach a user.
 */
export function toIsoDay(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
    return parts;
}

/**
 * Today, in the school's timezone, as `YYYY-MM-DD`.
 *
 * `new Date().toISOString().slice(0,10)` is the common shortcut and it is wrong
 * here: it gives the UTC day, so before 8am Malaysian time it returns YESTERDAY.
 * A teacher marking the register at 7:40am would have been marking yesterday.
 */
export function todayInSchoolTime(): string {
    return toIsoDay(new Date());
}

/** The Malay day name, e.g. `Ahad`. */
export function formatWeekday(value: string | Date | null | undefined, long = false): string {
    const d = toDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat(SCHOOL_LOCALE, {
        weekday: long ? 'long' : 'short', timeZone: SCHOOL_TIME_ZONE,
    }).format(d);
}

/** A date from a string, a Date, or nothing. An unreadable value is not a date. */
function toDate(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The school week, in Malay, Sunday first.
 *
 * Sunday first because that is the school's week, not because Sunday is the
 * first day by some convention. `getDay()` returns 0 for Sunday, and this array
 * is indexed by it directly — so no off-by-one arithmetic is needed anywhere,
 * which is the mistake the previous timetable made.
 */
export const SCHOOL_DAY_NAMES_MS = [
    'Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu',
];

/** Short Malay day names, Sunday first, indexed by `getDay()`. */
export const SCHOOL_DAY_SHORT_MS = ['Ah', 'Is', 'Se', 'Ra', 'Kh', 'Ju', 'Sa'];

/**
 * Day names as the DATABASE writes them, Sunday first, indexed by `getDay()`.
 *
 * The timetable's `day_of_week` column is an enum of the upper-case ENGLISH day
 * names (`SUNDAY` … `THURSDAY`), not a number. That distinction caused a real
 * bug: a screen compared `day_of_week === 3` for today, which can never be true
 * when the column holds `'WEDNESDAY'`. The comparison failed silently — no
 * error, just an empty "today's schedule" every single day.
 *
 * Use this whenever a `getDay()` number must be compared against a stored day.
 */
export const SCHOOL_DAY_ENUM = [
    'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
] as const;

/** The stored day name for a `Date`, e.g. `'WEDNESDAY'`. */
export function toSchoolDayEnum(value: string | Date | null | undefined): string | null {
    const d = value instanceof Date ? value : new Date(String(value ?? ''));
    if (Number.isNaN(d.getTime())) return null;
    return SCHOOL_DAY_ENUM[d.getDay()] ?? null;
}
