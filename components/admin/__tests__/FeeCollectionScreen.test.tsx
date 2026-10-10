/**
 * Fee collection — SRIK.
 *
 * These tests are about the rules that stop a school losing money, not about
 * the layout. Every one of them describes a way money could go wrong:
 *
 *   * the save button is dead until the allocations equal the amount received,
 *     because a mismatch would leave ringgit unexplained in the accounts;
 *   * overpaying a single charge is blocked, because it is nearly always a typo;
 *   * a reversal demands a written reason, and is offered instead of a delete;
 *   * a reversed receipt is shown as cancelled, not removed;
 *   * a teacher-facing permission failure is explained in words, not as a code.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import FeeCollectionScreen from '../FeeCollectionScreen';

const { listOutstanding, listStudentCharges, recordPayment, listPayments, reversePayment } =
    vi.hoisted(() => ({
        listOutstanding: vi.fn(),
        listStudentCharges: vi.fn(),
        recordPayment: vi.fn(),
        listPayments: vi.fn(),
        reversePayment: vi.fn(),
    }));

vi.mock('../../../src/lib/supabase/finance', async () => {
    // formatMoney, periodLabel and the label maps are pure and worth testing
    // for real, so the actual module is kept and only the calls are stubbed.
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/finance')>(
        '../../../src/lib/supabase/finance'
    );
    return {
        ...actual,
        listOutstanding: (...a: unknown[]) => listOutstanding(...a),
        listStudentCharges: (...a: unknown[]) => listStudentCharges(...a),
        recordPayment: (...a: unknown[]) => recordPayment(...a),
        listPayments: (...a: unknown[]) => listPayments(...a),
        reversePayment: (...a: unknown[]) => reversePayment(...a),
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
            <MemoryRouter><FeeCollectionScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const STUDENT = {
    student_id: 's1', student_name: 'Ahmad Zaki', admission_no: 'P3S1',
    charged: 180, paid: 0, outstanding: 180, settled: false,
};

/** A charge with a derived balance, exactly as the data layer returns it. */
const charge = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    student_id: 's1',
    fee_type_id: 'f1',
    academic_year_id: 'y1',
    period_month: 3,
    period_year: 2026,
    amount: 150,
    discount_amount: 0,
    discount_reason: null,
    due_date: null,
    description: 'Yuran Bulanan',
    status: 'OUTSTANDING' as const,
    paid_amount: 0,
    balance: 150,
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listOutstanding.mockResolvedValue([STUDENT]);
    listPayments.mockResolvedValue([]);
    listStudentCharges.mockResolvedValue([charge()]);
});

/**
 * The amount-received box.
 *
 * It must be addressed precisely: the per-charge allocation boxes share the same
 * "0.00" placeholder, so a bare placeholder query would match three inputs and
 * the test would be ambiguous about which one it typed into.
 */
function amountBox(): HTMLInputElement {
    return document.querySelector('input[type="number"].text-lg') as HTMLInputElement;
}

async function openPanel() {
    renderScreen();
    fireEvent.click(await screen.findByText('Ahmad Zaki'));
    await screen.findByText('Kutip bayaran');
    // The drawer loads the child's charges before it can show the amount box.
    // Waiting for the charge row keeps every test below from racing that fetch.
    await screen.findByText('Yuran Bulanan');
}

describe('FeeCollectionScreen — outstanding list', () => {
    it('shows what a child owes, in ringgit', async () => {
        renderScreen();
        expect(await screen.findByText('Ahmad Zaki')).toBeTruthy();
        // The total card and the row both show the figure, so it appears twice.
        expect(screen.getAllByText('RM180.00').length).toBeGreaterThan(0);
    });

    it('says so plainly when nobody owes anything', async () => {
        listOutstanding.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('Tiada tunggakan')).toBeTruthy();
    });

    it('explains a permission failure in words rather than a code', async () => {
        listOutstanding.mockRejectedValue(new Error('permission denied for table student_charges'));
        renderScreen();
        expect(await screen.findByText('Anda tiada kebenaran untuk urusan kewangan.')).toBeTruthy();
    });
});

describe('FeeCollectionScreen — the save button and the money', () => {
    it('keeps save disabled until an amount is entered', async () => {
        await openPanel();
        const save = screen.getByRole('button', { name: 'Simpan bayaran' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
    });

    it('pre-fills the charge so a full payment is one click, and enables save', async () => {
        await openPanel();
        fireEvent.change(amountBox(), { target: { value: '150' } });
        await waitFor(() => {
            const save = screen.getByRole('button', { name: 'Simpan bayaran' }) as HTMLButtonElement;
            expect(save.disabled).toBe(false);
        });
        // The allocation box took the whole 150, so nothing is left over.
        expect(screen.getByText(/Jumlah sepadan/)).toBeTruthy();
    });

    it('THE RULE: refuses to save when the allocations do not add up', async () => {
        await openPanel();
        // 200 received against a single 150 charge: 50 would be unallocated.
        fireEvent.change(amountBox(), { target: { value: '200' } });
        await waitFor(() => {
            expect(screen.getByText(/belum diagihkan/)).toBeTruthy();
        });
        const save = screen.getByRole('button', { name: 'Simpan bayaran' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
    });

    it('THE RULE: blocks paying more against one charge than it owes', async () => {
        await openPanel();
        fireEvent.change(amountBox(), { target: { value: '150' } });
        // Now overtype the allocation itself with more than the charge owes.
        const alloc = document.querySelector('li input[type="number"].w-28') as HTMLInputElement;
        fireEvent.change(alloc, { target: { value: '500' } });
        await waitFor(() => {
            expect(screen.getByText('Melebihi baki')).toBeTruthy();
        });
        const save = screen.getByRole('button', { name: 'Simpan bayaran' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
    });

    it('records the payment and reports the receipt number', async () => {
        recordPayment.mockResolvedValue({
            payment_id: 'p1', reference: 'RCPT-0001', amount: 150, duplicate: false,
        });
        await openPanel();
        // Once this payment is recorded the child no longer owes anything, so
        // the list the screen refetches comes back empty.
        listOutstanding.mockResolvedValue([]);
        listPayments.mockResolvedValue([]);
        fireEvent.change(amountBox(), { target: { value: '150' } });
        await waitFor(() => expect(screen.getByText(/Jumlah sepadan/)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Simpan bayaran' }));

        await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
        const arg = recordPayment.mock.calls[0][0] as {
            amount: number; allocations: { charge_id: string; amount: number }[];
        };
        expect(arg.amount).toBe(150);
        expect(arg.allocations).toEqual([{ charge_id: 'c1', amount: 150 }]);
        expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('RCPT-0001'));
    });

    it('says so plainly when the same payment was already recorded', async () => {
        recordPayment.mockResolvedValue({
            payment_id: 'p1', reference: 'RCPT-0001', amount: 150, duplicate: true,
        });
        await openPanel();
        // Once this payment is recorded the child no longer owes anything, so
        // the list the screen refetches comes back empty.
        listOutstanding.mockResolvedValue([]);
        listPayments.mockResolvedValue([]);
        fireEvent.change(amountBox(), { target: { value: '150' } });
        await waitFor(() => expect(screen.getByText(/Jumlah sepadan/)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Simpan bayaran' }));

        await waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('sudah direkodkan'))
        );
    });

    it('explains an overpayment refusal from the server in words', async () => {
        recordPayment.mockRejectedValue(
            new Error('That is more than the 20.00 still owed on this charge')
        );
        await openPanel();
        fireEvent.change(amountBox(), { target: { value: '150' } });
        await waitFor(() => expect(screen.getByText(/Jumlah sepadan/)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Simpan bayaran' }));

        expect(
            await screen.findByText('Jumlah itu melebihi baki yang masih tertunggak. Sila semak jumlahnya.')
        ).toBeTruthy();
    });
});

describe('FeeCollectionScreen — receipts and reversals', () => {
    const receipt = (over: Record<string, unknown> = {}) => ({
        id: 'p1',
        reference: 'RCPT-0001',
        amount: 150,
        paid_at: '2026-03-05T02:00:00.000Z',
        method: 'CASH' as const,
        status: 'CONFIRMED' as const,
        notes: null,
        payer_name: 'Encik Ahmad',
        is_reversal: false,
        reversal_reason: null,
        allocations: [
            { charge_id: 'c1', amount: 150, fee_type_name: 'Yuran Bulanan', student_name: 'Ahmad Zaki', period_month: 3, period_year: 2026 },
        ],
        ...over,
    });

    async function openReceipts() {
        renderScreen();
        fireEvent.click(await screen.findByText('Resit'));
        return screen.findByText('RCPT-0001');
    }

    it('offers a reversal instead of a delete, and will not reverse without a reason', async () => {
        listPayments.mockResolvedValue([receipt()]);
        await openReceipts();

        // There must be no way to delete a payment: the books are append-only.
        expect(screen.queryByText(/Padam/i)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Batalkan bayaran ini/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sahkan pembatalan' }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Sila nyatakan sebab pembatalan.'));
        expect(reversePayment).not.toHaveBeenCalled();
    });

    it('reverses with the reason the clerk typed', async () => {
        listPayments.mockResolvedValue([receipt()]);
        reversePayment.mockResolvedValue(undefined);
        await openReceipts();

        fireEvent.click(screen.getByRole('button', { name: /Batalkan bayaran ini/ }));
        fireEvent.change(await screen.findByPlaceholderText('Sebab pembatalan (wajib)'), {
            target: { value: 'Duit masuk akaun salah' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Sahkan pembatalan' }));

        await waitFor(() =>
            expect(reversePayment).toHaveBeenCalledWith('p1', 'Duit masuk akaun salah')
        );
    });

    it('shows a reversed receipt as cancelled, still on file', async () => {
        listPayments.mockResolvedValue([
            receipt({ status: 'REVERSED', reversal_reason: 'Duit masuk akaun salah' }),
        ]);
        await openReceipts();

        // The receipt is still listed, and says why it was cancelled.
        expect(screen.getByText('Telah dibatalkan')).toBeTruthy();
        expect(screen.getByText(/Duit masuk akaun salah/)).toBeTruthy();
        // And it cannot be reversed a second time.
        expect(screen.queryByRole('button', { name: /Batalkan bayaran ini/ })).toBeNull();
    });

    it('says a reversal cannot be repeated when the server refuses', async () => {
        listPayments.mockResolvedValue([receipt()]);
        reversePayment.mockRejectedValue(new Error('That payment has already been reversed'));
        await openReceipts();

        fireEvent.click(screen.getByRole('button', { name: /Batalkan bayaran ini/ }));
        fireEvent.change(await screen.findByPlaceholderText('Sebab pembatalan (wajib)'), {
            target: { value: 'sekali lagi' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Sahkan pembatalan' }));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('Bayaran ini sudah dibatalkan sebelum ini.')
        );
    });

    it('shows what each receipt actually settled', async () => {
        listPayments.mockResolvedValue([receipt()]);
        await openReceipts();
        expect(screen.getByText(/Yuran Bulanan/)).toBeTruthy();
    });
});
