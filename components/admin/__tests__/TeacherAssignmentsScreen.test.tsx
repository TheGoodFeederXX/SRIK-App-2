/**
 * Teacher duties — SRIK.
 *
 * The original screen posted to raw REST endpoints and carried a "co-class
 * teachers" setting and a "session / term" model. Those are gone. These tests
 * assert the duties the screen now shows, and that the safety property the
 * database relies on still holds: saving replaces a teacher's whole set through
 * the RPC, never by writing rows directly.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import TeacherAssignmentsScreen from '../TeacherAssignmentsScreen';

const {
    listTeachers, listAssignments, setTeacherAssignments,
    getCurrentAcademicYearId, getTeacherDuties,
    listClassOptions, listSubjectOptions,
} = vi.hoisted(() => ({
    listTeachers: vi.fn(), listAssignments: vi.fn(), setTeacherAssignments: vi.fn(),
    getCurrentAcademicYearId: vi.fn(), getTeacherDuties: vi.fn(),
    listClassOptions: vi.fn(), listSubjectOptions: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/teachers', () => ({
    listTeachers: (...a: unknown[]) => listTeachers(...a),
    listAssignments: (...a: unknown[]) => listAssignments(...a),
    setTeacherAssignments: (...a: unknown[]) => setTeacherAssignments(...a),
    getCurrentAcademicYearId: (...a: unknown[]) => getCurrentAcademicYearId(...a),
    getTeacherDuties: (...a: unknown[]) => getTeacherDuties(...a),
}));

vi.mock('../../../src/lib/supabase/academics', () => ({
    listClassOptions: (...a: unknown[]) => listClassOptions(...a),
    listSubjectOptions: (...a: unknown[]) => listSubjectOptions(...a),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({
    toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: toastError, success: toastSuccess });
    return { default: fn, toast: fn };
});

// The screen reads data only once someone is signed in. The real providers do
// a lot of async work that is not the subject of these tests, so they are
// stubbed down to what the query gate needs.
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1' }, role: 'ADMIN', loading: false }),
}));

const renderScreen = (ui: React.ReactElement) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );

const teacher = (over: Record<string, unknown> = {}) => ({
    id: 't1', userId: null, staffCode: 'G001', fullName: 'Ustaz Ahmad',
    gender: 'MALE', phone: null, email: null, employmentStart: null,
    employmentEnd: null, status: 'ACTIVE', subjects: [], classes: [], ...over,
});

const duty = (over: Record<string, unknown> = {}) => ({
    id: 'a1', teacherId: 't1', teacherName: 'Ustaz Ahmad', teacherStaffCode: 'G001',
    type: 'CLASS_TEACHER', classId: 'c1', className: '3 Al-Junaidi',
    subjectId: null, subjectName: null, periodsPerWeek: null, ...over,
});

describe('TeacherAssignmentsScreen — SRIK duties', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCurrentAcademicYearId.mockResolvedValue('y1');
        listClassOptions.mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi' }]);
        listSubjectOptions.mockResolvedValue([{ id: 's1', label: 'Matematik' }]);
        getTeacherDuties.mockResolvedValue({ classIds: [], subjectIds: [], periodsPerWeek: 0 });
    });

    it('shows class teachers with the class they are responsible for', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([duty()]);
        renderScreen(<TeacherAssignmentsScreen />);

        expect(await screen.findByText('Ustaz Ahmad')).toBeDefined();
        expect(screen.getByText('3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText('G001')).toBeDefined();
    });

    it('shows subject teachers with the subject and class', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([
            duty({
                id: 'a2', type: 'SUBJECT_TEACHER', classId: 'c1', className: '3 Al-Junaidi',
                subjectId: 's1', subjectName: 'Matematik', periodsPerWeek: 6,
            }),
        ]);
        renderScreen(<TeacherAssignmentsScreen />);
        await screen.findByText('Subject Teachers');
        fireEvent.click(screen.getByText('Subject Teachers'));

        expect(await screen.findByText('Ustaz Ahmad')).toBeDefined();
        expect(await screen.findByText('Matematik · 3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText(/6 periods/)).toBeDefined();
    });

    it('totals each teacher\'s weekly periods in the workload view', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([
            duty({ id: 'a2', type: 'SUBJECT_TEACHER', subjectId: 's1', subjectName: 'Matematik', periodsPerWeek: 6 }),
            duty({ id: 'a3', type: 'SUBJECT_TEACHER', subjectId: 's1', subjectName: 'Matematik', periodsPerWeek: 5 }),
        ]);
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Subject Teachers');
        fireEvent.click(screen.getByText('Workload'));

        // 6 + 5 — a class-teacher duty contributes no periods, not zero hours.
        expect(await screen.findByText('11 periods')).toBeDefined();
    });

    it('offers no session, term, or co-class teacher controls', async () => {
        // None of these exist at SRIK: the school uses academic years, and
        // whether two teachers may share a class is not a system setting.
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([duty()]);
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Ustaz Ahmad');
        const body = document.body.textContent ?? '';
        expect(body).not.toMatch(/co-class/i);
        expect(body).not.toMatch(/\bterm\b/i);
        expect(body).not.toMatch(/\bsession\b/i);
    });

    it('saves a teacher\'s duties through the RPC, not by writing rows', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([]);
        setTeacherAssignments.mockResolvedValue({ success: true });
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Class Teachers');
        fireEvent.click(screen.getByText('Assign').closest('button')!);

        fireEvent.change(await screen.findByLabelText('Teacher'), { target: { value: 't1' } });
        fireEvent.click(screen.getByText('3 Al-Junaidi'));
        fireEvent.click(screen.getByRole('button', { name: 'Save duties' }));

        await waitFor(() => expect(setTeacherAssignments).toHaveBeenCalledTimes(1));
        // teacherId, academic year, classes, subjects
        const [tid, yearId, classIds] = setTeacherAssignments.mock.calls[0];
        expect(tid).toBe('t1');
        expect(yearId).toBe('y1');
        expect(classIds).toEqual(['c1']);
    });

    it('warns that saving replaces what the teacher already has', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([]);
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Class Teachers');
        fireEvent.click(screen.getByText('Assign').closest('button')!);
        fireEvent.change(await screen.findByLabelText('Teacher'), { target: { value: 't1' } });

        // The owner must never be surprised that a save removed a duty.
        expect(await screen.findByText(/replaces everything Ustaz Ahmad currently has/i)).toBeDefined();
    });

    it('refuses to save with no class and no subject', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([]);
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Class Teachers');
        fireEvent.click(screen.getByText('Assign').closest('button')!);

        const form = (await screen.findByLabelText('Teacher')).closest('form')!;
        fireEvent.change(screen.getByLabelText('Teacher'), { target: { value: 't1' } });
        fireEvent.submit(form);

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(setTeacherAssignments).not.toHaveBeenCalled();
    });

    it('pre-fills a teacher\'s existing duties when editing', async () => {
        listTeachers.mockResolvedValue([teacher()]);
        listAssignments.mockResolvedValue([duty()]);
        getTeacherDuties.mockResolvedValue({ classIds: ['c1'], subjectIds: [], periodsPerWeek: 0 });
        renderScreen(<TeacherAssignmentsScreen />);

        await screen.findByText('Ustaz Ahmad');
        await screen.findByText('Class Teachers');
        fireEvent.click(screen.getByLabelText('Edit duties for Ustaz Ahmad'));

        // The class they already had is ticked, not blank. The class name also
        // appears on the duty row behind the dialog, so the checkbox is read
        // from the form itself rather than from the first match on the page.
        await waitFor(() => expect(getTeacherDuties).toHaveBeenCalledWith('t1'));
        const form = await screen.findByRole('button', { name: 'Save duties' })
            .then(b => b.closest('form')!);
        const classBoxes = [...form.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
        // The first checkbox is "responsible for a class"; the rest are options.
        expect(classBoxes.some(b => b.checked)).toBe(true);
    });
});
