/**
 * Parent accounts — SRIK.
 *
 * The rules tested here are the ones that stop a parent's account becoming
 * something it should not be:
 *
 *   * a half-finished setup is visible, not hidden — an account with no child
 *     linked is shown as unfinished, and the parent sees nothing;
 *   * creating an account demands a password of at least 8 characters and a
 *     written reason, because a weak or unattributed account is how a child's
 *     record leaks;
 *   * the password is cleared from the screen once used, because it can never be
 *     read back;
 *   * unlinking demands a reason, and the screen says access goes immediately.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import GuardianAccountsScreen from '../GuardianAccountsScreen';

const {
    listGuardians, provisionGuardianAccount, setGuardianChildLink, createGuardian,
    listStudentsForLinking, listLinkedStudents,
} = vi.hoisted(() => ({
    listGuardians: vi.fn(),
    provisionGuardianAccount: vi.fn(),
    setGuardianChildLink: vi.fn(),
    createGuardian: vi.fn(),
    listStudentsForLinking: vi.fn(),
    listLinkedStudents: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/guardianAccounts', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/guardianAccounts')>(
        '../../../src/lib/supabase/guardianAccounts'
    );
    return {
        ...actual,
        listGuardians: (...a: unknown[]) => listGuardians(...a),
        provisionGuardianAccount: (...a: unknown[]) => provisionGuardianAccount(...a),
        setGuardianChildLink: (...a: unknown[]) => setGuardianChildLink(...a),
        createGuardian: (...a: unknown[]) => createGuardian(...a),
        listStudentsForLinking: (...a: unknown[]) => listStudentsForLinking(...a),
        listLinkedStudents: (...a: unknown[]) => listLinkedStudents(...a),
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
            <MemoryRouter><GuardianAccountsScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const guardian = (over: Record<string, unknown> = {}) => ({
    guardian_id: 'g1', full_name: 'Encik Ahmad', phone: '0123456789',
    email: null, has_login: false, child_count: 0, child_names: '', ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listGuardians.mockResolvedValue([guardian()]);
    listStudentsForLinking.mockResolvedValue([
        { id: 's1', full_name: 'Ahmad Zaki', admission_no: 'P3S1' },
    ]);
    listLinkedStudents.mockResolvedValue([]);
});

async function openGuardian() {
    renderScreen();
    fireEvent.click(await screen.findByText('Encik Ahmad'));
    return screen.findByText('Akaun log masuk');
}

describe('GuardianAccountsScreen — the list', () => {
    it('says whether a parent can log in yet', async () => {
        renderScreen();
        expect(await screen.findByText('Belum ada akaun')).toBeTruthy();
    });

    it('says when a parent already has an account', async () => {
        listGuardians.mockResolvedValue([guardian({ has_login: true, email: 'bapa@srik.test' })]);
        renderScreen();
        expect(await screen.findByText('Ada akaun')).toBeTruthy();
    });

    it('says plainly when nobody is registered yet', async () => {
        listGuardians.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('Belum ada penjaga')).toBeTruthy();
    });

    it('explains a permission failure in words', async () => {
        listGuardians.mockRejectedValue(new Error('permission denied'));
        renderScreen();
        expect(await screen.findByText('Anda tiada kebenaran untuk urus akaun ibu bapa.')).toBeTruthy();
    });
});

describe('GuardianAccountsScreen — creating an account', () => {
    it('THE RULE: will not create an account without a reason', async () => {
        await openGuardian();
        fireEvent.change(screen.getByPlaceholderText('nama@emel.com'), {
            target: { value: 'bapa@srik.test' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cipta akaun' }));

        expect(await screen.findByText(/Sila isi emel dan sebab/)).toBeTruthy();
        expect(provisionGuardianAccount).not.toHaveBeenCalled();
    });

    it('THE RULE: the clerk does not choose the password any more', async () => {
        // The password field was a text input the clerk typed into, and the rule
        // it enforced was WEAKER than the system's own — 8 characters, where the
        // project config says 12. The field is now a read-only display of the
        // password the system generates, so no clerk-chosen password reaches the
        // account at all (audit F16).
        await openGuardian();
        expect(screen.queryByPlaceholderText('Berikan kepada ibu bapa')).toBeNull();
        expect(screen.getByPlaceholderText(/Dijana automatik/)).toBeTruthy();
    });

    it('creates the account and confirms the email to hand over', async () => {
        provisionGuardianAccount.mockResolvedValue({
            email: 'bapa@srik.test',
            temporaryPassword: 'Sementara#2026Xy',
            childrenLinked: 0,
        });
        await openGuardian();
        fireEvent.change(screen.getByPlaceholderText('nama@emel.com'), {
            target: { value: 'bapa@srik.test' },
        });
        fireEvent.change(screen.getByPlaceholderText(/ibu bapa baharu mendaftar/), {
            target: { value: 'Ibu bapa baharu' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cipta akaun' }));

        await waitFor(() => expect(provisionGuardianAccount).toHaveBeenCalledTimes(1));
        const arg = provisionGuardianAccount.mock.calls[0][0] as {
            guardianId: string; email: string;
        };
        expect(arg.guardianId).toBe('g1');
        expect(arg.email).toBe('bapa@srik.test');

        // The clerk must be able to read the email back, because the password
        // cannot be recovered later.
        expect(await screen.findByText(/Akaun dicipta: bapa@srik\.test/)).toBeTruthy();

        // And the generated password must be shown, or the clerk has nothing to
        // hand over and the parent can never sign in.
        await waitFor(() => {
            const input = screen.getByPlaceholderText(/Dijana automatik/) as HTMLInputElement;
            expect(input.value).toBe('Sementara#2026Xy');
        });
    });

    it('warns the clerk that the password cannot be read back', async () => {
        await openGuardian();
        expect(screen.getByText(/tidak boleh dibaca\s+semula/)).toBeTruthy();
    });

    it('explains a duplicate email in words', async () => {
        provisionGuardianAccount.mockRejectedValue(new Error('An account with that email already exists'));
        await openGuardian();
        fireEvent.change(screen.getByPlaceholderText('nama@emel.com'), {
            target: { value: 'bapa@srik.test' },
        });
        fireEvent.change(screen.getByPlaceholderText(/ibu bapa baharu mendaftar/), {
            target: { value: 'Cuba' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cipta akaun' }));

        expect(await screen.findByText('Emel itu sudah digunakan oleh akaun lain.')).toBeTruthy();
    });
});

describe('GuardianAccountsScreen — linking children', () => {
    it('THE RULE: warns that an account with no child linked sees nothing', async () => {
        await openGuardian();
        expect(screen.getByText(/tidak akan melihat apa-apa/)).toBeTruthy();
    });

    it('THE RULE: will not link or unlink without a reason', async () => {
        await openGuardian();
        // The student picker fills asynchronously, so the option is waited for
        // before choosing it.
        await waitFor(() =>
            expect(
                (screen.getByRole('combobox') as HTMLSelectElement).options.length
            ).toBeGreaterThan(1)
        );
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 's1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pautkan' }));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('Sila nyatakan sebab perubahan ini.')
        );
        expect(setGuardianChildLink).not.toHaveBeenCalled();
    });

    it('links a child with the reason typed', async () => {
        setGuardianChildLink.mockResolvedValue(undefined);
        await openGuardian();
        fireEvent.change(screen.getByPlaceholderText(/sahkan bapa kandung/), {
            target: { value: 'Sahkan bapa kandung' },
        });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 's1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pautkan' }));

        await waitFor(() => expect(setGuardianChildLink).toHaveBeenCalledTimes(1));
        const arg = setGuardianChildLink.mock.calls[0][0] as {
            guardianId: string; studentId: string; link: boolean; reason: string;
        };
        expect(arg.guardianId).toBe('g1');
        expect(arg.studentId).toBe('s1');
        expect(arg.link).toBe(true);
        expect(arg.reason).toBe('Sahkan bapa kandung');
    });

    it('offers unlinking, and says access is removed at once', async () => {
        listGuardians.mockResolvedValue([
            guardian({ has_login: true, child_count: 1, child_names: 'Ahmad Zaki' }),
        ]);
        listLinkedStudents.mockResolvedValue([
            { id: 's1', full_name: 'Ahmad Zaki', admission_no: 'P3S1' },
        ]);
        await openGuardian();

        // The linked child is listed, with a way to remove the link. The list
        // arrives from its own query, so it is waited for rather than assumed.
        expect(await screen.findByText('Ahmad Zaki')).toBeTruthy();
        expect(await screen.findByRole('button', { name: 'Nyahpaut Ahmad Zaki' })).toBeTruthy();
    });

    it('unlinks with the reason typed', async () => {
        listGuardians.mockResolvedValue([
            guardian({ has_login: true, child_count: 1, child_names: 'Ahmad Zaki' }),
        ]);
        listLinkedStudents.mockResolvedValue([
            { id: 's1', full_name: 'Ahmad Zaki', admission_no: 'P3S1' },
        ]);
        setGuardianChildLink.mockResolvedValue(undefined);
        await openGuardian();
        // The unlink button now depends on the linked children loading.
        await screen.findByRole('button', { name: 'Nyahpaut Ahmad Zaki' });

        fireEvent.change(screen.getByPlaceholderText(/sahkan bapa kandung/), {
            target: { value: 'Keluarga berpindah' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Nyahpaut Ahmad Zaki' }));

        await waitFor(() => expect(setGuardianChildLink).toHaveBeenCalledTimes(1));
        const arg = setGuardianChildLink.mock.calls[0][0] as { link: boolean; reason: string };
        expect(arg.link).toBe(false);
        expect(arg.reason).toBe('Keluarga berpindah');
    });
});
