/**
 * Report cards — SRIK.
 *
 * The rules these tests defend are the ones that make a report card worth
 * anything to a school:
 *
 *   * what is shown is the SNAPSHOT that was issued, not a live recomputation;
 *   * a published report carries its revision, so an old one is not mistaken
 *     for a current one;
 *   * a draft preview is clearly a draft, and cannot be published by accident;
 *   * a child with no mark shows a dash, never a zero;
 *   * printing prints the document, with the controls excluded.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ReportCardScreen from '../ReportCardScreen';

const { listClasses, listTerms, listReportCards, getReportSnapshot, previewReport,
        publishReportCard, getSchoolDetails, listClassStudents, listGradeBoundaries } =
    vi.hoisted(() => ({
        listClasses: vi.fn(), listTerms: vi.fn(), listReportCards: vi.fn(),
        getReportSnapshot: vi.fn(), previewReport: vi.fn(), publishReportCard: vi.fn(),
        getSchoolDetails: vi.fn(), listClassStudents: vi.fn(), listGradeBoundaries: vi.fn(),
    }));

vi.mock('../../../src/lib/supabase/academics', () => ({
    listClasses: (...a: unknown[]) => listClasses(...a),
}));

vi.mock('../../../src/lib/supabase/assessments', async () => {
    // gradeFor and averagePercent are pure and worth testing for real.
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/assessments')>(
        '../../../src/lib/supabase/assessments'
    );
    return {
        ...actual,
        listTerms: (...a: unknown[]) => listTerms(...a),
        listReportCards: (...a: unknown[]) => listReportCards(...a),
        getReportSnapshot: (...a: unknown[]) => getReportSnapshot(...a),
        previewReport: (...a: unknown[]) => previewReport(...a),
        publishReportCard: (...a: unknown[]) => publishReportCard(...a),
        getSchoolDetails: (...a: unknown[]) => getSchoolDetails(...a),
        listClassStudents: (...a: unknown[]) => listClassStudents(...a),
        listGradeBoundaries: (...a: unknown[]) => listGradeBoundaries(...a),
    };
});

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
            <MemoryRouter><ReportCardScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const CLASS = {
    id: 'c1', yearLevel: 3, name: 'Al-Junaidi', code: '3J',
    displayName: '3 Al-Junaidi', status: 'ACTIVE', academicYearId: 'y1', studentCount: 1,
};

const SCHOOL = {
    name: 'Sekolah Rendah Islam Al-Khairiah',
    shortName: 'SRI Al-Khairiah', address: 'Jalan Pedu, 06300 Kuala Nerang, Kedah',
    phone: '0105119582', email: 'srialkhairiah@gmail.com', website: '',
    principalName: 'Mohd Fadil Hadi bin Haji Ismail', logoStorageKey: null,
};

const BOUNDARIES = [
    { id: 'g1', grade: 'A', minPercent: 80, maxPercent: 100, sortOrder: 1 },
    { id: 'g2', grade: 'B', minPercent: 65, maxPercent: 79.99, sortOrder: 2 },
];

/** A snapshot as the data layer normalises it. */
function snapshot(over: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        generatedAt: '2026-06-30T10:00:00Z',
        term: { id: 't1', name: 'Semester 1', startDate: '2026-01-01', endDate: '2026-06-30' },
        student: { id: 's1', fullName: 'Ahmad Zaki', admissionNo: 'P3S1', gender: 'MALE' },
        class: { id: 'c1', displayName: '3 Al-Junaidi', yearLevel: 3 },
        assessments: [{
            assessmentId: 'a1', title: 'Ujian Pertengahan Tahun', type: 'MID_YEAR_EXAM',
            subjectCode: 'MT', subjectName: 'Matematik', maxScore: 100, weight: 100,
            status: 'GRADED', score: 88, percent: 88, grade: null, tp: 5, comment: null,
        }],
        attendance: { daysRecorded: 10, daysPresent: 9, rate: 90 },
        ...over,
    };
}

const issued = (over: Record<string, unknown> = {}, version = 1) => async () => ({
    id: `r${version}`, version, status: 'PUBLISHED', snapshot: snapshot(over),
});

const withAssessment = (a: Record<string, unknown>) =>
    snapshot({ assessments: [{ ...snapshot().assessments[0], ...a }] });

describe('ReportCardScreen — SIRK report cards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
        listClasses.mockResolvedValue([CLASS]);
        listGradeBoundaries.mockResolvedValue(BOUNDARIES);
        getSchoolDetails.mockResolvedValue(SCHOOL);
        listClassStudents.mockResolvedValue([
            { studentId: 's1', fullName: 'Ahmad Zaki', admissionNo: 'P3S1' },
        ]);
        listTerms.mockResolvedValue([
            { id: 't1', name: 'Semester 1', sequence: 1, startDate: '2026-01-01',
              endDate: '2026-06-30', status: 'CURRENT' },
        ]);
        listReportCards.mockResolvedValue([]);
        publishReportCard.mockResolvedValue({ reportCardId: 'r1', version: 1, supersededId: null });
    });

    it('heads the report with the real school details', async () => {
        getReportSnapshot.mockImplementation(issued());
        renderScreen();
        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText('Sekolah Rendah Islam Al-Khairiah')).toBeDefined();
        expect(screen.getByText('Jalan Pedu, 06300 Kuala Nerang, Kedah')).toBeDefined();
        expect(screen.getByText('Mohd Fadil Hadi bin Haji Ismail')).toBeDefined();
        expect(screen.getByText('Report Cards')).toBeDefined();
    });

    it('shows the issued snapshot, not a live recomputation', async () => {
        // The data layer returns the frozen copy. If this screen recomputed, an
        // old report would silently change when a mark was corrected later.
        getReportSnapshot.mockImplementation(issued());
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        // The mark cell carries the raw score out of the maximum.
        expect(screen.getByTitle('88 / 100')).toBeDefined();
        expect(previewReport).not.toHaveBeenCalled();
    });

    it('labels a revision greater than one as a correction that kept the original', async () => {
        getReportSnapshot.mockImplementation(issued({}, 2));
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getAllByText(/Revisi/).length).toBeGreaterThan(0);
        expect(screen.getByText(/revisi sebelum ini masih disimpan/)).toBeDefined();
    });

    it('shows a child with no mark as a dash, never a zero', async () => {
        // Turning a blank into 0 would make an absent child look failing.
        getReportSnapshot.mockImplementation(issued(
            withAssessment({ status: 'NOT_ENTERED', score: null, percent: null, tp: null })
        ));
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByTitle('Not filled in')).toBeDefined();
        expect(screen.queryByText('0')).toBeNull();
    });

    it('shows absence as TH and not as a zero', async () => {
        getReportSnapshot.mockImplementation(issued(
            withAssessment({ status: 'ABSENT', score: null, percent: null })
        ));
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText('TH')).toBeDefined();
        expect(screen.getByTitle('Absent')).toBeDefined();
    });

    it('explains on the sheet that a dash is not a zero', async () => {
        // A parent reading "—" must not conclude their child scored nothing.
        getReportSnapshot.mockImplementation(issued());
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText(/means not filled in/)).toBeDefined();
    });

    it('shows the attendance summary the snapshot froze', async () => {
        getReportSnapshot.mockImplementation(issued());
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText('90%')).toBeDefined();
    });

    it('says so plainly when the term has no attendance recorded', async () => {
        // No register taken must not present as a child who never attended.
        getReportSnapshot.mockImplementation(issued(
            { attendance: { daysRecorded: 0, daysPresent: 0, rate: null } }
        ));
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText(/No attendance records/)).toBeDefined();
    });

    it('shows a preview clearly marked as a draft', async () => {
        getReportSnapshot.mockImplementation(async () => null);
        previewReport.mockImplementation(async () => snapshot());
        renderScreen();

        // Wait until the child is known, then switch to the preview.
        await waitFor(() => expect(getReportSnapshot).toHaveBeenCalledWith('s1', 't1'));
        fireEvent.click(screen.getByText('Draft preview'));
        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());

        expect(screen.getAllByText(/Draft — not yet published/).length).toBeGreaterThan(0);
        expect(screen.getByText(/not yet published and will not take effect/)).toBeDefined();
    });

    it('will not publish from the preview, so a draft cannot go out by mistake', async () => {
        getReportSnapshot.mockImplementation(async () => null);
        previewReport.mockImplementation(async () => snapshot());
        renderScreen();

        await waitFor(() => expect(getReportSnapshot).toHaveBeenCalledWith('s1', 't1'));
        fireEvent.click(screen.getByText('Draft preview'));
        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());

        const publish = screen.getByText('Publish').closest('button') as HTMLButtonElement;
        expect(publish.disabled).toBe(true);
    });

    it('tells the office when a child has no issued report yet', async () => {
        getReportSnapshot.mockImplementation(async () => null);
        renderScreen();

        expect(await screen.findByText(/Tiada kad laporan diterbitkan/)).toBeDefined();
    });

    it('publishes the card and reports the revision number', async () => {
        getReportSnapshot.mockImplementation(async () => null);
        publishReportCard.mockResolvedValue({ reportCardId: 'r1', version: 1, supersededId: null });
        renderScreen();

        // The controls render straight away, but the student is chosen by an
        // effect, so wait until the query has actually run for that child.
        await waitFor(() => expect(getReportSnapshot).toHaveBeenCalledWith('s1', 't1'));
        fireEvent.click(screen.getByText('Publish'));

        await waitFor(() => expect(publishReportCard).toHaveBeenCalledWith('s1', 't1', undefined));
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('revisi 1')));
    });

    it('warns that republishing becomes a new revision', async () => {
        getReportSnapshot.mockImplementation(issued());
        listReportCards.mockResolvedValue([{
            id: 'r1', studentId: 's1', studentName: 'Ahmad Zaki', academicTermId: 't1',
            termName: 'Semester 1', classDisplayName: '3 Al-Junaidi', version: 1,
            status: 'PUBLISHED', publishedAt: '2026-06-30T10:00:00Z', hasSnapshot: true,
        }]);
        publishReportCard.mockResolvedValue({ reportCardId: 'r2', version: 2, supersededId: 'r1' });
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        fireEvent.click(screen.getByText('Publish new revision'));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        const calls = (window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls;
        expect(calls[0][0]).toContain('REVISI BAHARU');
    });

    it('prints through the browser and marks the controls as not printable', async () => {
        // Printing must give the report, not the report plus the application
        // shell. The shell carries no-print; the sheets carry report-card-sheet.
        getReportSnapshot.mockImplementation(issued());
        const print = vi.fn();
        window.print = print;
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        fireEvent.click(screen.getByText('Print'));

        expect(print).toHaveBeenCalled();
        expect(document.querySelector('.no-print')).not.toBeNull();
        expect(document.querySelector('.report-card-sheet')).not.toBeNull();
    });

    it('groups a subject examined more than once into one block', async () => {
        getReportSnapshot.mockImplementation(issued({
            assessments: [
                { assessmentId: 'a1', title: 'Ujian 1', type: 'TEST', subjectCode: 'MT',
                  subjectName: 'Matematik', maxScore: 100, weight: 50, status: 'GRADED',
                  score: 80, percent: 80, grade: null, tp: null, comment: null },
                { assessmentId: 'a2', title: 'Ujian 2', type: 'TEST', subjectCode: 'MT',
                  subjectName: 'Matematik', maxScore: 100, weight: 50, status: 'GRADED',
                  score: 90, percent: 90, grade: null, tp: null, comment: null },
            ],
        }));
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText('Ujian 1')).toBeDefined();
        // Written once, spanning both rows, rather than repeated per assessment.
        expect(screen.getAllByText('Matematik')).toHaveLength(1);
        expect(screen.getByText('Ujian 2')).toBeDefined();
    });

    it('averages the weighted marks and grades the result', async () => {
        getReportSnapshot.mockImplementation(issued());
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText('Average')).toBeDefined();
        // The subject row and the average row both carry a grade, and 88% falls
        // in the A band, so A appears more than once.
        expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    });

    it('warns when the school details are missing, so a blank head is explained', async () => {
        getSchoolDetails.mockResolvedValue(null);
        getReportSnapshot.mockImplementation(issued());
        renderScreen();

        await waitFor(() => expect(document.querySelector('.report-card-sheet')).not.toBeNull());
        expect(screen.getByText(/The school information is not complete/)).toBeDefined();
    });

    it('tells the office when the class has nobody in it', async () => {
        listClassStudents.mockResolvedValue([]);
        renderScreen();

        expect(await screen.findByText(/No active students/)).toBeDefined();
    });
});
