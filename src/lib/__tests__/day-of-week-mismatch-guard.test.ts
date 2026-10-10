/**
 * A guard against comparing a NUMBER to a DAY NAME.
 *
 * WHY THIS FILE EXISTS. The same bug appeared THREE times in this codebase, and
 * each time it failed silently — no error, no crash, just a blank or an empty
 * list that looked like a design choice:
 *
 *   1. `TeacherOverview` "Today's Schedule" filtered
 *      `Number(e.day_of_week) === todayNum`, where `todayNum` was `1` for Monday.
 *      The column holds `'MONDAY'`, so the filter was never true and the panel
 *      was empty every day of the week.
 *   2. `MyClassHubScreen` rendered `DAY_NAMES[t.day_of_week] || ''` from a map
 *      keyed `1=Mon … 7=Sun`. The lookup was always `undefined`, so every
 *      timetable line read " · 08:00–08:30" with no day — and the `|| ''` made
 *      the blank look intentional.
 *   3. The teacher attendance screen blocked `day === 0` (Sunday) as a weekend,
 *      in a school whose week RUNS from Sunday to Thursday.
 *
 * The shared root cause: the timetable's `day_of_week` column is an enum of
 * upper-case ENGLISH DAY NAMES, while `Date.getDay()` returns a NUMBER whose
 * Sunday-first indexing differs from the `1=Mon…7=Sun` convention people assume.
 * A silent mismatch is invisible in review and invisible in a screenshot.
 *
 * This test asserts the ONE convention, in the ONE place that defines it, so the
 * next person has a single thing to check against.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
    SCHOOL_DAY_ENUM, SCHOOL_DAY_NAMES_MS, toSchoolDayEnum,
} from '../branding';

const ROOT = join(__dirname, '..', '..', '..');

/** Every shipped source file, excluding tests and build output. */
function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sourceFiles(full, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
}

describe('the stored day-of-week convention', () => {
    it('THE RULE: the enum is the database\u2019s own values, Sunday first', () => {
        // These are written into and read from `timetable_periods.day_of_week`.
        // The live database holds exactly SUNDAY…THURSDAY.
        expect(SCHOOL_DAY_ENUM[0]).toBe('SUNDAY');
        expect(SCHOOL_DAY_ENUM[4]).toBe('THURSDAY');
        expect(SCHOOL_DAY_ENUM.length).toBe(7);
    });

    it('THE RULE: toSchoolDayEnum maps a date to the stored value', () => {
        expect(toSchoolDayEnum(new Date('2026-03-01T12:00:00Z'))).toBe('SUNDAY');
        expect(toSchoolDayEnum(new Date('2026-03-02T12:00:00Z'))).toBe('MONDAY');
        expect(toSchoolDayEnum(new Date('2026-03-05T12:00:00Z'))).toBe('THURSDAY');
        expect(toSchoolDayEnum('nonsense')).toBeNull();
        expect(toSchoolDayEnum(null)).toBeNull();
    });

    it('THE RULE: the Malay list and the enum agree on order', () => {
        // Both are indexed by getDay(): index 0 is Sunday in both. Reordering one
        // without the other is how an off-by-one becomes a wrong weekday.
        expect(SCHOOL_DAY_NAMES_MS[0]).toBe('Ahad');
        expect(SCHOOL_DAY_NAMES_MS.length).toBe(SCHOOL_DAY_ENUM.length);
    });

    it('THE RULE: no screen compares a number to the day column', () => {
        // The exact shape that caused all three bugs: `Number(x.day_of_week)`
        // on the left of a comparison. Anything reading that column must go
        // through a name, not a number.
        const offenders: string[] = [];
        const files = [
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'src')),
            ...sourceFiles(join(ROOT, 'utils')),
        ];
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                if (/Number\(\s*\w+\.day_of_week\s*\)/.test(line)) {
                    offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}`);
                }
            });
        }
        expect(offenders, `number compared to a day-name column:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('THE RULE: no local numeric Mon-first day map survives', () => {
        // A second source of truth for day names is how the two conventions drift
        // apart. `1: 'Mon'` style maps must not exist; use branding.ts.
        const offenders: string[] = [];
        const files = [
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'src')),
            ...sourceFiles(join(ROOT, 'utils')),
        ];
        for (const file of files) {
            if (file.endsWith(join('branding.ts'))) continue; // the one definition
            const text = readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                if (/\{\s*1:\s*'Mon'/.test(line) || /\{\s*0:\s*'Sun'/.test(line)) {
                    offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 80)}`);
                }
            });
        }
        expect(offenders, `duplicate day-name maps:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('THE RULE: Friday and Saturday are the non-school days', () => {
        // The school week is Sunday to Thursday. `getDay()` gives Friday=5,
        // Saturday=6. A check excluding 0 (Sunday) excludes a real school day.
        const noon = (iso: string) => new Date(`${iso}T12:00:00Z`).getDay();
        expect(noon('2026-03-06')).toBe(5); // Friday
        expect(noon('2026-03-07')).toBe(6); // Saturday
        expect(noon('2026-03-01')).toBe(0); // Sunday  <- a SCHOOL day

        // No shipped file may treat Sunday as a weekend.
        const offenders: string[] = [];
        const files = [
            ...sourceFiles(join(ROOT, 'components')),
            ...sourceFiles(join(ROOT, 'lib')),
            ...sourceFiles(join(ROOT, 'src')),
            ...sourceFiles(join(ROOT, 'utils')),
        ];
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            text.split('\n').forEach((line, i) => {
                if (/(day|d)\s*===\s*0\s*\|\|\s*(day|d)\s*===\s*6/.test(line)) {
                    offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 80)}`);
                }
            });
        }
        expect(offenders, `Sunday treated as a weekend:\n${offenders.join('\n')}`).toEqual([]);
    });
});
