/**
 * Daily attendance register — SRIK.
 *
 * The source project had no register screen at all, so these tests are about
 * the rules that make a register trustworthy rather than about an old UI:
 * that an unmarked child is NOT absent, that the whole class is saved in one
 * call, and that a partly-marked register is questioned before it is written.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import AttendanceRegisterScreen from '../AttendanceRegisterScreen';

const { listClasses, getClassRegister, recordRegister } = vi.hoisted(() => ({
    listClasses: vi.fn(), getClassRegister: vi.fn(), recordRegister: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/academics', () => ({
    listClasses: (...a: unknown[]) => listClasses(...a),
}));

vi.mock('../../../src/lib/supabase/attendance', async () => {
    // The date helpers are pure and worth testing for real; only the I/O is mocked.
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/attendance')>(
        '../../../src/lib/supabase/attendance'
    );
    return {
        ...actual,
        getClassRegister: (...a: unknown[]) => getClassRegister(...a),
        recordRegister: (...a: unknown[]) => recordRegister(...a),
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
            <MemoryRouter><AttendanceRegisterScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const CLS = {
    id: 'c1', yearLevel: 3, name: 'Al-Junaidi', code: '3J',
    displayName: '3 Al-Junaidi', status: 'ACTIVE', academicYearId: 'y1', studentCount: 2,
};

const row = (over: Record<string, unknown> = {}) => ({
    studentId: 's1', studentName: 'Ahmad Zaki', admissionNo: 'P3S1',
    classId: 'c1', classDisplayName: '3 Al-Junaidi', enrollmentId: 'e1',
    status: null, remark: null, ...over,
});

describe('AttendanceRegisterScreen — SRIK register', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
        listClasses.mockResolvedValue([CLS]);
    });

    it('starts with nobody marked, rather than assuming everyone is present', async () => {
        // Pre-marking everyone present would let an interrupted teacher leave a
        // register that looks finished and is wrong.
        getClassRegister.mockResolvedValue([row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2', enrollmentId: 'e2' })]);
        renderScreen();

        expect(await screen.findByText('Ahmad Zaki')).toBeDefined();
        expect(screen.getByText('2 still to mark.')).toBeDefined();
        expect(getClassRegister).toHaveBeenCalledWith('c1', expect.any(String));
    });

    it('says plainly that nobody is marked yet, using the words the office uses', async () => {
        getClassRegister.mockResolvedValue([row()]);
        renderScreen();

        // "not recorded" must not be dressed up as anything else.
        expect(await screen.findByText(/not recorded/)).toBeDefined();
    });

    it('saves the whole class in one call, not one call per student', async () => {
        getClassRegister.mockResolvedValue([
            row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2', enrollmentId: 'e2' }),
        ]);
        recordRegister.mockResolvedValue({ success: true, recorded: 2, corrected: 0 });
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getByLabelText('Present for Ahmad Zaki'));
        fireEvent.click(screen.getByLabelText('Absent for Nur Aisyah'));
        fireEvent.click(screen.getByText(/Save register/));

        await waitFor(() => expect(recordRegister).toHaveBeenCalledTimes(1));
        const [, , entries] = recordRegister.mock.calls[0];
        expect(entries).toHaveLength(2);
        expect(entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ studentId: 's1', status: 'PRESENT' }),
            expect.objectContaining({ studentId: 's2', status: 'ABSENT' }),
        ]));
    });

    it('warns before saving while some students have no mark', async () => {
        // Writing a partly-marked register would leave the rest "not recorded",
        // which is not what the teacher meant to do.
        getClassRegister.mockResolvedValue([
            row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2', enrollmentId: 'e2' }),
        ]);
        recordRegister.mockResolvedValue({ success: true, recorded: 1, corrected: 0 });
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getByLabelText('Present for Ahmad Zaki'));
        fireEvent.click(screen.getByText(/Save register/));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(String((window.confirm as any).mock.calls[0][0])).toMatch(/1 student has no mark/i);
    });

    it('does not save when the teacher cancels the warning', async () => {
        window.confirm = vi.fn(() => false);
        getClassRegister.mockResolvedValue([
            row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2', enrollmentId: 'e2' }),
        ]);
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getByLabelText('Present for Ahmad Zaki'));
        fireEvent.click(screen.getByText(/Save register/));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(recordRegister).not.toHaveBeenCalled();
    });

    it('marks the rest present with one tap', async () => {
        getClassRegister.mockResolvedValue([
            row(), row({ studentId: 's2', studentName: 'Nur Aisyah', admissionNo: 'P3S2', enrollmentId: 'e2' }),
        ]);
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getByText('Mark the rest present'));

        expect(screen.getByText('Everyone has a mark.')).toBeDefined();
    });

    it('loads what was already recorded back into the register', async () => {
        getClassRegister.mockResolvedValue([row({ status: 'SICK', remark: 'Demam' })]);
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        // With every child already marked, there is nothing left to do.
        expect(screen.getByText('Everyone has a mark.')).toBeDefined();
        expect(screen.getByText('Register is saved')).toBeDefined();
    });

    it('reports a failed save instead of pretending it worked', async () => {
        getClassRegister.mockResolvedValue([row()]);
        recordRegister.mockResolvedValue({ success: false, error: 'offline' });
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        fireEvent.click(screen.getByLabelText('Present for Ahmad Zaki'));
        fireEvent.click(screen.getByText(/Save register/));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('offline'));
    });

    it('says when a class has nobody to mark', async () => {
        getClassRegister.mockResolvedValue([]);
        renderScreen();

        expect(await screen.findByText('Nobody In This Class')).toBeDefined();
    });

    it('points out a date that is not a school day', async () => {
        // Friday and Saturday are the weekend; a register on those days is
        // almost always a mistyped date.
        getClassRegister.mockResolvedValue([row()]);
        renderScreen();

        await screen.findByText('Ahmad Zaki');
        const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
        fireEvent.change(dateInput, { target: { value: '2026-10-09' } }); // a Friday

        expect(await screen.findByText(/not a school day/i)).toBeDefined();
    });
});

describe('Attendance date handling — Malaysia', () => {
    it('computes today in Kuala Lumpur, not from the device clock', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/attendance')>(
            '../../../src/lib/supabase/attendance'
        );
        const today = actual.todayInKualaLumpur();
        expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // It must be the Malaysian date, whatever the runner's timezone is.
        const expected = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        expect(today).toBe(expected);
    });

    it('treats Sunday to Thursday as school days and the weekend as not', async () => {
        const actual = await vi.importActual<typeof import('../../../src/lib/supabase/attendance')>(
            '../../../src/lib/supabase/attendance'
        );
        // 2026-10-04 is a Sunday; 2026-10-08 a Thursday; 2026-10-09 a Friday.
        expect(actual.isSchoolDay('2026-10-04')).toBe(true);
        expect(actual.isSchoolDay('2026-10-08')).toBe(true);
        expect(actual.isSchoolDay('2026-10-09')).toBe(false);
        expect(actual.isSchoolDay('2026-10-10')).toBe(false);
    });
});
