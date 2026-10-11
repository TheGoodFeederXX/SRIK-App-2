import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * GUARD FOR AUDIT FINDING F27 — the parent portal.
 *
 * THE FINDING. Every parent screen asked an Express server that is not deployed for
 * `getMyChildren`, `getMyParentProfile` and the rest. The one part of this system a
 * family actually uses could not show a single thing.
 *
 * WHY THIS CHECKS SOURCE AND NOT BEHAVIOUR. The scoping rules that make this safe are
 * database policies, not JavaScript. `listMyChildren` is only correct because
 * `students_select_guardian` allows a row exactly when `is_guardian_of(id)`. A unit
 * test with a mocked client would assert that the mock returns what I told it to,
 * which proves nothing about who can see whose child. Those rules are guarded in SQL
 * (`phase5b_guardian_access_test.sql`), and the checks here are the client-side half:
 * that the client does not pass a guardian id, and that it does not resurrect the
 * legacy client.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments stripped, so a rule quoted in prose is not mistaken for the rule. */
const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const MODULE = 'src/lib/supabase/family.ts';
const SCREENS = [
    'components/parent/AlertsScreen.tsx',
    'components/parent/LinkChildScreen.tsx',
    'components/parent/SelectChildForReportScreen.tsx',
    'components/parent/ParentDashboard.tsx',
];

describe('F27: the parent portal reads the family from the session, not a parameter', () => {
    it('never takes a guardian id from the caller', () => {
        const src = code(read(MODULE));

        // A guardian id in a signature is a value the browser chose. The name a parent
        // could change is exactly the thing this module exists to remove.
        expect(
            src.match(/guardianId\s*:/),
            'family.ts accepts a guardianId — the scope would come from the caller',
        ).toBeNull();
        expect(src).not.toMatch(/export async function listMyChildren\(\s*\w/);

        // And it must not read the guardian's identity from anywhere but the session.
        expect(src).toMatch(/auth\.getUser\(\)/);
    });

    it('reads the family link, and the child through the guarded table', () => {
        const src = code(read(MODULE));
        // The relationship lives on the LINK table, not on `guardians`.
        expect(src).toMatch(/from\('student_guardians'\)/);
        // And the child is read through `listStudents`, so the guardian policy applies.
        expect(src).toMatch(/listStudents/);
    });

    it('does not call the legacy client', () => {
        for (const f of [MODULE, ...SCREENS]) {
            const src = code(read(f));
            expect(
                src,
                `${f} still imports lib/api`,
            ).not.toMatch(/from\s+['"][^'"]*\/lib\/api['"]/);
        }
    });

    it('a parent is told the office owns adding and removing a child', () => {
        const src = read('components/parent/LinkChildScreen.tsx');

        // Both statements must not merely be DECLARED but SHOWN, and shown in the right
        // handler. Asserting only that the constant name appears somewhere passes while
        // the warning is defined and never used — which is exactly what a first attempt
        // at this check did: deleting the unlink message still passed, because the name
        // survived in its own declaration.
        const declarations = (src.match(/^const (ADD|UNLINK)_IS_AN_OFFICE_ACTION/gm) ?? []);
        expect(declarations.length, 'a message is declared twice or not at all').toBe(2);

        // The add warning must be raised inside the add handler...
        const addHandler = src.slice(src.indexOf('const handleSubmit'), src.indexOf('const handleUnlinkClick'));
        expect(addHandler, 'the ADD warning is never shown to the parent')
            .toMatch(/toast\.[a-z]+\(ADD_IS_AN_OFFICE_ACTION/);

        // ...and the unlink warning inside the unlink handler.
        const unlinkHandler = src.slice(src.indexOf('const confirmUnlink'));
        expect(unlinkHandler, 'the REMOVE warning is never shown to the parent')
            .toMatch(/toast\.[a-z]+\(UNLINK_IS_AN_OFFICE_ACTION/);

        // And it must not import the linking service back in, which would let a later
        // change wire the button up without anyone deciding it should be live.
        expect(src).not.toMatch(/linkStudentToParent/);
    });

    it('does not show a parent a screen for a feature this school has no record of', () => {
        const src = code(read('components/parent/ParentDashboard.tsx'));

        // Homework, submissions and behaviour notes have no tables. They are not
        // "loading" and not "empty because nothing is due" — the school does not keep
        // them. Each is set to an empty list with the reason beside it, and the check
        // is that they are EMPTY rather than fetched from somewhere.
        expect(src, 'assignments are fetched from nowhere').toMatch(
            /const assignmentsData: unknown\[\] = \[\];/,
        );
        expect(src, 'behaviour notes are fetched from nowhere').toMatch(/setNotes\(\[\]\)/);

        // And no invented column is read off a child — bare, quoted, or as a property.
        // The first version of this check only looked for a trailing quote, so
        // `curriculum_type: c.student.curriculum_type,` slipped through: a check that
        // cannot see the defect is not a guard.
        for (const ghost of ['curriculum_type', 'school_generated_id', 'assigned_subjects', 'behavior_notes']) {
            expect(src, `the dashboard reads \`${ghost}\`, which no column backs`)
                .not.toMatch(new RegExp(`['\\.]${ghost}\\b|\\b${ghost}\\s*:`));
        }
    });

    it('shows a parent the school\'s notices, not a notification system that does not exist', () => {
        const src = code(read('components/parent/AlertsScreen.tsx'));

        // There is no `notifications` table and no socket feed. Reading the school's
        // own announcements is what a parent can actually be shown.
        expect(src).toMatch(/listAnnouncements/);

        // Only PUBLISHED notices. A draft is the office still writing, and a withdrawn
        // one was taken back — showing either would be showing a parent something the
        // school did not send.
        expect(src, 'the screen does not filter to published notices')
            .toMatch(/status === 'PUBLISHED'/);

        // And no invented read-state, which would need per-parent tracking this schema
        // does not have. A dot derived from nothing reappears on every device.
        for (const ghost of ['is_read', 'isRead', 'unread']) {
            expect(src, `the screen invents read-state via \`${ghost}\``)
                .not.toMatch(new RegExp(`\\b${ghost}\\b`));
        }
    });

    it('reads children without a school id, which does not exist', () => {
        const src = code(read(MODULE));
        // SRIK is one school. There is no `school_id` or `branch_id` column, and a
        // filter on one would silently match nothing.
        expect(src).not.toMatch(/school_id|branch_id|schoolId/);
    });

    it('the guard can see the screens it checks', () => {
        // A guard that reads a path that has moved passes while checking nothing.
        for (const f of [MODULE, ...SCREENS]) {
            expect(read(f).length).toBeGreaterThan(500);
        }
    });
});
