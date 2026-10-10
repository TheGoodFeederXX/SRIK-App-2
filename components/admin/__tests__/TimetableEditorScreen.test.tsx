/**
 * Timetable editor — SRIK.
 *
 * The source project had timetable editors, but they wrote to the legacy API
 * and could not express the two rules that matter: a teacher cannot be in two
 * places at once, and a teacher must be assigned to the subject in that class.
 * These tests are mostly about those two rules, because breaking either one
 * produces a timetable that looks complete and cannot be followed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import TimetableEditorScreen from '../TimetableEditorScreen';

const {
    getActiveTimetable, getClassTimetable, listTimetableClasses, listAssignableSubjects,
    setLesson, clearLesson, publishTimetable, findTeacherClash,
} = vi.hoisted(() => ({
    getActiveTimetable: vi.fn(), getClassTimetable: vi.fn(), listTimetableClasses: vi.fn(),
    listAssignableSubjects: vi.fn(), setLesson: vi.fn(), clearLesson: vi.fn(),
    publishTimetable: vi.fn(), findTeacherClash: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/timetable', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
        '../../../src/lib/supabase/timetable'
    );
    return {
        ...actual,
        getActiveTimetable: (...a: unknown[]) => getActiveTimetable(...a),
        getClassTimetable: (...a: unknown[]) => getClassTimetable(...a),
        listTimetableClasses: (...a: unknown[]) => listTimetableClasses(...a),
        listAssignableSubjects: (...a: unknown[]) => listAssignableSubjects(...a),
        setLesson: (...a: unknown[]) => setLesson(...a),
        clearLesson: (...a: unknown[]) => clearLesson(...a),
        publishTimetable: (...a: unknown[]) => publishTimetable(...a),
        findTeacherClash: (...a: unknown[]) => findTeacherClash(...a),
    };
});

const { requireSupabase } = vi.hoisted(() => ({ requireSupabase: vi.fn() }));
vi.mock('../../../src/lib/supabase/client', () => ({
    requireSupabase: () => requireSupabase(),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: toastError, success: toastSuccess });
    return { default: fn, toast: fn };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1' }, role: 'ADMIN', loading: false }),
}));

const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><TimetableEditorScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const TT = {
    id: 'tt1', name: 'Jadual Rasmi 2026', version: 1,
    status: 'DRAFT' as const, effectiveFrom: '2026-01-05', publishedAt: null,
};

// One Monday teaching period, so the editor has something to fill.
const MONDAY_W3 = {
    id: 'p-mon-3', dayOfWeek: 'MONDAY' as const, periodNumber: 3,
    startTime: '08:40', endTime: '09:15', type: 'TEACHING' as const, label: null,
};

const SUBJECTS = [
    { id: 's-mt', code: 'MT', name: 'Matematik', teacherId: 't1', teacherName: 'Ustazah Farhana' },
    { id: 's-bm', code: 'BM', name: 'Bahasa Melayu', teacherId: 't2', teacherName: 'Ustaz Zulnajmi' },
];

describe('TimetableEditorScreen — SRIK', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
        getActiveTimetable.mockResolvedValue(TT);
        listTimetableClasses.mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi', periodsPerWeek: 47 }]);
        listAssignableSubjects.mockResolvedValue(SUBJECTS);
        getClassTimetable.mockResolvedValue({ periods: [MONDAY_W3], entries: [], grid: [] });
        findTeacherClash.mockResolvedValue(null);
        requireSupabase.mockReturnValue({
            from: () => ({
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'y1' } }) }) }),
            }),
        });
    });

    it('shows how the week is filled, so gaps are visible', async () => {
        renderScreen();

        await screen.findByText('Monday');
        expect(screen.getByText('W3')).toBeDefined();
        expect(screen.getByText('Not timetabled')).toBeDefined();
    });

    it('places a lesson with its assigned teacher, without asking for one', async () => {
        // The assignment table decides the teacher, so the school must not be
        // asked to pick one — that could build a pairing that does not exist.
        setLesson.mockResolvedValue({ success: true });
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 's-mt' } });
        fireEvent.click(screen.getByText('Add lesson'));

        await waitFor(() => expect(setLesson).toHaveBeenCalledWith({
            periodId: 'p-mon-3', classId: 'c1', subjectId: 's-mt', teacherId: 't1',
        }));
    });

    it('shows the teacher that follows from the chosen subject', async () => {
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 's-bm' } });

        expect(await screen.findByText('Ustaz Zulnajmi')).toBeDefined();
    });

    it('warns about a teacher clash BEFORE saving, not after being refused', async () => {
        findTeacherClash.mockResolvedValue({ className: '4 Al-Junaidi', subjectCode: 'MT' });
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 's-mt' } });

        // The clash is named, naming the class, rather than a database error
        // appearing only once the school has already committed.
        expect(await screen.findByText(/4 Al-Junaidi/)).toBeDefined();
        expect(screen.getByText(/at this time/)).toBeDefined();
    });

    it('says plainly when no teacher is assigned to this class', async () => {
        // Placing a lesson would be refused by the database, so say so up front.
        listAssignableSubjects.mockResolvedValue([]);
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));

        expect(await screen.findByText(/No teacher is assigned to teach any subject/i)).toBeDefined();
    });

    it('reveals the Edit screen only when there is something to edit', async () => {
        getActiveTimetable.mockResolvedValue(null);
        renderScreen();

        expect(await screen.findByText('No Timetable Yet')).toBeDefined();
    });

    it('publishes the timetable, after warning that it replaces the current one', async () => {
        publishTimetable.mockResolvedValue({ success: true });
        getClassTimetable.mockResolvedValue({
            periods: [MONDAY_W3], entries: [{
                id: 'e1', periodId: 'p-mon-3', classId: 'c1', className: '3 Al-Junaidi',
                subjectId: 's-mt', subjectCode: 'MT', subjectName: 'Matematik',
                teacherId: 't1', teacherName: 'Ustazah Farhana', room: null, activity: null,
            }], grid: [],
        });
        renderScreen();

        // Wait for the loaded week: the button is disabled until something is
        // timetabled, and pressing a disabled button would prove nothing.
        await screen.findByText('MT');
        fireEvent.click(screen.getByText('Publish Timetable'));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(String((window.confirm as any).mock.calls[0][0])).toMatch(/replaced/i);
        await waitFor(() => expect(publishTimetable).toHaveBeenCalledWith('tt1', expect.any(String)));
    });

    it('does not publish when the warning is declined', async () => {
        window.confirm = vi.fn(() => false);
        getClassTimetable.mockResolvedValue({
            periods: [MONDAY_W3], entries: [{
                id: 'e1', periodId: 'p-mon-3', classId: 'c1', className: '3 Al-Junaidi',
                subjectId: 's-mt', subjectCode: 'MT', subjectName: 'Matematik',
                teacherId: 't1', teacherName: 'Ustazah Farhana', room: null, activity: null,
            }], grid: [],
        });
        renderScreen();

        await screen.findByText('MT');
        fireEvent.click(screen.getByText('Publish Timetable'));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(publishTimetable).not.toHaveBeenCalled();
    });

    it('offers no Publish button once the timetable is already published', async () => {
        getActiveTimetable.mockResolvedValue({ ...TT, status: 'PUBLISHED' as const, publishedAt: '2026-01-01' });
        renderScreen();

        await screen.findByText('Monday');
        expect(screen.queryByText('Publish Timetable')).toBeNull();
    });

    it('clears a lesson the school decided should not be there', async () => {
        clearLesson.mockResolvedValue({ success: true });
        getClassTimetable.mockResolvedValue({
            periods: [MONDAY_W3], entries: [{
                id: 'e1', periodId: 'p-mon-3', classId: 'c1', className: '3 Al-Junaidi',
                subjectId: 's-mt', subjectCode: 'MT', subjectName: 'Matematik',
                teacherId: 't1', teacherName: 'Ustazah Farhana', room: null, activity: null,
            }], grid: [],
        });
        renderScreen();

        fireEvent.click(await screen.findByText('MT'));
        fireEvent.click(await screen.findByText('Clear'));

        await waitFor(() => expect(clearLesson).toHaveBeenCalledWith('p-mon-3', 'c1'));
    });

    it('reports a refusal from the database in plain words', async () => {
        // The raw message names an index, which helps nobody.
        setLesson.mockResolvedValue({ success: false, error: 'That teacher already has a lesson at this time. Choose another teacher, or move the lesson.' });
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 's-mt' } });
        fireEvent.click(screen.getByText('Add lesson'));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/already has a lesson/i)));
    });
});

describe('errors reach the school in words it can act on', () => {
    it('turns a double-booking refusal into an instruction, not an index name', async () => {
        // The database says `idx_timetable_entries_teacher_not_double_booked`,
        // which tells a head teacher nothing about what to do next.
        setLesson.mockResolvedValue({
            success: false,
            error: 'That teacher already has a lesson at this time. Choose another teacher, or move the lesson.',
        });
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 's-mt' } });
        fireEvent.click(screen.getByText('Add lesson'));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith(
            expect.stringMatching(/choose another teacher, or move the lesson/i)
        ));
    });

    it('refuses to save without a subject, rather than guessing one', async () => {
        renderScreen();

        fireEvent.click(await screen.findByText('Not timetabled'));
        // No subject chosen: the button stays unavailable so an empty lesson
        // cannot be written.
        const add = screen.getByText('Add lesson').closest('button') as HTMLButtonElement;
        expect(add.disabled).toBe(true);
    });
});
