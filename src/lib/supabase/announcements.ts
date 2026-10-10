/**
 * Announcements — the office writes, families read.
 *
 * Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
 *
 * A notice has three states, and the difference between them matters to a
 * parent. A draft is a notice the office is still writing; publishing it is the
 * act that makes it visible, and it is recorded. Withdrawing it takes it away
 * again without deleting the fact that it was sent — a school is sometimes
 * asked "did you tell the parents?", and the answer should be knowable.
 *
 * The audience decides who sees it. STAFF notices never reach a family, which is
 * why the parent-facing policy refuses that audience outright rather than
 * relying on the office to pick correctly.
 *
 * Nothing here is a security boundary. Who may write, who may publish, and who
 * may read a given notice are all decided by the database; this file only
 * presents the result. In particular, a parent reading a notice gains nothing
 * from a permission — the row-level policy admits them because they are the
 * audience.
 */

import { requireSupabase } from './client';

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
    ALL: 'Semua',
    STAFF: 'Guru dan staf',
    GUARDIANS: 'Ibu bapa',
    STUDENTS: 'Pelajar',
};

export const STATUS_LABELS: Record<AnnouncementStatus, string> = {
    DRAFT: 'Draf — belum diterbitkan',
    PUBLISHED: 'Diterbitkan',
    WITHDRAWN: 'Ditarik balik',
};

export type AnnouncementAudience = 'ALL' | 'STAFF' | 'GUARDIANS' | 'STUDENTS';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';

export interface Announcement {
    id: string;
    title: string;
    body: string;
    audience: AnnouncementAudience;
    status: AnnouncementStatus;
    publish_at: string | null;
    expires_at: string | null;
    author_id: string | null;
    created_at: string;
    updated_at: string;
}

/** Turns a database error into a sentence an office clerk can act on. */
export function friendlyAnnouncementError(error: unknown): string {
    const raw = (error as { message?: string })?.message ?? '';

    if (/permission/i.test(raw)) {
        return 'Anda tiada kebenaran untuk menguruskan pengumuman.';
    }
    if (/does not exist/i.test(raw)) {
        return 'Pengumuman itu tidak dijumpai. Ia mungkin telah dipadam.';
    }
    if (/announcements_dates_sane|expires_at/i.test(raw)) {
        return 'Tarikh tamat mesti selepas tarikh terbit.';
    }
    if (/title_present/i.test(raw)) {
        return 'Sila masukkan tajuk pengumuman.';
    }
    if (/body_present/i.test(raw)) {
        return 'Sila masukkan kandungan pengumuman.';
    }
    if (/failed to fetch|network/i.test(raw)) {
        return 'Tiada sambungan ke pelayan. Sila cuba lagi.';
    }
    return 'Pengumuman tidak dapat disimpan. Sila cuba lagi.';
}

/** Everything, newest first — the office's list, drafts included. */
export async function listAnnouncements(): Promise<Announcement[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Announcement[];
}

/**
 * What a family sees.
 *
 * Asked of the same table as the office list, but the database returns only
 * published, in-date, family-addressed notices. There is no client-side filter
 * here, on purpose: a filter in the browser is a filter a browser can remove.
 */
export async function listPublishedAnnouncements(): Promise<Announcement[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('status', 'PUBLISHED')
        .neq('audience', 'STAFF')
        .order('publish_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Announcement[];
}

export async function saveAnnouncement(input: {
    id?: string;
    title: string;
    body: string;
    audience: AnnouncementAudience;
    expiresAt?: string | null;
}): Promise<Announcement> {
    const supabase = requireSupabase();
    const { data: auth } = await supabase.auth.getUser();

    const payload = {
        title: input.title.trim(),
        body: input.body.trim(),
        audience: input.audience,
        expires_at: input.expiresAt || null,
    };

    if (input.id) {
        const { data, error } = await supabase
            .from('announcements')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', input.id)
            .select('*')
            .single();
        if (error) throw error;
        return data as Announcement;
    }

    const { data, error } = await supabase
        .from('announcements')
        .insert({ ...payload, status: 'DRAFT', author_id: auth?.user?.id ?? null })
        .select('*')
        .single();
    if (error) throw error;
    return data as Announcement;
}

/**
 * Publishes or withdraws a notice.
 *
 * A function rather than a plain update, because publishing is the moment a
 * notice becomes visible to families. It deserves to be its own deliberate act
 * rather than a side effect of saving a form.
 */
export async function setAnnouncementStatus(
    id: string,
    status: AnnouncementStatus
): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc('set_announcement_status', {
        p_announcement_id: id,
        p_status: status,
    });
    if (error) throw error;
}

export async function deleteAnnouncement(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) throw error;
}
