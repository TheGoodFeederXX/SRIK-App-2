/**
 * My children's fees — SRIK.
 *
 * These tests are about what a parent must and must not be shown:
 *
 *   * a parent sees only their own children, because the query takes no child
 *     and the database decides — there is no parameter to tamper with;
 *   * a settled charge reads as settled, not as RM0.00, which invites the
 *     question "was that free?";
 *   * a waived or cancelled charge is not counted as owed;
 *   * a parent with no child linked is told to contact the office rather than
 *     shown an empty, unexplained screen;
 *   * a family total adds up across children.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MyChildrenFeesScreen from '../MyChildrenFeesScreen';

const { listMyChildrenFees } = vi.hoisted(() => ({ listMyChildrenFees: vi.fn() }));

vi.mock('../../../src/lib/supabase/parentFees', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/parentFees')>(
        '../../../src/lib/supabase/parentFees'
    );
    return {
        ...actual,
        listMyChildrenFees: (...a: unknown[]) => listMyChildrenFees(...a),
    };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'parent-1' }, role: 'GUARDIAN', loading: false }),
}));

const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><MyChildrenFeesScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const charge = (over: Record<string, unknown> = {}) => ({
    id: 'c1', student_id: 's1', fee_type_id: 'f1', academic_year_id: 'y1',
    period_month: 3, period_year: 2026, amount: 150, discount_amount: 0,
    discount_reason: null, due_date: null, description: 'Monthly Fees',
    status: 'OUTSTANDING' as const, paid_amount: 0, balance: 150, ...over,
});

const child = (over: Record<string, unknown> = {}) => ({
    student_id: 's1', student_name: 'Ahmad Zaki', admission_no: 'P3S1',
    charged: 150, paid: 0, outstanding: 150, charges: [charge()], ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listMyChildrenFees.mockResolvedValue([child()]);
});

describe('MyChildrenFeesScreen', () => {
    it('shows the child and what they owe', async () => {
        renderScreen();
        expect(await screen.findByText('Ahmad Zaki')).toBeTruthy();
        // The family card and the charge line both carry the figure.
        expect(screen.getAllByText('RM150.00').length).toBeGreaterThan(0);
    });

    it('THE RULE: takes no child argument, so a parent cannot name another family', async () => {
        renderScreen();
        await screen.findByText('Ahmad Zaki');
        // The database decides which children belong to the caller. If this
        // screen ever passed a child id, this assertion is what would catch it.
        expect(listMyChildrenFees).toHaveBeenCalledWith();
    });

    it('reports a settled charge as settled, never as a zero amount', async () => {
        listMyChildrenFees.mockResolvedValue([
            child({
                paid: 150, outstanding: 0,
                charges: [charge({ status: 'PAID', paid_amount: 150, balance: 0 })],
            }),
        ]);
        renderScreen();
        expect(await screen.findByText('Resolved')).toBeTruthy();
        // And the family total says so in words.
        expect(screen.getByText(/All fees are settled/)).toBeTruthy();
    });

    it('THE RULE: a waived charge is not counted as owed', async () => {
        listMyChildrenFees.mockResolvedValue([
            child({
                charged: 150, paid: 0, outstanding: 0,
                charges: [charge({ status: 'WAIVED', balance: 0 })],
            }),
        ]);
        renderScreen();
        // The waived charge reads as waived, and nothing is outstanding.
        expect(await screen.findByText('Waived')).toBeTruthy();
        expect(screen.getByText(/All fees are settled/)).toBeTruthy();
    });

    it('marks a part payment without calling it settled', async () => {
        listMyChildrenFees.mockResolvedValue([
            child({
                charged: 150, paid: 50, outstanding: 100,
                charges: [charge({ status: 'PARTIAL', paid_amount: 50, balance: 100 })],
            }),
        ]);
        renderScreen();
        await screen.findByText('Ahmad Zaki');
        expect(screen.getAllByText('RM100.00').length).toBeGreaterThan(0);
        // A part payment is not a settled one, and must not be marked so.
        expect(screen.queryByText('Resolved')).toBeNull();
    });

    it('tells a parent with no child linked to contact the office', async () => {
        listMyChildrenFees.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('No child record')).toBeTruthy();
        expect(screen.getByText(/contact the school office/)).toBeTruthy();
    });

    it('adds up a family total across more than one child', async () => {
        listMyChildrenFees.mockResolvedValue([
            child({ student_id: 's1', student_name: 'Ahmad Zaki', outstanding: 150 }),
            child({ student_id: 's2', student_name: 'Nur Aisyah', outstanding: 30 }),
        ]);
        renderScreen();
        expect(await screen.findByText('Ahmad Zaki')).toBeTruthy();
        // 150 + 30, in the family card.
        expect(screen.getAllByText('RM180.00').length).toBeGreaterThan(0);
    });

    it('offers a print button so a parent can keep a statement', async () => {
        renderScreen();
        await screen.findByText('Ahmad Zaki');
        expect(screen.getByRole('button', { name: /Cetak penyata/ })).toBeTruthy();
    });

    it('says so plainly when the statement cannot be opened', async () => {
        listMyChildrenFees.mockRejectedValue(new Error('network down'));
        renderScreen();
        expect(await screen.findByText(/fee statement cannot be opened/)).toBeTruthy();
    });
});
