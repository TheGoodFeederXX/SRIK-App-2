/**
 * Announcements — the office's screen.
 *
 * Where a notice is written, published and withdrawn.
 *
 * Two decisions shape this screen.
 *
 * WHY SAVING AND PUBLISHING ARE SEPARATE BUTTONS. A save keeps a notice as a
 * draft; publishing is what puts it in front of families, and the database
 * records who did it. If saving published automatically, a half-typed notice
 * would go out the moment someone paused, and there would be no moment to point
 * at when asking who sent it.
 *
 * WHY WITHDRAWING IS NOT DELETING. Withdrawing takes a notice away from families
 * and leaves the record that it was sent. A school is sometimes asked "did you
 * tell the parents?", and a notice that was deleted cannot answer. Deleting is
 * offered only for a draft that was never published, where there is nothing to
 * remember.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MegaphoneIcon, PlusIcon, TrashIcon, EyeIcon, EyeOffIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listAnnouncements, saveAnnouncement, setAnnouncementStatus, deleteAnnouncement,
    friendlyAnnouncementError, AUDIENCE_LABELS, STATUS_LABELS,
    type Announcement, type AnnouncementAudience,
} from '../../src/lib/supabase/announcements';

export default function AnnouncementsScreen() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<Announcement | null>(null);
    const [composing, setComposing] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const listQuery = useQuery({
        queryKey: ['announcements', 'all'],
        queryFn: () => listAnnouncements(),
        enabled: !!user,
    });

    const items = useMemo(() => listQuery.data ?? [], [listQuery.data]);

    function refresh() {
        queryClient.invalidateQueries({ queryKey: ['announcements'] });
    }

    async function handleStatus(item: Announcement, status: 'PUBLISHED' | 'WITHDRAWN') {
        setBusyId(item.id);
        try {
            await setAnnouncementStatus(item.id, status);
            toast.success(
                status === 'PUBLISHED'
                    ? `“${item.title}” telah diterbitkan.`
                    : `“${item.title}” telah ditarik balik.`
            );
            refresh();
        } catch (err) {
            toast.error(friendlyAnnouncementError(err));
        } finally {
            setBusyId(null);
        }
    }

    async function handleDelete(item: Announcement) {
        setBusyId(item.id);
        try {
            await deleteAnnouncement(item.id);
            toast.success('Draf dipadam.');
            refresh();
        } catch (err) {
            toast.error(friendlyAnnouncementError(err));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div className="p-4 sm:p-6 max-w-3xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h1 className="text-2xl font-bold text-slate-800">Pengumuman</h1>
                <button
                    type="button"
                    onClick={() => setComposing(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white
                               text-sm font-bold hover:bg-indigo-700"
                >
                    <PlusIcon className="w-4 h-4" />
                    Tulis pengumuman
                </button>
            </div>
            <p className="text-sm text-slate-500 mb-5">
                Tulis notis untuk ibu bapa, guru atau pelajar. Notis hanya dilihat selepas diterbitkan.
            </p>

            {listQuery.isLoading ? (
                <CenteredLoader />
            ) : listQuery.isError ? (
                <Notice tone="error">{friendlyAnnouncementError(listQuery.error)}</Notice>
            ) : !items.length ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <div className="flex justify-center mb-3">
                        <MegaphoneIcon className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="font-semibold text-slate-700">Belum ada pengumuman</p>
                    <p className="text-sm text-slate-500 mt-1">
                        Tulis notis pertama untuk ibu bapa atau guru.
                    </p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {items.map(item => (
                        <li
                            key={item.id}
                            className="bg-white rounded-2xl border border-slate-200 p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-800">{item.title}</p>
                                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                                        {item.body}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-2">
                                        {AUDIENCE_LABELS[item.audience]}
                                        {item.status === 'PUBLISHED' && item.publish_at
                                            ? ` · Diterbitkan ${formatDate(item.publish_at)}`
                                            : ''}
                                    </p>
                                </div>
                                <StatusBadge status={item.status} />
                            </div>

                            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                                {item.status !== 'PUBLISHED' ? (
                                    <button
                                        type="button"
                                        onClick={() => handleStatus(item, 'PUBLISHED')}
                                        disabled={busyId === item.id}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                                   bg-emerald-600 text-white text-xs font-bold
                                                   hover:bg-emerald-700 disabled:bg-slate-300"
                                    >
                                        <EyeIcon className="w-3.5 h-3.5" />
                                        Terbitkan
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleStatus(item, 'WITHDRAWN')}
                                        disabled={busyId === item.id}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                                   bg-amber-100 text-amber-800 text-xs font-bold
                                                   hover:bg-amber-200 disabled:bg-slate-100"
                                    >
                                        <EyeOffIcon className="w-3.5 h-3.5" />
                                        Tarik balik
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setEditing(item)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs
                                               font-bold hover:bg-slate-200"
                                >
                                    Sunting
                                </button>
                                {item.status === 'DRAFT' && (
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(item)}
                                        disabled={busyId === item.id}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                                   text-rose-600 text-xs font-bold hover:bg-rose-50
                                                   disabled:text-slate-300"
                                    >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                        Padam draf
                                    </button>
                                )}
                            </div>

                            {item.status === 'PUBLISHED' && (
                                <p className="text-xs text-slate-400 mt-2">
                                    Notis yang telah diterbitkan tidak boleh dipadam, hanya ditarik
                                    balik — supaya rekod kekal.
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {(composing || editing) && (
                <Composer
                    announcement={editing}
                    onClose={() => {
                        setComposing(false);
                        setEditing(null);
                    }}
                    onSaved={() => {
                        refresh();
                        setComposing(false);
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

function Composer({
    announcement, onClose, onSaved,
}: {
    announcement: Announcement | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [title, setTitle] = useState(announcement?.title ?? '');
    const [body, setBody] = useState(announcement?.body ?? '');
    const [audience, setAudience] = useState<AnnouncementAudience>(
        announcement?.audience ?? 'GUARDIANS'
    );
    const [expiresAt, setExpiresAt] = useState(
        announcement?.expires_at ? announcement.expires_at.slice(0, 10) : ''
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSave = title.trim().length > 0 && body.trim().length > 0 && !busy;

    async function handleSave() {
        if (!canSave) return;
        setBusy(true);
        setError(null);
        try {
            await saveAnnouncement({
                id: announcement?.id,
                title,
                body,
                audience,
                expiresAt: expiresAt || null,
            });
            toast.success(announcement ? 'Pengumuman disimpan.' : 'Draf disimpan.');
            onSaved();
        } catch (err) {
            setError(friendlyAnnouncementError(err));
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl p-5
                            max-h-[90vh] overflow-y-auto">
                <h2 className="font-bold text-slate-800 mb-4">
                    {announcement ? 'Sunting pengumuman' : 'Tulis pengumuman'}
                </h2>

                <div className="space-y-4">
                    <Field label="Tajuk">
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Contoh: Cuti hari raya"
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </Field>

                    <Field label="Kandungan">
                        <textarea
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            rows={5}
                            placeholder="Tulis mesej kepada ibu bapa…"
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                    </Field>

                    <Field label="Untuk siapa">
                        <select
                            value={audience}
                            onChange={e => setAudience(e.target.value as AnnouncementAudience)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {(Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]).map(a => (
                                <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
                            ))}
                        </select>
                    </Field>
                    {audience === 'STAFF' && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                            Notis untuk guru sahaja tidak akan dilihat oleh ibu bapa.
                        </p>
                    )}

                    <Field label="Tarikh tamat (pilihan)">
                        <input
                            type="date"
                            value={expiresAt}
                            onChange={e => setExpiresAt(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </Field>
                    {expiresAt && (
                        <p className="text-xs text-slate-500">
                            Selepas tarikh ini, notis tidak lagi dilihat oleh ibu bapa.
                        </p>
                    )}

                    {error && <Notice tone="error">{error}</Notice>}

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!canSave}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm
                                       hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            {busy ? 'Menyimpan…' : 'Simpan sebagai draf'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-semibold
                                       text-sm hover:bg-slate-200"
                        >
                            Batal
                        </button>
                    </div>
                    <p className="text-xs text-slate-400">
                        Menyimpan tidak menerbitkan. Notis hanya dilihat selepas anda tekan
                        “Terbitkan”.
                    </p>
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: Announcement['status'] }) {
    const cls =
        status === 'PUBLISHED'
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'WITHDRAWN'
              ? 'bg-slate-100 text-slate-600'
              : 'bg-amber-50 text-amber-700';
    return (
        <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>
            {STATUS_LABELS[status]}
        </span>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</span>
            {children}
        </label>
    );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
    const cls = tone === 'error'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-slate-50 text-slate-700 border-slate-200';
    return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function formatDate(value: string): string {
    const d = new Date(value);
    return d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}
