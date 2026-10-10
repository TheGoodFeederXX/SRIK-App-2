/**
 * A child's fee statement — SRIK.
 *
 * The rules tested here are the ones a parent would notice if they were wrong:
 *
 *   * the totals are built from the charges, and a cancelled charge is not owed;
 *   * a discount needs a reason, because the school must be able to explain it;
 *   * a charge that already has money against it cannot be waived — the payment
 *     must be reversed first, or the books would show a refund nobody made;
 *   * a family with more than one child is shown the family total.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import StudentFeesScreen from '../StudentFeesScreen';

const { listActiveStudents, listStudentCharges, familyBalance, setChargeDiscount, setChargeStatus } =
    vi.hoisted(() => ({
        listActiveStudents: vi.fn(),
        listStudentCharges: vi.fn(),
        familyBalance: vi.fn(),
        setChargeDiscount: vi.fn(),
        setChargeStatus: vi.fn(),
    }));

vi.mock('../../../src/lib/supabase/finance', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/finance')>(
        '../../../src/lib/supabase/finance'
    );
    return {
        ...actual,
        // The statement only needs the child list; the outstanding list is
        // deliberately not used here, so it is stubbed to prove that.
        listOutstanding: vi.fn().mockResolvedValue([]),
        listActiveStudents: (...a: unknown[]) => listActiveStudents(...a),
        listStudentCharges: (...a: unknown[]) => listStudentCharges(...a),
        familyBalance: (...a: unknown[]) => familyBalance(...a),
        setChargeDiscount: (...a: unknown[]) => setChargeDiscount(...a),
        setChargeStatus: (...a: unknown[]) => setChargeStatus(...a),
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
            <MemoryRouter><StudentFeesScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const charge = (over: Record<string, unknown> = {}) => ({
    id: 'c1', student_id: 's1', fee_type_id: 'f1', academic_year_id: 'y1',
    period_month: 3, period_year: 2026, amount: 150, discount_amount: 0,
    discount_reason: null, due_date: null, description: 'Yuran Bulanan',
    status: 'OUTSTANDING' as const, paid_amount: 0, balance: 150, ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listActiveStudents.mockResolvedValue([
        { id: 's1', full_name: 'Ahmad Zaki', admission_no: 'P3S1' },
    ]);
    listStudentCharges.mockResolvedValue([charge()]);
    familyBalance.mockResolvedValue({ charged: 150, paid: 0, outstanding: 150, children: 1 });
});

async function selectStudent() {
    renderScreen();
    // Waiting for the placeholder alone is not enough: the student list arrives
    // asynchronously, and the select has no options until it does. Selecting
    // before then silently leaves the screen with nothing chosen.
    await waitFor(() =>
        expect(
            (screen.getByRole('combobox') as HTMLSelectElement).options.length
        ).toBeGreaterThan(1)
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 's1' } });
    return screen.findByText('Yuran Bulanan');
}

describe('StudentFeesScreen', () => {
    it('asks for a student before showing anything', async () => {
        renderScreen();
        expect(await screen.findByText('Pilih seorang pelajar')).toBeTruthy();
    });

    it('shows the charged, paid and outstanding totals', async () => {
        await selectStudent();
        expect(screen.getByText('Dicaj')).toBeTruthy();
        expect(screen.getByText('Dibayar')).toBeTruthy();
        expect(screen.getByText('Baki')).toBeTruthy();
        expect(screen.getAllByText('RM150.00').length).toBeGreaterThan(0);
    });

    it('THE RULE: a cancelled charge is not counted as owed', async () => {
        listStudentCharges.mockResolvedValue([
            charge({ id: 'c1', amount: 150, balance: 150 }),
            charge({ id: 'c2', amount: 30, balance: 0, status: 'CANCELLED' }),
        ]);
        renderScreen();
        await waitFor(() =>
            expect(
                (screen.getByRole('combobox') as HTMLSelectElement).options.length
            ).toBeGreaterThan(1)
        );
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 's1' } });
        await screen.findByText('Dicaj');
        // Only the live 150 counts, so the outstanding total is 150, not 180.
        const owed = screen.getAllByText('RM150.00');
        expect(owed.length).toBeGreaterThan(0);
        expect(screen.queryByText('RM180.00')).toBeNull();
    });

    it('THE RULE: a discount will not be saved without a reason', async () => {
        await selectStudent();
        fireEvent.change(screen.getByPlaceholderText('Diskaun (RM)'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan diskaun' }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Sila nyatakan sebab diskaun.'));
        expect(setChargeDiscount).not.toHaveBeenCalled();
    });

    it('saves a discount with the reason the clerk typed', async () => {
        setChargeDiscount.mockResolvedValue(undefined);
        await selectStudent();
        fireEvent.change(screen.getByPlaceholderText('Diskaun (RM)'), { target: { value: '10' } });
        fireEvent.change(screen.getByPlaceholderText('Sebab (wajib)'), {
            target: { value: 'Anak yatim' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan diskaun' }));

        await waitFor(() => expect(setChargeDiscount).toHaveBeenCalledWith('c1', 10, 'Anak yatim'));
    });

    it('THE RULE: a charge that has been paid against cannot be waived', async () => {
        listStudentCharges.mockResolvedValue([
            charge({ paid_amount: 50, balance: 100, status: 'PARTIAL' }),
        ]);
        await selectStudent();

        const waive = screen.getByRole('button', { name: 'Kecualikan' }) as HTMLButtonElement;
        // Disabled, because waiving a part-paid charge would need the payment
        // reversing first — otherwise the books would show money going nowhere.
        expect(waive.disabled).toBe(true);
        expect(waive.title).toContain('Batalkan bayaran dahulu');
        expect(setChargeStatus).not.toHaveBeenCalled();
    });

    it('waives an untouched charge when a reason is given', async () => {
        setChargeStatus.mockResolvedValue(undefined);
        await selectStudent();
        fireEvent.change(screen.getByPlaceholderText('Sebab (wajib)'), {
            target: { value: 'Keluarga pindah' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Kecualikan' }));

        await waitFor(() => expect(setChargeStatus).toHaveBeenCalledWith('c1', 'WAIVED', 'Keluarga pindah'));
    });

    it('shows the family total when a family has more than one child', async () => {
        familyBalance.mockResolvedValue({ charged: 360, paid: 300, outstanding: 60, children: 2 });
        await selectStudent();
        expect(screen.getByText(/mempunyai 2 orang anak/)).toBeTruthy();
        expect(screen.getByText(/RM60\.00/)).toBeTruthy();
    });

    it('offers a print button so a parent can be handed a statement', async () => {
        await selectStudent();
        expect(screen.getByRole('button', { name: /Cetak penyata/ })).toBeTruthy();
    });
});
