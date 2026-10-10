/**
 * Pengumuman — what a parent sees.
 *
 * A parent has no announcements permission at all: the database admits them to a
 * notice because they are its audience. The test that matters is the one that
 * would catch this screen ever asking for more than it is given — it calls a
 * function that takes no arguments, so there is nothing for a parent to widen.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MyAnnouncementsScreen from '../MyAnnouncementsScreen';

const { listPublishedAnnouncements } = vi.hoisted(() => ({ listPublishedAnnouncements: vi.fn() }));

vi.mock('../../../src/lib/supabase/announcements', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/announcements')>(
        '../../../src/lib/supabase/announcements'
    );
    return {
        ...actual,
        listPublishedAnnouncements: (...a: unknown[]) => listPublishedAnnouncements(...a),
    };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'parent-1' }, role: 'GUARDIAN', loading: false }),
}));

const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><MyAnnouncementsScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const notice = (over: Record<string, unknown> = {}) => ({
    id: 'a1', title: 'Cuti Sekolah', body: 'Sekolah cuti pada 20 haribulan.',
    audience: 'GUARDIANS' as const, status: 'PUBLISHED' as const,
    publish_at: '2026-03-02T08:00:00Z', expires_at: null, author_id: 'admin-1',
    created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z', ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listPublishedAnnouncements.mockResolvedValue([notice()]);
});

describe('MyAnnouncementsScreen', () => {
    it('shows a notice from the school', async () => {
        renderScreen();
        expect(await screen.findByText('Cuti Sekolah')).toBeTruthy();
        expect(screen.getByText('Sekolah cuti pada 20 haribulan.')).toBeTruthy();
    });

    it('THE RULE: asks a function that takes no arguments, so nothing can be widened', async () => {
        renderScreen();
        await screen.findByText('Cuti Sekolah');
        // Access comes from being the audience, decided in the database. If this
        // screen ever passed a filter, that filter is what a parent could change.
        expect(listPublishedAnnouncements).toHaveBeenCalledWith();
    });

    it('says plainly when the school has posted nothing', async () => {
        listPublishedAnnouncements.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('Tiada pengumuman')).toBeTruthy();
        expect(screen.getByText(/Belum ada notis daripada pihak sekolah/)).toBeTruthy();
    });

    it('offers no way to write or publish anything', async () => {
        renderScreen();
        await screen.findByText('Cuti Sekolah');
        // A parent reads notices and changes nothing.
        expect(screen.queryByRole('button', { name: /Terbitkan/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Tulis/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Padam/ })).toBeNull();
    });

    it('explains a failure rather than showing an empty screen', async () => {
        listPublishedAnnouncements.mockRejectedValue(new Error('failed to fetch'));
        renderScreen();
        expect(await screen.findByText('Tiada sambungan ke pelayan. Sila cuba lagi.')).toBeTruthy();
    });
});
