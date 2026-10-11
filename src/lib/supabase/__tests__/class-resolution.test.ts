import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * GUARD FOR AUDIT F23/F24/F25 — which class a child is in must be asked once, in
 * the database.
 *
 * THE DEFECT. "What class is this student in" is not a field on the student. It is
 * derived from `student_enrollments`, and every screen answered it itself by
 * filtering `ended_at is null`. That filter is ambiguous the moment a child is
 * promoted: they have one open row per year, and the answer becomes whichever row
 * the database returns first.
 *
 * Three things broke, and none of them look like a class problem:
 *   - the student record would not open at all, because it read with `maybeSingle()`
 *     and two rows is an error there;
 *   - a register for a date last term resolved against today's placement;
 *   - a published 2026 report card named the 2027 class against 2026 marks.
 *
 * WHY A SOURCE CHECK. The bug is not in one function; it is the same query written
 * out ten times. A behavioural test would pin the screens that exist today and miss
 * the eleventh, which someone adds next week by copying the tenth. This fails at
 * the moment the copy is written.
 *
 * The database now offers `class_on` (one child) and `classes_on` (a list). This
 * requires callers to use them.
 */

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'src/lib/supabase');

function dataModules(): string[] {
    return readdirSync(DATA_DIR)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.startsWith('__'))
        .map((f) => join(DATA_DIR, f));
}

function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('F23/F24/F25: class resolution goes through the database rule', () => {
    it('no module resolves a class by filtering ended_at alone', () => {
        const offenders: string[] = [];

        for (const file of dataModules()) {
            const source = code(readFileSync(file, 'utf8'));
            const lines = source.split('\n');

            lines.forEach((line, i) => {
                if (!/student_enrollments/.test(line)) return;

                // The query this finding is about: read enrollments, keep the open
                // ones, and treat that as the current class.
                const chain = lines.slice(i, i + 10).join('\n');
                const opensOnly =
                    /ended_at['"]?,\s*null\)/.test(chain) || /ended_at is null/.test(chain);

                if (opensOnly && !/class_on|classes_on/.test(chain)) {
                    offenders.push(
                        `${file.replace(ROOT + '/', '')}:${i + 1}: ${line.trim().slice(0, 80)}`,
                    );
                }
            });
        }

        expect(
            offenders,
            'these reads treat "ended_at is null" as "current class". That is ambiguous '
            + 'after a promotion — a child has one open row per year — and it is wrong '
            + 'for any date other than today. Use the class_on / classes_on functions:\n'
            + offenders.map((o) => `  ${o}`).join('\n'),
        ).toEqual([]);
    });

    it('the student read uses class_on, not maybeSingle over enrollments', () => {
        const students = code(readFileSync(join(DATA_DIR, 'students.ts'), 'utf8'));

        expect(
            students,
            'the student list must resolve classes through the database rule',
        ).toMatch(/rpc\('classes_on'/);

        expect(
            students,
            'the single student read must resolve the class through the database rule',
        ).toMatch(/rpc\('class_on'/);

        // `maybeSingle` on an enrollment query is the exact failure: two rows is an
        // error, so the record stops opening for every promoted child.
        expect(
            students,
            'a maybeSingle over student_enrollments is what made promoted childrens\' '
            + 'records refuse to open — it errors when it is handed two rows',
        ).not.toMatch(/student_enrollments[\s\S]{0,200}maybeSingle\(\)/);
    });
});
