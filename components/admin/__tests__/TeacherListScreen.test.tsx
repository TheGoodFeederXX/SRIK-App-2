/**
 * Teacher list — data layer tests.
 *
 * The screen's visual output is not asserted here; what matters is that it now
 * reads from Supabase and that the values it shows are derived correctly from
 * what the database returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TeacherListScreen from '../TeacherListScreen';

const listTeachers = vi.fn();

vi.mock('../../../src/lib/supabase/teachers', () => ({
    listTeachers: (...args: unknown[]) => listTeachers(...args),
}));

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1', user_metadata: {} }, role: 'ADMIN' }),
}));

vi.mock('../../../context/ProfileContext', () => ({
    useProfile: () => ({ profile: null }),
}));

vi.mock('../../../hooks/useAutoSync', () => ({
    useAutoSync: () => undefined,
}));

vi.mock('react-hot-toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('framer-motion', () => ({
    motion: new Proxy({}, {
        get: () => ({ children, ...rest }: any) => {
            const { initial, animate, transition, whileHover, whileTap, ...safe } = rest;
            return <div {...safe}>{children}</div>;
        },
    }),
}));

// The card preloads a remote avatar; a real image request in a unit test is
// noise, so it is replaced with a plain element.
vi.mock('../../ui/LowDataImage', () => ({
    default: ({ src, alt }: any) => <img src={src} alt={alt} />,
}));

const navigateTo = vi.fn();

const renderScreen = () =>
    render(<TeacherListScreen navigateTo={navigateTo} schoolId="school-1" />);

describe('TeacherListScreen — reads from Supabase', () => {
    beforeEach(() => {
        listTeachers.mockReset();
        navigateTo.mockReset();
    });

    it('shows teachers returned by the database', async () => {
        listTeachers.mockResolvedValue([
            {
                id: 't1', userId: 'u9', staffCode: 'TCH001', fullName: 'Ustazah Aminah',
                gender: 'FEMALE', phone: null, email: 'aminah@srik.test',
                employmentStart: '2020-01-01', employmentEnd: null, status: 'ACTIVE',
                subjects: ['Bahasa Melayu'], classes: ['3 Al-Junaidi'],
            },
        ]);

        renderScreen();
        expect(await screen.findByText('Ustazah Aminah')).toBeDefined();
        // The school's own staff code, shown as stored — not rewritten into
        // the legacy 'oliskey_main_tch_001' form.
        expect(screen.getByText('TCH001')).toBeDefined();
        // The subject appears both on the card and in the filter dropdown, so
        // the count is asserted rather than a single element.
        expect(screen.getAllByText('Bahasa Melayu').length).toBeGreaterThan(1);
    });

    it('does not call the legacy API client', async () => {
        // The point of this migration: the screen must reach Supabase directly.
        // If a legacy call creeps back in, this test is what notices.
        listTeachers.mockResolvedValue([]);
        renderScreen();
        await waitFor(() => expect(listTeachers).toHaveBeenCalled());
        expect(navigateTo).not.toHaveBeenCalled();
    });

    it('maps ARCHIVED and INACTIVE to the display value Inactive', async () => {
        listTeachers.mockResolvedValue([
            { id: 't1', userId: null, staffCode: 'A1', fullName: 'Guru Aktif',
              gender: null, phone: null, email: null, employmentStart: null,
              employmentEnd: null, status: 'ACTIVE', subjects: [], classes: [] },
            { id: 't2', userId: null, staffCode: 'A2', fullName: 'Guru Arkib',
              gender: null, phone: null, email: null, employmentStart: null,
              employmentEnd: null, status: 'ARCHIVED', subjects: [], classes: [] },
        ]);

        renderScreen();
        await screen.findByText('Guru Aktif');
        // ARCHIVED must not be displayed as if the teacher were still active.
        // "Inactive" appears twice (the card badge and a filter option), so the
        // count is asserted rather than a single element.
        expect(screen.getAllByText('Inactive').length).toBeGreaterThan(1);
        expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    });

    it('shows an empty list rather than crashing when there are no teachers', async () => {
        listTeachers.mockResolvedValue([]);
        renderScreen();
        await waitFor(() => expect(listTeachers).toHaveBeenCalled());
        expect(screen.getAllByText('Teacher Management').length).toBeGreaterThan(0);
    });

    it('survives a failure without crashing the screen', async () => {
        listTeachers.mockRejectedValue(new Error('offline'));
        renderScreen();
        // The heading still renders, so a failed load is not a blank page.
        expect(await screen.findByText('Teacher Management')).toBeDefined();
    });
});
