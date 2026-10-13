/**
 * Rekod Audit — the office's screen.
 *
 * The rules tested here are about honesty rather than features:
 *
 *   * the name shown is the one the record carries, not one the browser
 *     supplies, so a screen cannot display a false attribution;
 *   * a change shows what it was and what it became, not two walls of JSON;
 *   * the screen offers no way to edit or erase an entry, because the log is
 *     meant to be evidence;
 *   * a permission failure is explained, not shown as a blank list.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import AuditTrailScreen from '../AuditTrailScreen';

const { listAuditLog } = vi.hoisted(() => ({ listAuditLog: vi.fn() }));

vi.mock('../../../src/lib/supabase/auditTrail', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/auditTrail')>(
        '../../../src/lib/supabase/auditTrail'
    );
    return { ...actual, listAuditLog: (...a: unknown[]) => listAuditLog(...a) };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1' }, role: 'ADMIN', loading: false }),
}));

const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><AuditTrailScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const entry = (over: Record<string, unknown> = {}) => ({
    id: 1,
    created_at: '2026-03-02T10:15:00Z',
    actor_email: 'admin001@srialkhairiah.my',
    action: 'UPDATE' as const,
    entity_type: 'assessment_results',
    entity_id: '00000000-0000-4000-f000-000000000800',
    before_data: { id: 'x', score: 70, updated_at: '2026-03-01T00:00:00Z' },
    after_data: { id: 'x', score: 85, updated_at: '2026-03-02T10:15:00Z' },
    ...over,
});

/** Opens the first entry. The filter dropdown also offers a "Score" option, so
 *  the row is found by its button rather than by that text. */
async function openEntry() {
    const buttons = await screen.findAllByRole('button');
    // The first button is the "Tulis" action; the row buttons follow it.
    const row = buttons.find(b => b.textContent?.includes('Score'));
    if (!row) throw new Error('no audit row found');
    fireEvent.click(row);
}

beforeEach(() => {
    vi.clearAllMocks();
    listAuditLog.mockResolvedValue([entry()]);
});

describe('AuditTrailScreen', () => {
    it('THE RULE: shows the name the record carries, not one the browser supplies', async () => {
        renderScreen();
        // The screen is signed in as admin-1, but the entry names another
        // account. The record wins: the browser cannot relabel a change.
        expect(await screen.findByText(/admin001@srialkhairiah\.my/)).toBeTruthy();
    });

    it('names the table in words a clerk understands', async () => {
        renderScreen();
        expect(await screen.findByText(/Score/)).toBeTruthy();
    });

    it('shows what a value was and what it became', async () => {
        renderScreen();
        await openEntry();
        expect(await screen.findByText('70')).toBeTruthy();
        expect(screen.getByText('85')).toBeTruthy();
    });

    it('does not show a timestamp as though it were a real change', async () => {
        renderScreen();
        await openEntry();
        await screen.findByText('70');
        // updated_at moves on every save; showing it would bury the real change.
        expect(screen.queryByText('updated_at')).toBeNull();
    });

    it('says plainly when nothing has been recorded', async () => {
        listAuditLog.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('No records')).toBeTruthy();
        expect(screen.getByText('No changes recorded yet.')).toBeTruthy();
    });

    it('filters by a search term', async () => {
        listAuditLog.mockResolvedValue([
            entry(),
            entry({ id: 2, actor_email: 'guru@srik.test', entity_type: 'payments', before_data: {}, after_data: {} }),
        ]);
        renderScreen();
        await screen.findByText(/admin001@srialkhairiah\.my/);

        fireEvent.change(screen.getByPlaceholderText(/Search username/), {
            target: { value: 'guru@srik.test' },
        });
        // The teacher's entry stays; the admin's is filtered out.
        expect(screen.queryByText(/admin001@srialkhairiah\.my/)).toBeNull();
    });

    it('THE RULE: offers no way to edit or erase an entry', async () => {
        renderScreen();
        await openEntry();
        await screen.findByText('70');

        // The log is evidence. A screen that could tidy it up would make it
        // worthless, so no such control exists — the absence is the control.
        expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    });

    it('says that nobody, not even an administrator, can change the record', async () => {
        renderScreen();
        expect(
            await screen.findByText(/Tiada sesiapa — termasuk\s+pentadbir — boleh mengubah atau memadam/)
        ).toBeTruthy();
    });

    it('explains a permission failure in words', async () => {
        listAuditLog.mockRejectedValue(new Error('permission denied for table audit_log'));
        renderScreen();
        expect(await screen.findByText('Anda tiada kebenaran untuk melihat rekod audit.')).toBeTruthy();
    });
});
