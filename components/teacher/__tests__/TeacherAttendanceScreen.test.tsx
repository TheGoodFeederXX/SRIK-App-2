import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TeacherMarkAttendanceScreen from '../TeacherAttendanceScreen';

vi.mock('../../../context/ProfileContext', () => ({
    useProfile: () => ({ profile: { schoolId: 'school-1', branchId: 'branch-1' } })
}));

vi.mock('../../../hooks/useAutoSync', () => ({
    useAutoSync: () => {}
}));

let mockBranches: any[] = [];
vi.mock('../../../context/SchoolScopeContext', () => ({
    useSchoolScope: () => ({ branches: mockBranches })
}));

vi.mock('../../../lib/api', () => ({
    api: {
        getStudents: vi.fn().mockResolvedValue([{ id: 'stu-1', full_name: 'Ada Lovelace' }]),
        getAttendance: vi.fn((_classId: string, date: string) => {
            const attendanceByDate: Record<string, any[]> = {
                '2026-08-04': [{ student_id: 'stu-1', status: 'absent' }],
                '2026-08-05': [{ student_id: 'stu-1', status: 'present' }],
            };
            return Promise.resolve(attendanceByDate[date] || []);
        }),
        saveAttendance: vi.fn().mockResolvedValue({}),
    }
}));

import { api } from '../../../lib/api';

const students = [{ id: 'stu-1', full_name: 'Ada Lovelace' }];
const attendanceByDate: Record<string, any[]> = {
    '2026-08-04': [{ student_id: 'stu-1', status: 'absent' }],
    '2026-08-05': [{ student_id: 'stu-1', status: 'present' }],
};

const classInfo = { id: 'class-1', grade: 'SSS 1', section: 'A', schoolId: 'school-1' } as any;

describe('TeacherMarkAttendanceScreen date switching', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mockBranches = [];
        (api.getStudents as any).mockResolvedValue(students);
        (api.getAttendance as any).mockImplementation((_classId: string, date: string) =>
            Promise.resolve(attendanceByDate[date] || [])
        );
    });

    it('shows each date\'s own saved record instead of a stale local draft', async () => {
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        // Initial load = today's date (mocked as no record -> defaults to Present)
        await waitFor(() => expect(api.getAttendance).toHaveBeenCalled());

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
        (api.getStudents as any).mockResolvedValue([
            { id: 'stu-1', full_name: 'Ada Lovelace' },
            { id: 'stu-2', full_name: 'Grace Hopper' },
        ]);
        (api.getAttendance as any).mockResolvedValue([]);
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
        // A stray `curriculum_type` on a student must not remove them from the list.
        (api.getStudents as any).mockResolvedValue([
            { id: 'stu-1', full_name: 'Ada Lovelace', curriculum_type: 'KSSR' },
            { id: 'stu-2', full_name: 'Grace Hopper', curriculum_type: 'British' },
        ]);
        render(<TeacherMarkAttendanceScreen classInfo={classInfo} currentBranchId="branch-1" />);

        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    });
});
