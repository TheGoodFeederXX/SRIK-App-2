import prisma from '../config/database';

/**
 * Configurable academics with a fallback chain:
 *   branch override  →  school default  →  built-in default
 *
 * A branch row (branch_id set) overrides the school default (branch_id NULL).
 */

export interface TermDef { name: string; order: number; start_date?: string; end_date?: string; is_current?: boolean; }
export interface GradeBand { min: number; max: number; grade: string; remark: string; }
export interface GradingDef { ca_percent: number; exam_percent: number; bands: GradeBand[]; }

export const DEFAULT_TERMS: TermDef[] = [
    { name: 'Penggal 1', order: 1, is_current: true },
    { name: 'Penggal 2', order: 2 },
    { name: 'Penggal 3', order: 3 },
];

/**
 * The default grade bands, and the remarks a report card prints.
 *
 * THESE MUST MATCH THE DATABASE. The school agreed its bands in phase 4 — A 80,
 * B 65, C 50, D 35, E below that — and the bands here were different (A 70, B 60,
 * C 50, D 45, E 40). A teacher's mark of 75 was an A on the report card and a B
 * in anything that read these defaults, and NOTHING would have reported the
 * disagreement: both answers look plausible on their own.
 *
 * Below D there is only E, because the school's scale ends there; the old scale
 * had a sixth band, F, which no report card should ever print.
 *
 * `ca_percent` and `exam_percent` are 40/60 as the school records them.
 */
export const DEFAULT_GRADING: GradingDef = {
    ca_percent: 0.4,
    exam_percent: 0.6,
    bands: [
        { min: 80, max: 100, grade: 'A', remark: 'Cemerlang' },
        { min: 65, max: 79, grade: 'B', remark: 'Baik' },
        { min: 50, max: 64, grade: 'C', remark: 'Memuaskan' },
        { min: 35, max: 49, grade: 'D', remark: 'Perlu Usaha' },
        { min: 0, max: 34, grade: 'E', remark: 'Perlu Bimbingan' },
    ],
};

export class AcademicSettingsService {
    /** Effective settings for a branch (or the school when no branch given). */
    static async getEffective(schoolId: string, branchId?: string | null): Promise<{ terms: TermDef[]; grading: GradingDef; source: 'branch' | 'school' | 'default' }> {
        const orClauses: any[] = [{ branch_id: null }];
        if (branchId) orClauses.push({ branch_id: branchId });
        const rows = await prisma.academicSettings.findMany({ where: { school_id: schoolId, OR: orClauses } });

        const branchRow = branchId ? rows.find(r => r.branch_id === branchId) : undefined;
        const schoolRow = rows.find(r => r.branch_id === null);

        const terms = (branchRow?.terms as any) ?? (schoolRow?.terms as any) ?? DEFAULT_TERMS;
        const grading = (branchRow?.grading as any) ?? (schoolRow?.grading as any) ?? DEFAULT_GRADING;
        const source: 'branch' | 'school' | 'default' = branchRow?.terms ? 'branch' : (schoolRow?.terms ? 'school' : 'default');
        return { terms, grading, source };
    }

    /** The raw row for one scope (for the editor: shows what's actually configured, not the fallback). */
    static async getRaw(schoolId: string, branchId?: string | null) {
        return prisma.academicSettings.findFirst({ where: { school_id: schoolId, branch_id: branchId ?? null } });
    }

    /** Create or update the (school, branch) settings row. */
    static async save(schoolId: string, branchId: string | null, data: { terms?: TermDef[]; grading?: GradingDef }) {
        const existing = await prisma.academicSettings.findFirst({ where: { school_id: schoolId, branch_id: branchId ?? null } });
        const payload = {
            terms: (data.terms ?? (existing?.terms as any) ?? DEFAULT_TERMS) as any,
            grading: (data.grading ?? (existing?.grading as any) ?? DEFAULT_GRADING) as any,
        };
        if (existing) {
            return prisma.academicSettings.update({ where: { id: existing.id }, data: { ...payload, updated_at: new Date() } });
        }
        return prisma.academicSettings.create({ data: { school_id: schoolId, branch_id: branchId ?? null, ...payload } });
    }
}

/**
 * The calendar windows the terms of a session cover — ONE rule for every feature
 * that has to turn "Penggal 1" into dates (attendance day counts on report cards,
 * term dashboards, fee periods).
 *
 * THE SCHOOL YEAR IS THE CALENDAR YEAR. A session runs 1 January to 31 December
 * and is named by that single year: "2026", not "2026/2027". This was an
 * August-to-July session named as a span ("2025/2026"), following the Nigerian
 * calendar — which is the WRONG HALF OF THE YEAR for a Malaysian school. A term
 * lookup in March 2026 would have been answered from the session that started in
 * August 2025 and closed in July 2026, so "Penggal 1" would have named a period
 * that began seven months earlier.
 *
 * The windows are GAPLESS: the first term starts on 1 January, every later term
 * starts the day after the previous one closes, and the last term runs to the end
 * of the session. Only the CLOSING dates come from configuration, in this order:
 *   1. dates typed into the school's own term settings (end_date);
 *   2. the platform academic calendar (AcademicCalendar closing_date);
 *   3. the standard Malaysian calendar (mid-March, late May, mid-November).
 * Gapless matters: a school that resumes and marks the register a week before the
 * official resumption date must still have those days counted — an earlier
 * version keyed on resumption dates and silently dropped them.
 */
export interface TermWindow { name: string; index: number; start: Date; end: Date; source: 'school' | 'calendar' | 'standard'; }

// Malay ordinals and numerals, because a term here is "Penggal 1", "Penggal 2"
// or "Penggal 3" — there is no "first"/"second"/"third" in the school's own words.
const ORDINALS = ['pertama', 'kedua', 'ketiga'];

/**
 * A moment in the school's own timezone.
 *
 * This was `lagos`, pinned to `+01:00`. Kuala Lumpur is `+08:00`, so every date
 * built here was seven hours out — a term closing "18 Dec 23:59" in Lagos was
 * 7am on the 19th in Malaysia, which is a different day, and on the last day of a
 * term a different day is the difference between a day counted and a day lost.
 */
const kualaLumpur = (d: string, end = false) =>
    new Date(`${d}T${end ? '23:59:59' : '00:00:00'}+08:00`);

/** Midnight the next day, in the school's timezone. */
const dayAfter = (d: Date) => {
    const n = new Date(d);
    n.setUTCDate(n.getUTCDate() + 1);
    n.setUTCHours(0, 0, 0, 0);
    return new Date(n.getTime() + 8 * 60 * 60 * 1000); // 00:00 Kuala Lumpur
};

/**
 * The calendar year a session belongs to.
 *
 * `session` is now a bare year ("2026"), but a span ("2025/2026") is still read
 * correctly, because rows written under the old model are still in the database
 * and a migration must not be able to change what an old report card says.
 */
export function sessionStartYear(session: string): number {
    const y = parseInt(String(session || '').split('/')[0], 10);
    if (Number.isFinite(y)) return y;
    // No session given: it is simply the current year, because the school year
    // IS the calendar year. The old code guessed August backwards because a
    // Nigerian session straddled two years.
    return new Date().getFullYear();
}

/**
 * Standard closing dates for term index 0..2 of a session.
 *
 * Malaysian school terms run roughly January–March, April–May and June–November,
 * with the long break at the end of the year. The old dates (18 Dec, 16 Apr,
 * 31 Jul) belonged to a September-to-July session and would have placed the
 * third term in the middle of the school holidays.
 */
export function standardTermClose(session: string, index: number): Date {
    const y = sessionStartYear(session);
    return [
        kualaLumpur(`${y}-03-20`, true),  // Penggal 1 ends before the March break
        kualaLumpur(`${y}-05-29`, true),  // Penggal 2 ends before the mid-year break
        kualaLumpur(`${y}-11-20`, true),  // Penggal 3 ends before the long holidays
    ][Math.min(Math.max(index, 0), 2)];
}

/** Index (0-based) of a term name within the configured list; falls back to the ordinal in the name. */
export function termIndexFromName(terms: TermDef[], termName: string): number {
    const wanted = String(termName || '').trim().toLowerCase();
    const sorted = [...terms].sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = sorted.findIndex(t => String(t.name || '').trim().toLowerCase() === wanted);
    if (i >= 0) return i;
    const ord = ORDINALS.findIndex(o => wanted.includes(o));
    if (ord >= 0) return ord;
    const num = parseInt(wanted.replace(/\D/g, ''), 10);
    return Number.isFinite(num) && num >= 1 && num <= 3 ? num - 1 : 0;
}

export async function resolveTermWindows(schoolId: string, branchId: string | null | undefined, session: string): Promise<TermWindow[]> {
    const eff = await AcademicSettingsService.getEffective(schoolId, branchId ?? undefined);
    const terms: TermDef[] = Array.isArray(eff.terms) && eff.terms.length ? eff.terms : DEFAULT_TERMS;
    const sorted = [...terms].sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 3);
    const y = sessionStartYear(session);
    // 1 January to 31 December, in the school's timezone.
    const sessionStart = kualaLumpur(`${y}-01-01`);
    const sessionEnd = kualaLumpur(`${y}-12-31`, true);
    const calendar = await prisma.academicCalendar.findMany({ where: { session, is_active: true } }).catch(() => [] as any[]);

    const closes: { end: Date; source: TermWindow['source'] }[] = sorted.map((def, i) => {
        if (def?.end_date) {
            const end = kualaLumpur(String(def.end_date).slice(0, 10), true);
            if (!isNaN(end.getTime()) && end > sessionStart && end <= sessionEnd) return { end, source: 'school' };
        }
        const row = calendar.find((r: any) => r.term === i + 1);
        if (row?.closing_date) return { end: new Date(row.closing_date), source: 'calendar' };
        return { end: standardTermClose(session, i), source: 'standard' };
    });

    const windows: TermWindow[] = [];
    let cursor = sessionStart;
    for (let i = 0; i < sorted.length; i++) {
        const last = i === sorted.length - 1;
        let end = last ? new Date(Math.max(closes[i].end.getTime(), sessionEnd.getTime())) : closes[i].end;
        if (end <= cursor) end = dayAfter(cursor); // mis-ordered configuration: never produce an empty/negative window
        windows.push({ name: sorted[i].name, index: i, start: cursor, end, source: closes[i].source });
        cursor = dayAfter(end);
    }
    return windows;
}

export async function resolveTermWindow(schoolId: string, branchId: string | null | undefined, termName: string, session: string): Promise<TermWindow> {
    const windows = await resolveTermWindows(schoolId, branchId, session);
    const index = termIndexFromName(windows.map(w => ({ name: w.name, order: w.index + 1 })), termName);
    return windows[Math.min(index, windows.length - 1)];
}

/**
 * Which term (name + session) a date falls in, using the same gapless windows.
 */
export async function resolveCurrentTerm(schoolId: string, branchId: string | null | undefined, date: Date = new Date()): Promise<{ term: string; session: string; window: TermWindow }> {
    // THE SESSION IS THE CALENDAR YEAR OF THE DATE. The old rule was
    // "August to December belongs to the session starting this year, January to
    // July to the one before" — an August-start year, which is what put a March
    // date in a session that began the previous August.
    //
    // The date is read in the SCHOOL's timezone, not the server's: a payment or a
    // register entry at 7am on 1 January in Kuala Lumpur is 11pm on 31 December
    // UTC, and reading it in UTC would file it in the previous school year.
    const y = Number(new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', timeZone: 'Asia/Kuala_Lumpur',
    }).format(date));
    // A bare year, because that IS the school year's name here.
    const session = `${y}`;
    const windows = await resolveTermWindows(schoolId, branchId, session);
    const pick = windows.find(w => date >= w.start && date <= w.end) || windows[windows.length - 1];
    return { term: pick.name, session, window: pick };
}
