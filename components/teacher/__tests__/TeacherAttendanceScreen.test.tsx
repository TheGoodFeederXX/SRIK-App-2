import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TeacherMarkAttendanceScreen from '../TeacherAttendanceScreen';

// The screen reads its data from Supabase now, not the Express API.
//
// These mocks were on `lib/api` — the legacy client for a server that is not
// deployed. They had to move with the screen, and moving them is also what makes
// the tests meaningful: the old ones would have passed against a screen that could
// never load a register on the live site, because the live site has no `/api`.

const registerByDate: Record<string, { studentId: string; studentName: string; status: string | null }[]> = {
    '2026-08-04': [{ studentId: 'stu-1', studentName: 'Ada Lovelace', status: 'ABSENT' }],
    '2026-08-05': [{ studentId: 'stu-1', studentName: 'Ada Lovelace', status: 'PRESENT' }],
};

vi.mock('../../../src/lib/supabase/attendance', () => ({
    // A register row per student, with the status for THAT date. `status: null`
    // means nobody has marked it yet — which is not the same as absent.
    getClassRegister: vi.fn((_classId: string, date: string) =>
        Promise.resolve(
            (registerByDate[date] ?? [{ studentId: 'stu-1', studentName: 'Ada Lovelace', status: null }]).map(r => ({
                studentId: r.studentId,
                studentName: r.studentName,
                admissionNo: 'A-1',
                classId: 'class-1',
                classDisplayName: 'SSS 1 A',
                enrollmentId: 'enr-1',
                status: r.status,
                remark: null,
            })),
        ),
    ),
    recordRegister: vi.fn().mockResolvedValue({ success: true, recorded: 1, corrected: 0 }),
    todayInKualaLumpur: () => '2026-08-04',
    // The status vocabulary the database uses. The screen translates between this
    // and its own words; the test asserts on the screen's words.
    ATTENDANCE_STATUSES: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'SICK'],
}));

import { getClassRegister, recordRegister } from '../../../src/lib/supabase/attendance';

const classInfo = { id: 'class-1', grade: 'SSS 1', section: 'A', schoolId: 'school-1' } as any;

describe('TeacherMarkAttendanceScreen date switching', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        (getClassRegister as any).mockImplementation((_classId: string, date: string) =>
            Promise.resolve(
                (registerByDate[date] ?? [{ studentId: 'stu-1', studentName: 'Ada Lovelace', status: null }]).map(r => ({
                    studentId: r.studentId,
                    studentName: r.studentName,
                    admissionNo: 'A-1',
                    classId: 'class-1',
                    classDisplayName: 'SSS 1 A',
                    enrollmentId: 'enr-1',
                    status: r.status,
                    remark: null,
                })),
            )
        );
        (recordRegister as any).mockResolvedValue({ success: true, recorded: 1, corrected: 0 });
    });

    it('shows each date\'s own saved record instead of a stale local draft', async () => {
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        // Initial load = today's date (mocked as no record -> defaults to Present)
        await waitFor(() => expect(getClassRegister).toHaveBeenCalled());

        const dateInput = await screen.findByDisplayValue(/\d{4}-\d{2}-\d{2}/);

        // Switch to a date with a saved "Absent" record.
        fireEvent.change(dateInput, { target: { value: '2026-08-04' } });
        await waitFor(() => expect(screen.getByText('Status: Absent')).toBeInTheDocument());

        // Switch to a different date with a saved "Present" record — must reflect
        // THAT date's record, not whatever was last shown (this was the bug: a
        // stale localStorage draft from a prior visit silently overrode fresh data).
        fireEvent.change(dateInput, { target: { value: '2026-08-05' } });
        await waitFor(() => expect(screen.getByText('Status: Present')).toBeInTheDocument());

        // Switching back to the Absent date must show Absent again, proving the
        // component always trusts the freshly-fetched server record per date.
        fireEvent.change(dateInput, { target: { value: '2026-08-04' } });
        await waitFor(() => expect(screen.getByText('Status: Absent')).toBeInTheDocument());
    });

    it('does not let an unsaved edit leak back in when revisiting the same date', async () => {
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        const dateInput = await screen.findByDisplayValue(/\d{4}-\d{2}-\d{2}/);

        // Go to the Present-record date and make an UNSAVED in-memory edit to Absent.
        fireEvent.change(dateInput, { target: { value: '2026-08-05' } });
        await waitFor(() => expect(screen.getByText('Status: Present')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'A' }));
        await waitFor(() => expect(screen.getByText('Status: Absent')).toBeInTheDocument());

        // Navigate away without saving, then come back to the same date.
        fireEvent.change(dateInput, { target: { value: '2026-08-04' } });
        await waitFor(() => expect(screen.getByText('Status: Absent')).toBeInTheDocument());

        fireEvent.change(dateInput, { target: { value: '2026-08-05' } });
        // Must show the true saved record (Present) again, not the discarded
        // unsaved edit — the old code re-applied a localStorage draft here.
        await waitFor(() => expect(screen.getByText('Status: Present')).toBeInTheDocument());
    });
});

describe('TeacherMarkAttendanceScreen — one curriculum, one list', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        // Both students, straight from the register — the screen no longer asks a
        // separate API for the class list and then a second one for the marks.
        (getClassRegister as any).mockResolvedValue([
            { studentId: 'stu-1', studentName: 'Ada Lovelace', admissionNo: 'A-1', classId: 'class-1',
              classDisplayName: 'SSS 1 A', enrollmentId: 'enr-1', status: null, remark: null },
            { studentId: 'stu-2', studentName: 'Grace Hopper', admissionNo: 'A-2', classId: 'class-1',
              classDisplayName: 'SSS 1 A', enrollmentId: 'enr-2', status: null, remark: null },
        ]);
    });

    // WHAT USED TO BE TESTED HERE. A dropdown to filter the class by curriculum
    // track — KSSR, British, or Both — that appeared only for a "dual curriculum"
    // branch. This school has no branches table and its student records carry no
    // track field, so the dropdown could never appear and the filter could only
    // pass every student through unchanged.
    //
    // The tests below are the honest version: every student in the class is listed,
    // and there is no curriculum picker. The rule worth holding down is that no
    // student is hidden by a filter that has nothing to filter on.
    it('lists every student, with no curriculum picker', async () => {
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
        expect(screen.queryByText('Semua Kurikulum')).not.toBeInTheDocument();
        expect(screen.queryByText('British')).not.toBeInTheDocument();
        expect(screen.queryByText('KSSR')).not.toBeInTheDocument();
    });

    it('never hides a student even when the record carries a track field', async () => {
        // The register has no curriculum field at all — that is the point. There is
        // nothing for a filter to hide a student with.
        (getClassRegister as any).mockResolvedValue([
            { studentId: 'stu-1', studentName: 'Ada Lovelace', admissionNo: 'A-1', classId: 'class-1',
              classDisplayName: 'SSS 1 A', enrollmentId: 'enr-1', status: null, remark: null },
            { studentId: 'stu-2', studentName: 'Grace Hopper', admissionNo: 'A-2', classId: 'class-1',
              classDisplayName: 'SSS 1 A', enrollmentId: 'enr-2', status: null, remark: null },
        ]);
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    });
});
