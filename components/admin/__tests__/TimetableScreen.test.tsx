/**
 * Timetable — SRIK.
 *
 * The original screen built its week from the legacy API and had no way to show
 * assembly, break or Zohor as anything but a gap, so most of these tests are
 * about the school day being REAL: every period present, non-teaching periods
 * named, and a lesson without a teacher counted rather than hidden.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import TimetableScreen from '../TimetableScreen';

const {
    getActiveTimetable, getClassTimetable, getTeacherTimetable,
    listTimetableClasses, listTimetableTeachers, findIncompleteEntries,
    // The signed-in role is mutable so a test can become a different person
    // without re-importing the component. A mock set up AFTER the import has no
    // effect, which is exactly the trap this avoids.
    authState,
} = vi.hoisted(() => ({
    getActiveTimetable: vi.fn(), getClassTimetable: vi.fn(), getTeacherTimetable: vi.fn(),
    listTimetableClasses: vi.fn(), listTimetableTeachers: vi.fn(), findIncompleteEntries: vi.fn(),
    authState: { role: 'ADMIN' as string },
}));

vi.mock('../../../src/lib/supabase/timetable', async () => {
    // The grid builder and period describer are pure logic worth testing for
    // real; only the database access is mocked.
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
        '../../../src/lib/supabase/timetable'
    );
    return {
        ...actual,
        getActiveTimetable: (...a: unknown[]) => getActiveTimetable(...a),
        getClassTimetable: (...a: unknown[]) => getClassTimetable(...a),
        getTeacherTimetable: (...a: unknown[]) => getTeacherTimetable(...a),
        listTimetableClasses: (...a: unknown[]) => listTimetableClasses(...a),
        listTimetableTeachers: (...a: unknown[]) => listTimetableTeachers(...a),
        findIncompleteEntries: (...a: unknown[]) => findIncompleteEntries(...a),
    };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1' }, role: authState.role, loading: false }),
}));

const renderScreen = (props: Record<string, unknown> = {}) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><TimetableScreen {...props} /></MemoryRouter>
        </QueryClientProvider>
    );

const TT = {
    id: 'tt1', name: 'Jadual Rasmi 2026', version: 1,
    status: 'PUBLISHED' as const, effectiveFrom: '2026-01-05', publishedAt: '2026-01-01',
};

// A minimal real school day: period 1 assembly on Sunday, break at period 5.
const period = (day: string, n: number, type = 'TEACHING', label: string | null = null) => ({
    id: `p-${day}-${n}`, dayOfWeek: day as any, periodNumber: n,
    startTime: '07:30', endTime: '08:05', type: type as any, label,
});

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'];

function realWeek() {
    const periods: any[] = [];
    for (const d of DAYS) {
        periods.push(period(d, 1, d === 'SUNDAY' ? 'ASSEMBLY' : d === 'THURSDAY' ? 'ACTIVITY' : 'TEACHING',
            d === 'SUNDAY' ? 'Perhimpunan' : d === 'THURSDAY' ? 'Yasin/Dhuha' : null));
        periods.push(period(d, 5, 'BREAK', 'Rehat'));
        periods.push(period(d, 11, 'PRAYER', 'Zohor'));
    }
    return periods;
}

describe('TimetableScreen — SRIK', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveTimetable.mockResolvedValue(TT);
        listTimetableClasses.mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi', periodsPerWeek: 47 }]);
        listTimetableTeachers.mockResolvedValue([{ id: 't1', label: 'Ustaz Fadil', periodsPerWeek: 10 }]);
        findIncompleteEntries.mockResolvedValue({ missingTeacher: 0, missingSubject: 0, total: 329 });
    });

    it('names a non-teaching period instead of leaving it blank', async () => {
        // Thursday period 1 should read "Yasin/Dhuha". A gap would hide it.
        // All three row types must be present for this test to mean anything:
        // a ceremony row, a break row and a prayer row.
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [
            { periodNumber: 1, time: '07:30 - 08:05', cells: DAYS.map(d => ({ period: period(d, 1, d === 'THURSDAY' ? 'ACTIVITY' : 'TEACHING', d === 'THURSDAY' ? 'Yasin/Dhuha' : null), entry: null })) },
            { periodNumber: 5, time: '09:50 - 10:25', cells: DAYS.map(d => ({ period: period(d, 5, 'BREAK', 'Rehat' as any), entry: null })) },
            { periodNumber: 11, time: '13:20 - 14:00', cells: DAYS.map(d => ({ period: period(d, 11, 'PRAYER', 'Zohor' as any), entry: null })) },
        ] });
        renderScreen();

        // Yasin/Dhuha happens once a week, on Thursday period 1 only.
        expect(await screen.findByText('Yasin/Dhuha')).toBeDefined();
        // Break and Zohor happen every school day, so five cells each. That the
        // count is five is the point: the whole week is laid out, not one column.
        expect(screen.getAllByText('Rehat')).toHaveLength(5);
        expect(screen.getAllByText('Zohor')).toHaveLength(5);
    });

    it('shows a lesson with its subject and teacher', async () => {
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [
            { periodNumber: 3, time: '08:40 - 09:15', cells: DAYS.map((d, i) => ({
                period: period(d, 3),
                entry: i === 0 ? {
                    id: 'e1', periodId: 'p-SUNDAY-3', classId: 'c1', className: '3 Al-Junaidi',
                    subjectId: 's1', subjectCode: 'TF', subjectName: 'Tafsir',
                    teacherId: 't1', teacherName: 'Ustaz Fadil', room: null, activity: null,
                } : null,
            })) },
        ] });
        renderScreen();

        expect(await screen.findByText('TF')).toBeDefined();
        expect(screen.getByText('Ustaz Fadil')).toBeDefined();
    });

    it('marks a lesson that has no teacher, rather than hiding it', async () => {
        // On a grid an unstaffed lesson and a finished one look identical.
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [
            { periodNumber: 3, time: '08:40 - 09:15', cells: DAYS.map((d, i) => ({
                period: period(d, 3),
                entry: i === 0 ? {
                    id: 'e1', periodId: 'p-SUNDAY-3', classId: 'c1', className: '3 Al-Junaidi',
                    subjectId: 's1', subjectCode: 'TF', subjectName: 'Tafsir',
                    teacherId: null, teacherName: null, room: null, activity: null,
                } : null,
            })) },
        ] });
        findIncompleteEntries.mockResolvedValue({ missingTeacher: 1, missingSubject: 0, total: 329 });
        renderScreen();

        expect(await screen.findByText('no teacher')).toBeDefined();
        expect(await screen.findByText('Belum ada guru')).toBeDefined();
    });

    it('warns that a draft is not yet in force', async () => {
        getActiveTimetable.mockResolvedValue({ ...TT, status: 'DRAFT' as const, publishedAt: null });
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        renderScreen();

        expect(await screen.findByText(/masih draf/i)).toBeDefined();
    });

    it('does not warn when the timetable is published', async () => {
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        renderScreen();

        await screen.findByText('Jadual Rasmi 2026');
        expect(screen.queryByText(/masih draf/i)).toBeNull();
    });

    it('shows the same week from the teacher side when asked', async () => {
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        getTeacherTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [
            { periodNumber: 3, time: '08:40 - 09:15', cells: DAYS.map((d, i) => ({
                period: period(d, 3),
                entry: i === 0 ? {
                    id: 'e1', periodId: 'p-SUNDAY-3', classId: 'c1', className: '4 Al-Junaidi',
                    subjectId: 's1', subjectCode: 'TF', subjectName: 'Tafsir',
                    teacherId: 't1', teacherName: 'Ustaz Fadil', room: null, activity: null,
                } : null,
            })) },
        ] });
        renderScreen();

        await screen.findByText('Jadual Rasmi 2026');
        fireEvent.click(screen.getByText('Ikut Guru'));

        // On a teacher's grid the useful other half is the CLASS, not their own name.
        expect(await screen.findByText('4 Al-Junaidi')).toBeDefined();
        expect(getTeacherTimetable).toHaveBeenCalledWith('tt1', 't1');
    });

    it('explains an empty school rather than showing a blank grid', async () => {
        getActiveTimetable.mockResolvedValue(null);
        renderScreen();

        expect(await screen.findByText('Belum Ada Jadual')).toBeDefined();
    });

    it('says when a class has no lessons, naming the class', async () => {
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        renderScreen();

        expect(await screen.findByText('Nothing Timetabled')).toBeDefined();
        expect(screen.getByText(/3 Al-Junaidi/)).toBeDefined();
    });

    it('reports a failure to load instead of showing an empty week', async () => {
        getClassTimetable.mockRejectedValue(new Error('offline'));
        renderScreen();

        expect(await screen.findByText('Could not load the week')).toBeDefined();
    });
});

describe('buildGrid — the school day is real', () => {
    it('keeps every period, so break and Zohor have their own row', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
            '../../../src/lib/supabase/timetable'
        );
        const periods = realWeek();
        const grid = actual.buildGrid(periods as any, []);

        // 15 period numbers across the week: 1, 5 and 11 each day.
        expect(grid.map(r => r.periodNumber)).toEqual([1, 5, 11]);
        // Five days in every row — the week is always five columns wide.
        expect(grid.every(r => r.cells.length === 5)).toBe(true);
    });

    it('leaves a cell empty rather than inventing a lesson', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
            '../../../src/lib/supabase/timetable'
        );
        const grid = actual.buildGrid(realWeek() as any, []);
        // Nothing was timetabled, so every teaching cell must be null.
        const teachingCells = grid.flatMap(r => r.cells).filter(c => c.entry);
        expect(teachingCells).toHaveLength(0);
    });

    it('describes non-teaching periods by name and teaching periods as teachable', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
            '../../../src/lib/supabase/timetable'
        );
        expect(actual.describePeriod(period('SUNDAY', 5, 'BREAK', 'Rehat' as any) as any))
            .toEqual({ title: 'Rehat', isTeaching: false });
        expect(actual.describePeriod(period('SUNDAY', 11, 'PRAYER', 'Zohor' as any) as any))
            .toEqual({ title: 'Zohor', isTeaching: false });
        expect(actual.describePeriod(period('MONDAY', 3, 'TEACHING') as any))
            .toEqual({ title: '', isTeaching: true });
    });

    it('names the school week in the order the school runs it', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/timetable')>(
            '../../../src/lib/supabase/timetable'
        );
        // Sunday to Thursday — the Malaysian school week, not Monday to Friday.
        expect(actual.SCHOOL_DAYS.map(d => d.key))
            .toEqual(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']);
    });
});

/**
 * THE RULE: a student, parent or teacher sees their OWN week and cannot browse
 * anyone else's.
 *
 * The class/teacher picker existed because the office needs to look up any class.
 * Handing that picker to everyone else was not just clutter: it offered a student
 * a dropdown of every class in the school, and a parent a list of every teacher.
 * The screen now resolves the signed-in person's own class or teacher row from
 * the database, which returns only what that person is allowed to see.
 */
describe('TimetableScreen — who may look at whose week', () => {
    const asRole = (role: string) => { authState.role = role; };

    beforeEach(() => {
        getActiveTimetable.mockResolvedValue(TT);
        listTimetableClasses.mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi', periodsPerWeek: 47 }]);
        listTimetableTeachers.mockResolvedValue([{ id: 't1', label: 'Ustaz Ahmad', periodsPerWeek: 20 }]);
        getClassTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        getTeacherTimetable.mockResolvedValue({ periods: realWeek(), entries: [], grid: [] });
        findIncompleteEntries.mockResolvedValue({ missingTeacher: 0, missingSubject: 0 });
    });

    it('THE RULE: the office sees the class and teacher picker', async () => {
        asRole('ADMIN');
        renderScreen();
        expect(await screen.findByText('Kelas')).toBeDefined();
        expect(screen.getByText('Ikut Guru')).toBeDefined();
    });

    it('THE RULE: a student is not offered a way to browse other classes', async () => {
        asRole('STUDENT');
        renderScreen();
        // The week itself still loads; only the picker is withheld.
        await screen.findByText('Jadual Rasmi 2026');
        expect(screen.queryByText('Ikut Guru')).toBeNull();
        expect(screen.queryByText('Kelas')).toBeNull();
    });

    it('THE RULE: a parent is not offered a way to browse other teachers', async () => {
        asRole('PARENT');
        renderScreen();
        await screen.findByText('Jadual Rasmi 2026');
        expect(screen.queryByText('Ikut Guru')).toBeNull();
        expect(screen.queryByText('Guru')).toBeNull();
    });

    it('THE RULE: only the office is offered the editor', async () => {
        asRole('ADMIN');
        renderScreen({ navigateTo: vi.fn() });
        expect(await screen.findByText('Sunting')).toBeDefined();
    });

    it('THE RULE: a teacher is not offered the editor', async () => {
        asRole('TEACHER');
        // A teacher's own week, which the database resolves for them.
        renderScreen({ navigateTo: vi.fn() });
        await screen.findByText('Jadual Rasmi 2026');
        expect(screen.queryByText('Sunting')).toBeNull();
    });
});
