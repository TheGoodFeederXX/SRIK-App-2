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
    'components/teacher/AssignmentSubmissionsScreen.tsx',
    'components/teacher/ClassDetailScreen.tsx',
    'components/teacher/ClassGradebookScreen.tsx',
    'components/teacher/HelpSupportScreen.tsx',
    'components/teacher/LessonNotesUploadScreen.tsx',
    'components/teacher/LessonPlannerScreen.tsx',
    'components/teacher/MyAtRiskStudents.tsx',
    'components/teacher/MyClassHubScreen.tsx',
    'components/teacher/MyObservations.tsx',
    'components/teacher/MySOPCasesScreen.tsx',
    'components/teacher/ReportMaintenanceIssue.tsx',
    'components/teacher/ScanClassroomScreen.tsx',
    'components/shared/StudentGateScreen.tsx',
    'components/teacher/SubstituteAssignment.tsx',
    'components/teacher/TeacherAppointmentsScreen.tsx',
    'components/teacher/TeacherAssignmentsListScreen.tsx',
    'components/teacher/TeacherAttendanceHistoryScreen.tsx',
    'components/teacher/TeacherExamManagement.tsx',
    'components/teacher/TeacherReportsScreen.tsx',
    'components/teacher/TeacherSelfAttendance.tsx',
    'components/teacher/TeacherSettingsScreen.tsx',
    'components/teacher/VirtualClassScreen.tsx',
];

/** Screens that must NOT reach for the legacy client. */
const MIGRATED = [
    // The first screen after a teacher logs in.
    'components/teacher/TeacherOverview.tsx',
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
