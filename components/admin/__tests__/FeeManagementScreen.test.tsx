/**
 * Fee setup — SRIK.
 *
 * The rules tested here are the ones that decide whether a family gets billed
 * correctly:
 *
 *   * a fee with no price is not billed, rather than billed at zero;
 *   * generating a month that already exists adds nothing;
 *   * the screen says what it will generate before it does it;
 *   * a name and code are required, because a nameless fee cannot be explained
 *     to a parent.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import FeeManagementScreen from '../FeeManagementScreen';

const { listFeeTypes, saveFeeType, generateMonthlyCharges, getCurrentAcademicYear } = vi.hoisted(
    () => ({
        listFeeTypes: vi.fn(),
        saveFeeType: vi.fn(),
        generateMonthlyCharges: vi.fn(),
        getCurrentAcademicYear: vi.fn(),
    })
);

vi.mock('../../../src/lib/supabase/finance', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/finance')>(
        '../../../src/lib/supabase/finance'
    );
    return {
        ...actual,
        listFeeTypes: (...a: unknown[]) => listFeeTypes(...a),
        saveFeeType: (...a: unknown[]) => saveFeeType(...a),
        generateMonthlyCharges: (...a: unknown[]) => generateMonthlyCharges(...a),
        getCurrentAcademicYear: (...a: unknown[]) => getCurrentAcademicYear(...a),
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
            <MemoryRouter><FeeManagementScreen /></MemoryRouter>
        </QueryClientProvider>
    );

/** The school's real fee list. */
const FEES = [
    { id: 'f1', code: 'BULANAN', name: 'Yuran Bulanan', default_amount: 150, frequency: 'MONTHLY' as const, description: null, sort_order: 1, status: 'ACTIVE' as const },
    { id: 'f2', code: 'PENDAFTARAN', name: 'Yuran Pendaftaran', default_amount: 200, frequency: 'ONE_TIME' as const, description: null, sort_order: 2, status: 'ACTIVE' as const },
    { id: 'f3', code: 'PIBG', name: 'Yuran PIBG', default_amount: 30, frequency: 'MONTHLY' as const, description: null, sort_order: 3, status: 'ACTIVE' as const },
];

beforeEach(() => {
    vi.clearAllMocks();
    listFeeTypes.mockResolvedValue(FEES);
    getCurrentAcademicYear.mockResolvedValue({ id: 'y1', name: '2026' });
});

describe('FeeManagementScreen', () => {
    it('lists the school fees with their amounts', async () => {
        renderScreen();
        expect(await screen.findByText('Yuran Bulanan')).toBeTruthy();
        expect(screen.getByText('RM150.00')).toBeTruthy();
        expect(screen.getByText('RM200.00')).toBeTruthy();
        expect(screen.getByText('RM30.00')).toBeTruthy();
    });

    it('says which fees will be generated before generating them', async () => {
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        // Only the two monthly fees, and with their amounts, so the clerk can
        // see what pressing the button will cost every family.
        expect(screen.getByText(/Akan dijana: Yuran Bulanan \(RM150\.00\), Yuran PIBG \(RM30\.00\)/)).toBeTruthy();
    });

    it('generates a month and reports how many charges it created', async () => {
        generateMonthlyCharges.mockResolvedValue({ charges_created: 6 });
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        fireEvent.click(screen.getByRole('button', { name: /Jana untuk/ }));

        await waitFor(() => expect(generateMonthlyCharges).toHaveBeenCalledTimes(1));
        // Only the monthly fees are passed, so a one-off fee is never billed monthly.
        const args = generateMonthlyCharges.mock.calls[0];
        expect(args[0]).toBe('y1');
        expect(args[3]).toEqual(['f1', 'f3']);
        expect(await screen.findByText('6 caj baharu dijana.')).toBeTruthy();
    });

    it('THE RULE: says a re-run added nothing rather than claiming a second bill', async () => {
        generateMonthlyCharges.mockResolvedValue({ charges_created: 0 });
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        fireEvent.click(screen.getByRole('button', { name: /Jana untuk/ }));

        expect(
            await screen.findByText('Tiada caj baharu — bulan itu sudah dijana sebelum ini.')
        ).toBeTruthy();
    });

    it('refuses to generate with no academic year set', async () => {
        getCurrentAcademicYear.mockResolvedValue(null);
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        fireEvent.click(screen.getByRole('button', { name: /Jana untuk/ }));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('Tiada tahun akademik semasa ditetapkan.')
        );
        expect(generateMonthlyCharges).not.toHaveBeenCalled();
    });

    it('marks a fee with no price, and will not invent one', async () => {
        listFeeTypes.mockResolvedValue([
            { ...FEES[0], id: 'f9', name: 'Yuran Belum Diputuskan', default_amount: null },
        ]);
        renderScreen();
        expect(await screen.findByText('Yuran Belum Diputuskan')).toBeTruthy();
        expect(screen.getByText(/Jumlah belum ditetapkan/)).toBeTruthy();
    });

    it('will not save a fee without a name or code', async () => {
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        fireEvent.click(screen.getByRole('button', { name: /Tambah jenis yuran/ }));

        const save = await screen.findByRole('button', { name: 'Simpan' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);

        fireEvent.change(screen.getByPlaceholderText('Contoh: Yuran Bulanan'), {
            target: { value: 'Yuran Bas' },
        });
        fireEvent.change(screen.getByPlaceholderText('Contoh: BULANAN'), {
            target: { value: 'BAS' },
        });
        await waitFor(() => expect(save.disabled).toBe(false));
    });

    it('saves a blank price as no price, not as zero', async () => {
        saveFeeType.mockResolvedValue({ ...FEES[0], id: 'f10' });
        renderScreen();
        await screen.findByText('Yuran Bulanan');
        fireEvent.click(screen.getByRole('button', { name: /Tambah jenis yuran/ }));

        fireEvent.change(screen.getByPlaceholderText('Contoh: Yuran Bulanan'), {
            target: { value: 'Yuran Bas' },
        });
        fireEvent.change(screen.getByPlaceholderText('Contoh: BULANAN'), {
            target: { value: 'BAS' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(saveFeeType).toHaveBeenCalledTimes(1));
        // A zero here would bill every child nothing, which is not the same as
        // the school not having decided the price yet.
        expect(saveFeeType.mock.calls[0][0].default_amount).toBeNull();
    });
});
