import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * GUARD FOR AUDIT FINDING F28 — the second half: silent truncation at 1,000 rows.
 *
 * THE FINDING. PostgREST caps a single response, and nothing in these modules asked
 * for less than everything. So a reader written as "give me all the students" quietly
 * returns the first 1,000 and the screen shows a complete-looking list that is
 * missing people. Nobody sees an error; the school simply has fewer students than it
 * has.
 *
 * The arithmetic that makes this real rather than theoretical: ~250 students times
 * five school days is already 1,250 attendance rows for one week. A few months of
 * charges passes it comfortably. The cap is not a limit the school can avoid by
 * having a smaller school — it is reachable in a single term.
 *
 * WHY A SOURCE CHECK RATHER THAN A RUNNING TEST.
 *
 * The failure is invisible: the code returns a valid, non-empty list. To catch it at
 * runtime a test would have to insert 1,001 rows into every table a reader touches
 * and then notice that the length is 1000 — which is a slow test that only guards the
 * readers someone remembered to write it for.
 *
 * This instead reads the modules and requires that a reader which RETURNS A LIST
 * either states a limit it is happy with, or pages. A new unpaginated reader added
 * later fails here at the moment it is written, which is when it is cheap to fix.
 *
 * The rule is deliberately about RETURNING A LIST. `maybeSingle()`, a `.limit(1)`
 * lookup, and a count all fetch a bounded number of rows by construction and are
 * exempt — a test that flagged them would be noise, and would be switched off.
 */

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'src/lib/supabase');

/** Every module that talks to the database directly. */
function dataModules(): string[] {
    return readdirSync(DATA_DIR)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .filter((f) => !f.startsWith('__'))
        .map((f) => join(DATA_DIR, f))
        .filter((f) => statSync(f).isFile());
}

/** Comments removed, so a rule quoted in prose is not mistaken for the rule. */
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('F28: list readers cannot silently stop at 1,000 rows', () => {
    it('has data modules to check, so a green result means something', () => {
        const mods = dataModules();
        expect(
            mods.length,
            'no data modules were found — this guard would pass while checking nothing',
        ).toBeGreaterThan(5);
    });

    it('every reader that returns a list is paged or explicitly bounded', () => {
        const offenders: string[] = [];

        for (const file of dataModules()) {
            const source = code(readFileSync(file, 'utf8'));
            const lines = source.split('\n');

            lines.forEach((line, i) => {
                if (!/\.select\(/.test(line)) return;

                // A window of the following lines: the modifiers that bound this
                // select are chained below it, and a call may be split across lines.
                //
                // 30 rather than 12, and the difference was found by mutation testing.
                // The `.select(...)` for the family's charges lists thirteen columns
                // before the `.eq(...)` that follows, so a 12-line window ended before
                // reaching the bound — and removing the bound passed. A window too
                // small to see the fix is a window too small to see the defect.
                const chain = lines.slice(i, i + 30).join('\n');

                const bounded =
                    /\.range\(/.test(chain) ||          // explicit paging
                    /\.limit\(\s*\d+\s*\)/.test(chain) || // a stated ceiling
                    /maybeSingle\(\)/.test(chain) ||    // exactly one row
                    /\.single\(\)/.test(chain) ||       // exactly one row
                    /head:\s*true/.test(chain) ||       // a count, no rows
                    /count:\s*'exact'/.test(chain);     // a count, no rows

                if (!bounded) {
                    offenders.push(
                        `${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 90)}`,
                    );
                }
            });
        }

        expect(
            offenders,
            'these reads return a list without paging or a limit. PostgREST caps a '
            + 'response at 1,000 rows, so each one silently drops the rest — the screen '
            + 'shows a complete-looking list that is missing people, with no error:\n'
            + offenders.map((o) => `  ${o}`).join('\n'),
        ).toEqual([]);
    });

    it('the bulk balance reader is a single request, not one per charge', () => {
        // The other half of F28, asserted where it is written. The original called
        // one RPC per charge in a Promise.all, which is a few hundred round trips for
        // a family's list.
        const finance = code(readFileSync(join(DATA_DIR, 'finance.ts'), 'utf8'));

        expect(
            finance,
            'chargeBalances must use the bulk function; one RPC per charge is a few '
            + 'hundred round trips and the page waits for the slowest',
        ).toMatch(/charge_paid_amounts/);

        expect(
            finance,
            'chargeBalances must not call the single-charge function per id',
        ).not.toMatch(/chargeIds\.map\([\s\S]{0,200}charge_paid_amount\b(?!s)/);
    });
});
