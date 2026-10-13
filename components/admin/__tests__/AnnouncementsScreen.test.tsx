/**
 * Announcements — the office's screen.
 *
 * The rule that matters: a notice must not reach a parent by accident. Saving
 * keeps a draft; publishing is the separate, deliberate act that makes it
 * visible. These tests hold that line, and check that the screen never offers to
 * delete something that was already sent.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import AnnouncementsScreen from '../AnnouncementsScreen';

const { listAnnouncements, saveAnnouncement, setAnnouncementStatus, deleteAnnouncement } =
    vi.hoisted(() => ({
        listAnnouncements: vi.fn(),
        saveAnnouncement: vi.fn(),
        setAnnouncementStatus: vi.fn(),
        deleteAnnouncement: vi.fn(),
    }));

vi.mock('../../../src/lib/supabase/announcements', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/announcements')>(
        '../../../src/lib/supabase/announcements'
    );
    return {
        ...actual,
        listAnnouncements: (...a: unknown[]) => listAnnouncements(...a),
        saveAnnouncement: (...a: unknown[]) => saveAnnouncement(...a),
        setAnnouncementStatus: (...a: unknown[]) => setAnnouncementStatus(...a),
        deleteAnnouncement: (...a: unknown[]) => deleteAnnouncement(...a),
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
            <MemoryRouter><AnnouncementsScreen /></MemoryRouter>
        </QueryClientProvider>
    );

const notice = (over: Record<string, unknown> = {}) => ({
    id: 'a1', title: 'Cuti Sekolah', body: 'Sekolah cuti pada 20 haribulan.',
    audience: 'GUARDIANS' as const, status: 'DRAFT' as const,
    publish_at: null, expires_at: null, author_id: 'admin-1',
    created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z', ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    listAnnouncements.mockResolvedValue([notice()]);
});

describe('AnnouncementsScreen — the list', () => {
    it('shows a notice with its audience', async () => {
        renderScreen();
        expect(await screen.findByText('Cuti Sekolah')).toBeTruthy();
        expect(screen.getByText(/Parents/)).toBeTruthy();
    });

    it('marks a draft as not yet published', async () => {
        renderScreen();
        expect(await screen.findByText('Draft — not yet published')).toBeTruthy();
    });

    it('says plainly when there is nothing written yet', async () => {
        listAnnouncements.mockResolvedValue([]);
        renderScreen();
        expect(await screen.findByText('No announcements yet')).toBeTruthy();
    });
});

describe('AnnouncementsScreen — publishing', () => {
    it('THE RULE: writing a notice does not send it', async () => {
        renderScreen();
        await screen.findByText('Cuti Sekolah');
        // The draft sits there with a publish button and no send on save.
        expect(screen.getByRole('button', { name: /Publish/ })).toBeTruthy();
        expect(setAnnouncementStatus).not.toHaveBeenCalled();
    });

    it('publishes only when the clerk asks', async () => {
        setAnnouncementStatus.mockResolvedValue(undefined);
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Publish/ }));

        await waitFor(() => expect(setAnnouncementStatus).toHaveBeenCalledTimes(1));
        expect(setAnnouncementStatus).toHaveBeenCalledWith('a1', 'PUBLISHED');
    });

    it('says what publishing will do before it happens', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Write announcement/ }));
        expect(screen.getByText(/Saving does not publish/)).toBeTruthy();
    });
});

describe('AnnouncementsScreen — withdrawing', () => {
    it('THE RULE: a sent notice is withdrawn, never deleted', async () => {
        listAnnouncements.mockResolvedValue([
            notice({ status: 'PUBLISHED', publish_at: '2026-03-02T08:00:00Z' }),
        ]);
        renderScreen();
        await screen.findByText('Cuti Sekolah');

        expect(screen.getByRole('button', { name: /Tarik balik/ })).toBeTruthy();
        // No delete button on a published notice: the record that families were
        // told must survive.
        expect(screen.queryByRole('button', { name: /Delete draft/ })).toBeNull();
        expect(screen.getByText(/cannot be deleted, only withdrawn/)).toBeTruthy();
    });

    it('withdraws when the clerk asks', async () => {
        listAnnouncements.mockResolvedValue([
            notice({ status: 'PUBLISHED', publish_at: '2026-03-02T08:00:00Z' }),
        ]);
        setAnnouncementStatus.mockResolvedValue(undefined);
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Tarik balik/ }));

        await waitFor(() => expect(setAnnouncementStatus).toHaveBeenCalledWith('a1', 'WITHDRAWN'));
    });

    it('offers deletion only for a draft that was never published', async () => {
        renderScreen();
        await screen.findByText('Cuti Sekolah');
        expect(screen.getByRole('button', { name: /Delete draft/ })).toBeTruthy();
    });
});

describe('AnnouncementsScreen — writing', () => {
    it('will not save a notice with no title or no body', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Write announcement/ }));
        fireEvent.change(screen.getByPlaceholderText(/Hari Raya holiday/), {
            target: { value: 'Ada tajuk' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }));

        expect(saveAnnouncement).not.toHaveBeenCalled();
    });

    it('saves a new notice as a draft', async () => {
        saveAnnouncement.mockResolvedValue(notice());
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Write announcement/ }));
        fireEvent.change(screen.getByPlaceholderText(/Hari Raya holiday/), {
            target: { value: 'PTA Meetings' },
        });
        fireEvent.change(screen.getByPlaceholderText(/Write a message to parents/), {
            target: { value: 'Mesyuarat pada 10 haribulan.' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }));

        await waitFor(() => expect(saveAnnouncement).toHaveBeenCalledTimes(1));
        const arg = saveAnnouncement.mock.calls[0][0] as { title: string; id?: string };
        expect(arg.title).toBe('PTA Meetings');
        expect(arg.id).toBeUndefined();
    });

    it('warns that a staff notice will not reach parents', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: /Write announcement/ }));
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'STAFF' } });
        expect(screen.getByText(/will not be seen by parents/)).toBeTruthy();
    });

    it('explains a permission failure in words', async () => {
        listAnnouncements.mockRejectedValue(new Error('permission denied'));
        renderScreen();
        expect(await screen.findByText('Anda tiada kebenaran untuk menguruskan pengumuman.')).toBeTruthy();
    });
});
