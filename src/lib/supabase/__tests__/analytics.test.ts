/**
 * AUDIT F27 — the academic analytics screen.
 *
 * WHAT WAS WRONG. Every figure came from an Express endpoint that is not deployed, so the
 * screen showed an empty chart and a GPA of 0.000 — a figure that reads as catastrophic
 * rather than as missing.
 *
 * THREE CLAIMS THE SCREEN MADE THAT NOTHING PRODUCED, and which this file exists to keep
 * out:
 *   * a GPA out of 4.0, on a scale where the school marks out of 100 and grades A-E;
 *   * a "Projected GPA (at current trend)" and an arrow comparing this term to the
 *     previous one, when no previous-term figures are stored. A forecast with no inputs;
 *   * a pass rate per subject and per class, when only the overall rate is computed.
 *
 * And one rule about EMPTINESS: a term with no published marks has NO pass rate. Showing
 * 0% tells the school its children all failed, when in truth nothing has been marked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
/** Comments explain the old behaviour by name; only executable code may be searched. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('academic analytics (F27)', () => {
    it('does not invent a GPA on a scale this school does not use', () => {
        const src = code(read('components/admin/AcademicAnalytics.tsx'));

        // The school marks out of 100 and grades A-E. A 4-point GPA is a number it has
        // never produced, and rendering it told the school something false.
        expect(src, 'the screen shows a GPA again').not.toMatch(/overallGPA|averageGPA|topPerformerGPA/);
        expect(src, 'the screen shows a GPA out of 4.0 again').not.toMatch(/out of 4\.0/);
    });

    it('does not forecast a trend it cannot measure', () => {
        const src = code(read('components/admin/AcademicAnalytics.tsx'));

        // "vs. previous term" needs last term's figures. None are stored.
        expect(src, 'the screen claims a comparison to a term it never read')
            .not.toMatch(/previous term|Projected GPA|projectedGPA|metrics\.improvement/);
    });

    it('reads real analytics from the database, not from a dead endpoint', () => {
        const src = code(read('components/admin/AcademicAnalytics.tsx'));

        expect(src).toMatch(/getAcademicAnalytics/);
        expect(src, 'the screen still calls the undeployed API').not.toMatch(/from '\.\.\/\.\.\/lib\/api'/);
        expect(src).toMatch(/getCurrentTerm/);
    });

    it('treats an unmarked term as having no pass rate, not a pass rate of zero', () => {
        // The database is where this is decided.
        const sql = read('supabase/migrations/20261025000007_academic_analytics.sql');

        // A pass rate is only computed when marks exist; otherwise null.
        expect(sql, 'the pass rate is computed without checking that marks exist')
            .toMatch(/'passRate',\s*case when \(select total from pass_marks\) > 0/);

        // And unmarked children must never be counted as a score of zero.
        expect(sql, 'unmarked children would be counted as scoring zero')
            .toMatch(/ar\.status = 'GRADED'/);

        // The pass band comes from the school's own scale, not a number I chose.
        expect(sql, 'the pass band is hard-coded instead of read from the school scale')
            .toMatch(/grade_boundaries/);

        // A guardian must not read school-wide analytics.
        expect(sql).toMatch(/has_permission\('reports\.view'\)/);
    });

    it('every figure the screen renders exists in the returned shape', () => {
        const src = code(read('components/admin/AcademicAnalytics.tsx'));
        const lib = code(read('src/lib/supabase/assessments.ts'));

        // The interface the reader promises...
        // The metrics block is nested, so take the whole interface text and look for the
        // field names wherever they are declared.
        const iface = lib.slice(lib.indexOf('export interface AcademicAnalytics'));
        const declared = [...iface.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);

        // ...contains every metric the screen names. A metric the screen reads but the
        // database never sends renders as `undefined` — which is how `passRate` and
        // `improvement` were shown before this was fixed.
        for (const field of ['passRate', 'marksCounted', 'topPerformer', 'topPerformerAverage', 'overallAverage']) {
            expect(declared, `the reader does not return ${field}`).toContain(field);
        }
        expect(src).toMatch(/metrics\.marksCounted/);
        expect(src).toMatch(/metrics\.overallAverage/);
    });
});
