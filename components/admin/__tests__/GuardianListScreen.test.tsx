/**
 * Guardians — SRIK.
 *
 * The original screen called these people "Parents" and read them from a
 * separate service as a third kind of user. At SRIK a guardian is a contact on
 * a student's record, so these tests cover the things the office actually does:
 * find a person quickly, reach a phone number, and see which children they
 * belong to.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import GuardianListScreen from '../ParentListScreen';

const { listGuardians, saveGuardian, deleteGuardian } = vi.hoisted(() => ({
    listGuardians: vi.fn(), saveGuardian: vi.fn(), deleteGuardian: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/students', () => ({
    listGuardians: (...a: unknown[]) => listGuardians(...a),
    saveGuardian: (...a: unknown[]) => saveGuardian(...a),
    deleteGuardian: (...a: unknown[]) => deleteGuardian(...a),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({
    toastError: vi.fn(), toastSuccess: vi.fn(),
}));
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
            <MemoryRouter><GuardianListScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const guardian = (over: Record<string, unknown> = {}) => ({
    id: 'g1',
    fullName: 'Hajah Fatimah',
    phone: '0123456789',
    email: 'fatimah@example.com',
    identityNo: null,
    address: null,
    occupation: 'Teacher',
    hasLogin: false,
    children: [{
        studentId: 's1', fullName: 'Ahmad Zaki', className: '3 Al-Junaidi',
        relationship: 'Mother', isPrimary: true,
    }],
    ...over,
});

describe('GuardianListScreen — SRIK guardians', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.confirm = vi.fn(() => true);
    });

    it('lists guardians with their contact details', async () => {
        listGuardians.mockResolvedValue([guardian()]);
        renderScreen();

        expect(await screen.findByText('Hajah Fatimah')).toBeDefined();
        expect(screen.getByText('0123456789')).toBeDefined();
        expect(screen.getByText('fatimah@example.com')).toBeDefined();
    });

    it('shows which children a guardian belongs to, with their class', async () => {
        listGuardians.mockResolvedValue([guardian()]);
        renderScreen();

        expect(await screen.findByText('Ahmad Zaki')).toBeDefined();
        expect(screen.getByText('3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText('(mother)')).toBeDefined();
        expect(screen.getByText('Main contact')).toBeDefined();
    });

    it('explains when a guardian is not linked to a student yet', async () => {
        listGuardians.mockResolvedValue([guardian({ children: [] })]);
        renderScreen();

        await screen.findByText('Hajah Fatimah');
        expect(screen.getByText(/Not linked to any student yet/)).toBeDefined();
    });

    it('finds a guardian by the child\'s name', async () => {
        // The office usually starts from the child: "whose mother is this?"
        listGuardians.mockResolvedValue([
            guardian(),
            guardian({ id: 'g2', fullName: 'Haji Osman', phone: '0198887777', email: null, children: [] }),
        ]);
        renderScreen();

        await screen.findByText('Hajah Fatimah');
        fireEvent.change(screen.getByLabelText('Search guardians'), { target: { value: 'ahmad' } });

        expect(screen.getByText('Hajah Fatimah')).toBeDefined();
        expect(screen.queryByText('Haji Osman')).toBeNull();
    });

    it('finds a guardian by phone number', async () => {
        listGuardians.mockResolvedValue([
            guardian(),
            guardian({ id: 'g2', fullName: 'Haji Osman', phone: '0198887777', email: null, children: [] }),
        ]);
        renderScreen();

        await screen.findByText('Hajah Fatimah');
        fireEvent.change(screen.getByLabelText('Search guardians'), { target: { value: '019888' } });

        expect(screen.getByText('Haji Osman')).toBeDefined();
        expect(screen.queryByText('Hajah Fatimah')).toBeNull();
    });

    it('adds a guardian with a name and phone number', async () => {
        listGuardians.mockResolvedValue([]);
        saveGuardian.mockResolvedValue({ success: true, guardianId: 'g-new' });
        renderScreen();

        await screen.findByText('No Guardians Yet');
        fireEvent.click(screen.getByRole('button', { name: /add guardian/i }));

        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Haji Osman' } });
        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0198887777' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(saveGuardian).toHaveBeenCalledTimes(1));
        expect(saveGuardian.mock.calls[0][0]).toMatchObject({ fullName: 'Haji Osman', phone: '0198887777' });
    });

    it('refuses a guardian with no name or phone number', async () => {
        listGuardians.mockResolvedValue([]);
        renderScreen();

        await screen.findByText('No Guardians Yet');
        fireEvent.click(screen.getByRole('button', { name: /add guardian/i }));

        const form = screen.getByLabelText('Full name').closest('form')!;
        fireEvent.submit(form);

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(saveGuardian).not.toHaveBeenCalled();
    });

    it('tells the owner to unlink a guardian before removing them', async () => {
        // Removing a parent from the list must not silently detach them from a
        // child; that is a deliberate act on the student's record.
        listGuardians.mockResolvedValue([guardian()]);
        deleteGuardian.mockResolvedValue({
            success: false,
            error: 'This guardian is still linked to 1 student. Remove the link from the student\'s record first.',
        });
        renderScreen();

        await screen.findByText('Hajah Fatimah');
        fireEvent.click(screen.getByLabelText('Remove Hajah Fatimah'));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(String(toastError.mock.calls[0][0])).toMatch(/link from the student/i);
    });

    it('shows a child\'s class from their current enrollment', async () => {
        // A student's class is NOT a column on the student: it lives on the open
        // enrollment, because the same child moves up a year. Reading it off the
        // student showed no class for any child, which was a real bug.
        listGuardians.mockResolvedValue([guardian({
            children: [
                { studentId: 's1', fullName: 'Ahmad Zaki', className: '3 Al-Junaidi', relationship: 'Mother', isPrimary: true },
                { studentId: 's2', fullName: 'Nur Aisyah', className: "5 Na'im", relationship: 'Mother', isPrimary: true },
            ],
        })]);
        renderScreen();

        // Both children of one family, each with the class the school uses.
        expect(await screen.findByText('Ahmad Zaki')).toBeDefined();
        expect(screen.getByText('3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText('Nur Aisyah')).toBeDefined();
        expect(screen.getByText("5 Na'im")).toBeDefined();
    });

    it('says plainly when a search matches nothing', async () => {
        listGuardians.mockResolvedValue([guardian()]);
        renderScreen();

        await screen.findByText('Hajah Fatimah');
        fireEvent.change(screen.getByLabelText('Search guardians'), { target: { value: 'zzzz' } });

        expect(screen.getByText('No Matches')).toBeDefined();
    });
});
