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
        // Every `select(...)` in the module must be the counting form — with one
        // deliberate exception, checked explicitly rather than by loosening the rule.
        //
        // The exception is the current-year lookup: `.select('id').limit(1).maybeSingle()`.
        // That reads ONE row to obtain an id, and no count can express it. It cannot
        // under-report the way a row-fetch count can, because it is not counting
        // anything. Naming it here keeps the rule strict for everything else — a
        // blanket exemption would also excuse a real row-fetch count.
        const ID_LOOKUP = ".select('id')";
        const selects = stats.match(/\.select\([^)]*\)/g) ?? [];
        expect(selects.length, 'the module should issue at least one count').toBeGreaterThan(0);

        const counts = selects.filter((s) => s !== ID_LOOKUP);
        const fetching = counts.filter((s) => !/head:\s*true/.test(s) || !/count:\s*'exact'/.test(s));
        expect(
            fetching,
            'these selects fetch rows instead of counting them — PostgREST caps a ' +
            'response at 1000 rows, so the dashboard would silently under-report:\n' +
            fetching.map((s) => `  ${s}`).join('\n'),
        ).toEqual([]);

        // And the exception really is the single-row lookup it claims to be.
        const lookup = stats.slice(stats.indexOf(ID_LOOKUP));
        expect(
            lookup.slice(0, 120),
            'the one non-counting select must be a limited single-row lookup',
        ).toMatch(/limit\(1\)/);
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

    it('does NOT hide an unreadable figure as zero', () => {
        // THE DEFECT THIS REPLACES, and it is worth reading before editing it.
        //
        // The previous version of this test asserted `expect(stats).toMatch(/return 0;/)`
        // under the heading "does not let one failed count reject the whole
        // dashboard". It was passing, and it was WRONG. What it guaranteed was
        // that an unreadable count came back as 0 — and on a register of ~250
        // people, "0" is not a missing figure, it is a statement that the school has
        // no students. The tile cannot be told apart from an empty school, and the
        // `console.error` it also asserted is invisible to the person reading the
        // screen.
        //
        // So the test locked in the very failure the module exists to prevent: the
        // dashboard said "Total Staff 0" for a school with 18 teachers, and nothing
        // looked broken. A guard that encodes a defect as a requirement is worse
        // than no guard, because it defends the defect.
        //
        // The counts now reject. The screen can say the figures could not be
        // loaded, which is true.
        expect(stats).toMatch(/throw new StatsUnavailableError/);
        expect(stats).toMatch(/class StatsUnavailableError/);
        // And the null count is a failure too, not a zero: a missing count means
        // the request was malformed, which is our bug to see.
        expect(stats).toMatch(/the database returned no count/);

        // AN ERROR PATH MUST NOT END IN A ZERO.
        //
        // This is asserted by reading the error branch's own body, not by searching
        // the file for `return 0`. The first version of this check looked for the
        // pattern `return 0; } return n` and did NOT catch the defect when it was
        // put back — the mutation passed. A pattern that happens to match the right
        // code, and also happens not to match the wrong code, is not a guard.
        //
        // So the branch is located and its contents are inspected directly.
        const errorBranch = stats.slice(stats.indexOf('if (error) {'));
        const branchBody = errorBranch.slice(
            errorBranch.indexOf('{') + 1,
            errorBranch.indexOf('}'),
        );
        expect(
            branchBody,
            'the `if (error)` branch must not return a number — returning 0 here is ' +
            'exactly the defect: an unreadable figure is shown as a real zero, which ' +
            'nobody investigates because it looks like an answer',
        ).not.toMatch(/return\s+0/);
        expect(
            branchBody,
            'the error branch must throw or rethrow, so the failure reaches the screen',
        ).toMatch(/throw/);
    });

    it('scopes the class figure to the current academic year', () => {
        // `classes` carries an academic_year_id and next year's classes are created
        // while this year's still run, so counting every ACTIVE class grows the
        // figure every year until it reports twice the real number.
        expect(
            stats,
            'the class count must be scoped to the CURRENT academic year, or it ' +
            'doubles as soon as next year is set up',
        ).toMatch(/eq\('status',\s*'CURRENT'\)/);
        expect(stats).toMatch(/academic_year_id/);
        // The nested-filter form is refused by the API (PGRST108): a related table
        // cannot be filtered unless it is selected. Verified live, not assumed.
        expect(
            stats,
            'filtering through the embedded relation returns 400 from the API; the ' +
            'year must be resolved first',
        ).not.toMatch(/academic_years\.status/);
    });

    it('uses the Malaysian date, not the UTC one, for overdue charges', () => {
        // Malaysia is UTC+8, so for the first eight hours of every Malaysian day the
        // UTC date is still yesterday. `toISOString()` would mark a charge due today
        // as overdue and the office would chase the family a day early — in the
        // morning, when the reminders go out.
        expect(
            stats,
            'overdue must be judged against the Malaysian date; a UTC date is a day ' +
            'behind for the first eight hours of every school day',
        ).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
        // The school's own date helper, imported rather than reimplemented — a
        // second copy is a second thing that can disagree about which day it is.
        expect(stats).toMatch(/todayInKualaLumpur/);
    });
});
