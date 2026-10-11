import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * GUARD FOR AUDIT F27 — a screen may not depend on a server that is not there.
 *
 * THE DEFECT. The app is served as static files; there is no Express API in
 * production, and `/api` rewrites to `index.html`. So a screen that calls the
 * legacy client gets HTML back instead of JSON and fails.
 *
 * What made this hard to see is that the screens do not crash. They were written
 * defensively — `catch { /* non-fatal *\/ }`, a guard that returns early when a
 * `schoolId` is missing, an empty array on error — so a broken screen looked
 * exactly like a screen with nothing to show. A teacher's dashboard reported zero
 * students and an empty timetable, which is a perfectly plausible answer.
 *
 * WHY THIS IS A SOURCE CHECK. The API is reachable from hundreds of files and the
 * migration will take several passes. A behavioural test can only pin the screens
 * that happen to have one. This names the ones that are actually reachable, so the
 * list can only get shorter — and adding a new dependency fails immediately.
 *
 * The screens listed here are the ones the audit is still working through. As each
 * is moved onto Supabase, remove it from the list; the assertion below is that the
 * list does not GROW.
 */

const ROOT = process.cwd();

/**
 * Reachable teacher screens still to migrate.
 *
 * Each one is a known outstanding item under F27, not a licence to add more.
 */
const STILL_TO_MIGRATE = [
    // EMPTY, and that is the finding closed. Every screen the audit listed has
    // either been moved onto Supabase or — where the school keeps no such records
    // at all — replaced by one that says so. The assertion below fails if anything
    // appears here again, which is what would happen if a screen were put back on
    // the undeployed client.
];


/**
 * Screens that must NOT reach for the legacy client.
 *
 * Two kinds are listed here together, because the rule is the same for both.
 *
 * MIGRATED: the screen reads and writes through Supabase.
 *
 * NOT BUILT YET: the screen needed records this school does not keep — there is no
 * table for them — so it now says so plainly instead of showing a raw request
 * failure. A teacher reading "this part is not built yet" is being told the truth;
 * reading a failed request, or a blank screen that looks like an empty list of real
 * records, is not. Those files are small and import ComingSoonScreen.
 */
const MIGRATED = [
    // The first screen after a teacher logs in.
    'components/teacher/TeacherOverview.tsx',
    // Every class tile leads here, and from here to the register.
    'components/teacher/ClassDetailScreen.tsx',
    // The teacher's own duties, opened from the dashboard.
    'components/teacher/TeacherAssignmentsListScreen.tsx',
    // A teacher's own attendance: check in, check out, read the month.
    'components/teacher/TeacherSelfAttendance.tsx',
    'components/teacher/TeacherAttendanceHistoryScreen.tsx',
    // Exams: the teacher's list, the office's list, and the shared form.
    'components/teacher/TeacherExamManagement.tsx',
    'components/admin/ExamManagement.tsx',
    'components/admin/AddExamScreen.tsx',
    // A teacher's reports for a class: averages from the marks, attendance from
    // the register, both read rather than estimated.
    'components/teacher/TeacherReportsScreen.tsx',
    // The office's audit trail, on the one screen whose whole purpose is to show
    // that something happened — so an empty trail was indistinguishable from none.
    'components/admin/AuditLogScreen.tsx',
    // Settings screens. Each one used to send the WHOLE settings object it had
    // read at page load, so a save silently reverted any setting another screen
    // had changed since — and `merge_school_settings` is what stops that.
    'components/admin/BrandingSettingsScreen.tsx',
    'components/admin/CommunicationSettingsScreen.tsx',
    'components/admin/CalendarManager.tsx',
    'components/admin/SecuritySettingsScreen.tsx',
    'components/admin/AcademicSettingsScreen.tsx',
    'components/admin/CurriculumManagementScreen.tsx',
    // Changing a password. All four screens posted to an endpoint that is not
    // deployed, so nobody could change their password at all — and the shared
    // function re-checks the current one, which is what stops an unlocked laptop
    // being used to lock the owner out.
    'components/admin/ChangePasswordScreen.tsx',
    'components/teacher/TeacherChangePasswordScreen.tsx',
    'components/parent/ParentChangePasswordScreen.tsx',
    'components/student/StudentChangePasswordScreen.tsx',
    // Report selectors. A class is not a subject, and a school that is one school
    // has no branch to filter by.
    'components/admin/AdminSelectTermForReport.tsx',
    'components/admin/AdminSelectClassForReport.tsx',
    'components/admin/AdminResultsEntrySelector.tsx',
    // The class gradebook, and the mark-entry screen it sends you to.
    'components/teacher/ClassGradebookScreen.tsx',
    'components/teacher/GradeEntryScreen.tsx',
    // Not built yet. Each needed records this school does not keep, so the screen
    // now says so rather than failing a request.
    'components/teacher/MySOPCasesScreen.tsx',
    'components/teacher/MyObservations.tsx',
    'components/teacher/TeacherAppointmentsScreen.tsx',
    'components/teacher/SubstituteAssignment.tsx',
    'components/teacher/VirtualClassScreen.tsx',
    'components/teacher/MyAtRiskStudents.tsx',
    'components/teacher/HelpSupportScreen.tsx',
    'components/teacher/ReportMaintenanceIssue.tsx',
    'components/shared/StudentGateScreen.tsx',
    'components/teacher/LessonPlannerScreen.tsx',
    'components/teacher/LessonNotesUploadScreen.tsx',
    'components/teacher/ScanClassroomScreen.tsx',
    'components/teacher/AssignmentSubmissionsScreen.tsx',
    'components/teacher/MyClassHubScreen.tsx',
    'components/teacher/TeacherSettingsScreen.tsx',
    // The register, marked every morning.
    'components/teacher/TeacherAttendanceScreen.tsx',
    // The hooks every teacher screen is built on.
    'hooks/useTeacherClasses.ts',
    'hooks/useTeacherStats.ts',
];

function importsLegacyApi(file: string): boolean {
    const source = readFileSync(join(ROOT, file), 'utf8');
    return /from '[^']*lib\/api'/.test(source) || /import\('[^']*lib\/api'\)/.test(source);
}

describe('F27: reachable screens do not depend on the undeployed API', () => {
    it('the screens already migrated stay migrated', () => {
        const regressed = MIGRATED.filter((f) => existsSync(join(ROOT, f)) && importsLegacyApi(f));

        expect(
            regressed,
            'these screens were moved onto Supabase and now reach for the legacy /api '
            + 'client again. There is no Express server in production: the request returns '
            + 'index.html instead of JSON:\n'
            + regressed.map((f) => `  ${f}`).join('\n'),
        ).toEqual([]);
    });

    it('the outstanding list only shrinks', () => {
        const stillMigrated = STILL_TO_MIGRATE.filter((f) => !importsLegacyApi(f));

        expect(
            stillMigrated,
            'these screens no longer use the legacy client, so they should be removed from '
            + 'STILL_TO_MIGRATE and added to MIGRATED. Keeping a finished screen on the list '
            + 'means the list stops describing reality:\n'
            + stillMigrated.map((f) => `  ${f}`).join('\n'),
        ).toEqual([]);
    });

    it('the list is a real list of files', () => {
        // A typo in a path would make the filter above silently pass.
        const missing = [...STILL_TO_MIGRATE, ...MIGRATED].filter((f) => !existsSync(join(ROOT, f)));
        expect(missing, `these paths do not exist: ${missing.join(', ')}`).toEqual([]);
    });

    it('the overview does not silently return when a school id is missing', () => {
        // The specific shape of the bug: correct-looking code, gated on a field
        // that is null for every real user.
        // Comments stripped: the fix's own explanation quotes the guard it removed,
        // and matching against the prose would fail on the correct code.
        const overview = readFileSync(join(ROOT, 'components/teacher/TeacherOverview.tsx'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        expect(
            overview,
            'a guard that returns when schoolId is missing never runs for a real SRIK '
            + 'teacher, because no record carries a school id. The dashboard then renders '
            + 'its empty state as though there were simply nothing to show',
        ).not.toMatch(/if\s*\(\s*!actualSchoolId/);
    });
});

/**
 * The screens that were replaced rather than migrated must say so, and must not
 * pretend to hold data.
 */
describe('F27: screens for features this school does not have', () => {
    const NOT_BUILT = [
        'components/teacher/MySOPCasesScreen.tsx',
        'components/teacher/MyObservations.tsx',
        'components/teacher/TeacherAppointmentsScreen.tsx',
        'components/teacher/SubstituteAssignment.tsx',
        'components/teacher/VirtualClassScreen.tsx',
        'components/teacher/MyAtRiskStudents.tsx',
        'components/teacher/HelpSupportScreen.tsx',
        'components/teacher/ReportMaintenanceIssue.tsx',
        'components/shared/StudentGateScreen.tsx',
        'components/teacher/LessonPlannerScreen.tsx',
        'components/teacher/LessonNotesUploadScreen.tsx',
        'components/teacher/ScanClassroomScreen.tsx',
        'components/teacher/AssignmentSubmissionsScreen.tsx',
        'components/teacher/MyClassHubScreen.tsx',
        'components/teacher/TeacherSettingsScreen.tsx',
    ];

    it('each one says the feature is not built, rather than failing a request', () => {
        for (const rel of NOT_BUILT) {
            const src = readFileSync(join(ROOT, rel), 'utf8');
            expect(src, `${rel} no longer says why it has nothing to show`).toMatch(
                /ComingSoonScreen/,
            );
            // And it explains itself. A screen that only says "not available"
            // leaves the teacher wondering whether they did something wrong.
            expect(src, `${rel} shows no explanation`).toMatch(/explanation=/);
        }
    });

    it('each one holds no data of its own', () => {
        for (const rel of NOT_BUILT) {
            const src = readFileSync(join(ROOT, rel), 'utf8');
            // No state, no fetching, no records. A "coming soon" screen that had
            // kept its data layer would still be a screen that cannot work, with a
            // nicer message on top.
            expect(src, `${rel} still fetches data`).not.toMatch(/useState|useEffect/);
            expect(src, `${rel} still calls something`).not.toMatch(/api\./);
            // Not faked either: pre-filled rows would read as real records.
            expect(src, `${rel} hard-codes sample rows`).not.toMatch(/const\s+\w+\s*=\s*\[\s*\{/);
        }
    });

    it('the outstanding list is empty', () => {
        // This is the audit finding closed. Anything appearing here means a screen
        // was put back on the undeployed client.
        expect(STILL_TO_MIGRATE).toEqual([]);
    });
});
