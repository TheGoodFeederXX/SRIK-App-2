/**
 * Mark entry — SRIK.
 *
 * The source project had no way to record a mark, so these tests are about the
 * rules that make a mark sheet trustworthy rather than about an old UI:
 *
 *   * a child with no mark is NOT a child with a zero;
 *   * the register is built from the class list, so a child with no mark still
 *     appears and can be marked;
 *   * the whole register is saved in one call;
 *   * a mark above the maximum is caught before the server has to refuse it;
 *   * a published assessment is shown as locked, not as editable.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MarkEntryScreen from '../MarkEntryScreen';

const { listClasses, listSubjects, listTerms, listAssessments, getMarkRegister,
        saveMarks, publishAssessment, listGradeBoundaries } = vi.hoisted(() => ({
    listClasses: vi.fn(), listSubjects: vi.fn(), listTerms: vi.fn(),
    listAssessments: vi.fn(), getMarkRegister: vi.fn(),
    saveMarks: vi.fn(), publishAssessment: vi.fn(), listGradeBoundaries: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/academics', () => ({
    listClasses: (...a: unknown[]) => listClasses(...a),
    listSubjects: (...a: unknown[]) => listSubjects(...a),
}));

vi.mock('../../../src/lib/supabase/assessments', async () => {
    // friendlyMarkError and gradeFor are pure and worth testing for real.
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/assessments')>(
        '../../../src/lib/supabase/assessments'
    );
    return {
        ...actual,
        listTerms: (...a: unknown[]) => listTerms(...a),
        listAssessments: (...a: unknown[]) => listAssessments(...a),
        getMarkRegister: (...a: unknown[]) => getMarkRegister(...a),
        saveMarks: (...a: unknown[]) => saveMarks(...a),
        publishAssessment: (...a: unknown[]) => publishAssessment(...a),
        listGradeBoundaries: (...a: unknown[]) => listGradeBoundaries(...a),
    };
});

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: toastError, success: toastSuccess });
    return { default: fn, toast: fn };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'teacher-1' }, role: 'TEACHER', loading: false }),
}));

const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><MarkEntryScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const CLASS = {
    id: 'c1', yearLevel: 3, name: 'Al-Junaidi', code: '3J',
    displayName: '3 Al-Junaidi', status: 'ACTIVE', academicYearId: 'y1', studentCount: 2,
};

const ASSESSMENT = {
    id: 'a1', title: 'Ujian Pertengahan Tahun', type: 'MID_YEAR_EXAM' as const,
    subjectId: 'sub1', subjectCode: 'MT', subjectName: 'Matematik',
    classId: 'c1', classDisplayName: '3 Al-Junaidi',
    academicTermId: 't1', termName: 'Semester 1',
    maxScore: 100, weight: 100, assessmentDate: null,
    status: 'DRAFT' as const,
};

const row = (over: Record<string, unknown> = {}) => ({
    studentId: 's1', studentName: 'Ahmad Zaki', admissionNo: 'P3S1',
    status: 'NOT_ENTERED' as const, score: null, tp: null, comment: null, ...over,
});

const register = (over: Record<string, unknown> = {}) => ({
    assessment: ASSESSMENT,
    rows: [row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2' })],
    decided: 0, awaiting: 2, ...over,
});

const BOUNDARIES = [
    { id: 'g1', grade: 'A', minPercent: 80, maxPercent: 100, sortOrder: 1 },
    { id: 'g2', grade: 'B', minPercent: 65, maxPercent: 79.99, sortOrder: 2 },
];

describe('MarkEntryScreen — SRIK mark entry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
        listClasses.mockResolvedValue([CLASS]);
        listSubjects.mockResolvedValue([]);
        listGradeBoundaries.mockResolvedValue(BOUNDARIES);
        listTerms.mockResolvedValue([
            { id: 't1', name: 'Semester 1', sequence: 1, startDate: '2026-01-01',
              endDate: '2026-06-30', status: 'CURRENT' },
        ]);
        listAssessments.mockResolvedValue([ASSESSMENT]);
        publishAssessment.mockResolvedValue({ published: true, students: 2 });
    });

    it('shows a child with no mark as unmarked, never as a zero', async () => {
        // Turning a blank into 0 would make an absent child look failing.
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        expect(await screen.findByText('Ahmad Zaki')).toBeDefined();
        const scoreBox = screen.getByLabelText('Marks for Ahmad Zaki') as HTMLInputElement;
        expect(scoreBox.value).toBe('');
        expect(screen.getByText('Nur Aisyah')).toBeDefined();
    });

    it('lists a child who has no mark at all, so they can still be marked', async () => {
        // The register comes from the class list, not from the marks table.
        // Reading the marks table would hide exactly the children still to do.
        getMarkRegister.mockResolvedValue(register({
            rows: [row(), row({ studentId: 's2', studentName: 'Nur Aisyah' }), row({ studentId: 's3', studentName: 'Umar Faruq' })],
            awaiting: 3,
        }));
        renderScreen();

        expect(await screen.findByText('Umar Faruq')).toBeDefined();
        // All three appear as rows, so all three can be marked.
        expect(screen.getByLabelText('Marks for Umar Faruq')).toBeDefined();
        expect(screen.getAllByLabelText('Not filled in').length).toBe(3);
    });

    it('defaults to the current term so the screen is usable immediately', async () => {
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        await waitFor(() => expect(listAssessments).toHaveBeenCalledWith('t1'));
    });

    it('refuses a mark above the maximum before saving', async () => {
        // Catching it here means the teacher sees which number is wrong,
        // rather than a database constraint name.
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getAllByLabelText('Has marks')[0]);

        const scoreBox = screen.getByLabelText('Marks for Ahmad Zaki') as HTMLInputElement;
        fireEvent.change(scoreBox, { target: { value: '150' } });

        fireEvent.click(screen.getByText('Save marks'));

        await waitFor(() => {
            expect(toastError).toHaveBeenCalledWith(expect.stringContaining('exceed the full mark'));
        });
        expect(saveMarks).not.toHaveBeenCalled();
    });

    it('does not let an absent child carry a mark', async () => {
        // The status and the mark must not contradict each other.
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getAllByLabelText('Has marks')[0]);
        fireEvent.change(screen.getByLabelText('Marks for Ahmad Zaki'), { target: { value: '80' } });

        // Choosing "tidak hadir" clears the typed number.
        const absentButtons = screen.getAllByLabelText('Absent');
        fireEvent.click(absentButtons[0]);

        const scoreBox = screen.getByLabelText('Marks for Ahmad Zaki') as HTMLInputElement;
        expect(scoreBox.value).toBe('');
    });

    it('saves the whole class in one call rather than one request per child', async () => {
        getMarkRegister.mockResolvedValue(register());
        saveMarks.mockResolvedValue({ graded: 2, cleared: 0, unchanged: 0 });
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getAllByLabelText('Has marks')[0]);
        fireEvent.change(screen.getByLabelText('Marks for Ahmad Zaki'), { target: { value: '85' } });
        fireEvent.click(screen.getAllByLabelText('Has marks')[1]);
        fireEvent.change(screen.getByLabelText('Marks for Nur Aisyah'), { target: { value: '72' } });

        fireEvent.click(screen.getByText('Save marks'));

        await waitFor(() => expect(saveMarks).toHaveBeenCalledTimes(1));
        const [, payload] = saveMarks.mock.calls[0];
        expect(payload).toHaveLength(2);
        expect(payload[0]).toMatchObject({ studentId: 's1', status: 'GRADED', score: 85 });
    });

    it('sends no score at all for an absent child', async () => {
        // A score alongside "absent" is refused by the database, correctly, so
        // it must not be sent in the first place.
        getMarkRegister.mockResolvedValue(register());
        saveMarks.mockResolvedValue({ graded: 0, cleared: 0, unchanged: 1 });
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getAllByLabelText('Absent')[0]);
        fireEvent.click(screen.getByText('Save marks'));

        await waitFor(() => expect(saveMarks).toHaveBeenCalled());
        const [, payload] = saveMarks.mock.calls[0];
        const absentRow = payload.find((p: { studentId: string }) => p.studentId === 's1');
        expect(absentRow.status).toBe('ABSENT');
        expect(absentRow.score).toBeNull();
    });

    it('warns about the children still unmarked before writing', async () => {
        // Saving is allowed mid-lesson, but the teacher must know who will be
        // left as "not filled in" rather than quietly becoming zeroes.
        getMarkRegister.mockResolvedValue(register());
        saveMarks.mockResolvedValue({ graded: 1, cleared: 0, unchanged: 0 });
        window.confirm = vi.fn(() => true);
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getAllByLabelText('Has marks')[0]);
        fireEvent.change(screen.getByLabelText('Marks for Ahmad Zaki'), { target: { value: '85' } });
        fireEvent.click(screen.getByText('Save marks'));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect((window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
            .toContain('not filled in');
    });

    it('blocks publishing while any child is still unmarked', async () => {
        // An incomplete assessment would put a blank row on a report card and
        // call it finished.
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        const publish = screen.getByText('Publish').closest('button') as HTMLButtonElement;
        expect(publish.disabled).toBe(true);
    });

    it('shows a published assessment as locked, with no save button', async () => {
        // Once published, the marks are the school's record. Offering an edit
        // the database will refuse would be a lie about what is possible.
        getMarkRegister.mockResolvedValue(register({
            assessment: { ...ASSESSMENT, status: 'PUBLISHED' },
            rows: [row({ status: 'GRADED', score: 88 })],
            decided: 1, awaiting: 0,
        }));
        renderScreen();

        expect(await screen.findByText('Published')).toBeDefined();
        expect(screen.queryByText('Save marks')).toBeNull();
        const scoreBox = screen.getByLabelText('Marks for Ahmad Zaki') as HTMLInputElement;
        expect(scoreBox.disabled).toBe(true);
    });

    it('shows the percentage and the grade from the school scale', async () => {
        getMarkRegister.mockResolvedValue(register({
            rows: [row({ status: 'GRADED', score: 88 })],
            decided: 1, awaiting: 1,
        }));
        renderScreen();

        expect(await screen.findByText('88%')).toBeDefined();
        expect(screen.getByText('A')).toBeDefined();
    });

    it('tells the teacher when there are no assessments for the chosen class', async () => {
        listAssessments.mockResolvedValue([{ ...ASSESSMENT, classId: 'c99' }]);
        getMarkRegister.mockResolvedValue(register());
        renderScreen();

        expect(await screen.findByText('No assessment for this class')).toBeDefined();
    });
});
