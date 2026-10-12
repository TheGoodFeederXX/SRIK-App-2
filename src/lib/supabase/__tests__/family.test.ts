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
    'components/parent/ParentTodayWidget.tsx',
    'components/parent/ReportCardScreen.tsx',
    'components/student/AttendanceScreen.tsx',
    'components/admin/AdminDashboard.tsx',
    'components/parent/AppointmentScreen.tsx',
    'components/auth/InviteAcceptScreen.tsx',
    'components/teacher/ReportCardInputScreen.tsx',
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

    it('shows a parent today, and says so when the register has not been taken', () => {
        const src = code(read('components/parent/ParentTodayWidget.tsx'));

        // The day's status comes from the real register.
        expect(src).toMatch(/getClassRegister/);
        expect(src).toMatch(/listMyChildren/);

        // NOT MARKED IS NOT ABSENT. A parent at the gate must be able to tell "the
        // register is not in yet" from "your child was away". A screen that defaults to
        // absent is making a false accusation.
        //
        // The assertion is on the DEFAULT the code assigns, not merely on the word
        // `not_marked` appearing: the type declaration contains that word too, so
        // checking for it let a mutation that defaulted to 'present' pass straight
        // through. A check that matches the type instead of the behaviour is not a guard.
        expect(src, 'the day does not start as unmarked')
            .toMatch(/attendance_status']\s*=\s*'not_marked'/);
        expect(src, "'Not taken yet' is not shown to the parent")
            .toMatch(/Not taken yet/);

        // Homework pending, fees due, bus status and behaviour points all had no table.
        for (const ghost of ['homework_pending', 'bus_status', 'behavior_points', 'fee_due']) {
            expect(src, `the widget shows \`${ghost}\`, which no column backs`)
                .not.toMatch(new RegExp(`\\b${ghost}\\b`));
        }
    });

    it('does not promise a parent an e-learning progress screen that does not exist', () => {
        const src = read('components/parent/LearningHubProgressScreen.tsx');

        // There is no learning-hub table and no topic progress. The screen used to show
        // zeroes, which a parent could only read as "my child has done nothing".
        expect(src).toMatch(/ComingSoonScreen/);
        expect(src, 'the old fabricated figures are still rendered')
            .not.toMatch(/getStudentLearningHubSummary|api\./);
    });

    it('tells the report card screen the whole point of a report card: it shows WHO said what, and only once', () => {
        const src = code(read('components/parent/ReportCardScreen.tsx'));

        // A parent does NOT get live figures here. A published report card is a frozen
        // snapshot — that is what publishing means. Live reads would let a card printed
        // in March disagree with the same card in June, with no record of which the
        // school actually issued.
        expect(src).toMatch(/getReportSnapshot/);
        expect(src, 'the screen reads live assessment results instead of the frozen card')
            .not.toMatch(/assessment_results|getMarkRegister/);

        // A mark of null is "not marked", NOT zero. Turning it into 0 reads as a real
        // score and drags the child's average down.
        expect(src, 'a missing mark is not kept as null')
            .toMatch(/score \?\? null/);
    });

    it('a student reads their own record, and the id never comes from the URL', () => {
        const src = code(read('components/student/AttendanceScreen.tsx'));

        // Their own record by default, through the session.
        expect(src).toMatch(/getMyStudentId/);
        expect(src).toMatch(/getStudentAttendanceRange/);

        // And the window is the school's YEAR, not a calendar month. Counting days the
        // school was closed shows a child as absent when no register was taken.
        expect(src).toMatch(/getCurrentAcademicYear/);
    });

    it('an invitation link actually signs the person in', () => {
        const auth = code(read('src/lib/supabase/auth.ts'));
        const screen = code(read('components/auth/InviteAcceptScreen.tsx'));

        // A session has to be MINTED, not merely stored. The screen used to put the raw
        // tokens in sessionStorage and call it done, so the next screen found no signed-in
        // user and bounced a freshly invited person back to sign-in.
        expect(auth).toMatch(/acceptInviteSession/);
        expect(auth).toMatch(/setSession/);
        expect(screen).toMatch(/acceptInviteSession\(/);
        expect(screen, 'the screen still fakes a session with raw tokens')
            .not.toMatch(/sessionStorage\.setItem\('auth_token'/);
    });

    it('does not edit a published report card, and does not offer a GPA the school does not use', () => {
        const screen = code(read('components/teacher/ReportCardInputScreen.tsx'));

        // `report_cards` is a frozen snapshot produced by publishing an assessment. An
        // editor that writes to it would destroy the record of what the school issued.
        expect(screen, 'a screen still writes to the report card table')
            .not.toMatch(/upsertReportCard|from\('report_cards'\)/);
        // Marks are entered per assessment. The menu is where that happens.
        expect(screen).toMatch(/Penilaian/);
    });

    it('does not offer to book a meeting the school cannot receive', () => {
        const src = code(read('components/parent/AppointmentScreen.tsx'));

        // There is no appointments table. The old flow confirmed a booking that no teacher
        // would ever see — a parent would arrive at the school having booked nothing.
        expect(src, 'the appointment screen can confirm a booking again')
            .not.toMatch(/createAppointment|getTeacherAvailability/);
        expect(src).toMatch(/ComingSoonScreen/);
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
