/**
 * Guards the dashboard counts against the two ways they were wrong before.
 *
 * WHAT WENT WRONG.
 *
 * The dashboard read its figures from `api.getDashboardStats()`, an endpoint on
 * the legacy Express server this project no longer deploys. The request never
 * resolved, every tile kept its own fallback, and a school with 18 active
 * teachers displayed "Total Staff 0". Nothing looked broken — a wrong number is
 * believable in a way an error message is not.
 *
 * There were two distinct defects, and they need separate guards:
 *
 *   1. THE SOURCE. The counts must come from Supabase, not the removed server.
 *   2. THE METHOD. They must be counted, not fetched.
 *
 * WHY "COUNTED, NOT FETCHED" IS WORTH A TEST OF ITS OWN.
 *
 * `select('*')` and then reading `.length` looks equivalent and is not: PostgREST
 * caps a single response at 1000 rows, so past that the dashboard would silently
 * start under-reporting. The failure would arrive years later, on the day the
 * school grew, as a number that was quietly too small. `count: 'exact'` with
 * `head: true` asks the database for the figure and transfers no rows at all.
 *
 * The status filters are checked too, against the database's own enum. An
 * invented value such as 'UNPAID' is not an error the type system catches — it
 * simply matches nothing, so the overdue figure would read 0 while the school
 * chased families who owed nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The repository root, taken from the process working directory rather than
// `__dirname`. Vitest reports `__dirname` inconsistently for this file — it
// resolved one level too high, making the path read `src/src/...` and fail with
// ENOENT even though the source on disk was correct. `process.cwd()` is the repo
// root (confirmed: the `--dir` flag does not change it), so it is the reliable
// anchor.
const ROOT = process.cwd();

/**
 * Source with comments removed.
 *
 * Two of these tests assert on patterns that must be ABSENT — an invented
 * 'UNPAID' status, and a call to the removed legacy endpoint. Both appear in the
 * explanatory comments describing why they are wrong, so an unstripped read would
 * match its own documentation. Comments are not behaviour.
 */
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const stats = code(readFileSync(join(ROOT, 'src', 'lib', 'supabase', 'stats.ts'), 'utf8'));
const overview = code(
    readFileSync(join(ROOT, 'components', 'admin', 'DashboardOverview.tsx'), 'utf8'),
);

describe('dashboard counts', () => {
    it('every count asks the database for a count, never for rows', () => {
        // Every `select(...)` in the module must be the counting form.
        const selects = stats.match(/\.select\([^)]*\)/g) ?? [];
        expect(selects.length, 'the module should issue at least one count').toBeGreaterThan(0);

        const fetching = selects.filter((s) => !/head:\s*true/.test(s) || !/count:\s*'exact'/.test(s));
        expect(
            fetching,
            'these selects fetch rows instead of counting them — PostgREST caps a ' +
            'response at 1000 rows, so the dashboard would silently under-report:\n' +
            fetching.map((s) => `  ${s}`).join('\n'),
        ).toEqual([]);
    });

    it('uses the real charge status values, not invented ones', () => {
        // The database enum is OUTSTANDING, PARTIAL, PAID, WAIVED, CANCELLED.
        // Only the first two are money still owed.
        expect(stats).toMatch(/'OUTSTANDING'/);
        expect(stats).toMatch(/'PARTIAL'/);
        // 'UNPAID' is the plausible-looking name that is not in the enum. It would
        // match nothing and report zero overdue charges forever.
        expect(
            stats,
            "the charge status enum has no 'UNPAID' value — filtering on it matches " +
            'nothing and silently reports zero money owed',
        ).not.toMatch(/'UNPAID'/);
    });

    it('counts only students and staff who are actually on roll', () => {
        // A withdrawn student is not a student the school should be told it has.
        expect(stats).toMatch(/eq\('status',\s*'ACTIVE'\)/);
    });

    it('does not fall back to the removed legacy endpoint', () => {
        expect(
            overview,
            'the dashboard must not read counts from the legacy backend',
        ).not.toMatch(/getDashboardStats/);
    });

    it('reads the counts from the Supabase helper', () => {
        expect(overview).toMatch(/getDashboardCounts/);
        expect(overview).toMatch(/from '\.\.\/\.\.\/src\/lib\/supabase\/stats'/);
    });

    it('does not let one failed count reject the whole dashboard', () => {
        // The counts resolve in parallel. A rejected Promise.all would blank every
        // tile because one table was unreadable, so each count returns a number.
        expect(stats).toMatch(/return 0;/);
        expect(stats).toMatch(/console\.error/);
    });
});
