/**
 * Pengumuman — what a parent sees.
 *
 * A notice written by the office reaches a family here. This screen has no
 * permission behind it: the database admits a parent to a notice because they
 * are its audience and the notice is published and in date. There is therefore
 * nothing on this screen that could widen what a parent reads — no filter to
 * remove, no query to change.
 *
 * A draft never appears, and neither does a note addressed to staff. That is
 * enforced by the row-level policy rather than by this file, which is why the
 * screen simply shows what it is given.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MegaphoneIcon, CalendarIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listPublishedAnnouncements, friendlyAnnouncementError, AUDIENCE_LABELS,
    type Announcement,
} from '../../src/lib/supabase/announcements';

export default function MyAnnouncementsScreen() {
    const { user } = useAuth();

    const listQuery = useQuery({
        queryKey: ['announcements', 'published'],
        queryFn: () => listPublishedAnnouncements(),
        enabled: !!user,
    });

    const items = useMemo(() => listQuery.data ?? [], [listQuery.data]);

    if (listQuery.isLoading) return <CenteredLoader />;

    return (
        <div className="p-4 sm:p-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-slate-800 mb-1">Pengumuman</h1>
            <p className="text-sm text-slate-500 mb-5">
                Notis daripada pihak sekolah.
            </p>

            {listQuery.isError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm
                                text-rose-700">
                    {friendlyAnnouncementError(listQuery.error)}
                </div>
            ) : !items.length ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <div className="flex justify-center mb-3">
                        <MegaphoneIcon className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="font-semibold text-slate-700">Tiada pengumuman</p>
                    <p className="text-sm text-slate-500 mt-1">
                        Belum ada notis daripada pihak sekolah buat masa ini.
                    </p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {items.map(item => (
                        <li key={item.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                            <p className="font-semibold text-slate-800">{item.title}</p>
                            <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">
                                {item.body}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3
                                            border-t border-slate-100 text-xs text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                    <CalendarIcon className="w-3.5 h-3.5" />
                                    {formatDate(item.publish_at ?? item.created_at)}
                                </span>
                                {item.audience !== 'ALL' && (
                                    <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                        {AUDIENCE_LABELS[item.audience]}
                                    </span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function formatDate(value: string): string {
    const d = new Date(value);
    return d.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });
}
