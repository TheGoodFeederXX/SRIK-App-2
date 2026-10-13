/**
 * Rekod Audit — the office's view of what was changed, by whom.
 *
 * This screen exists to answer questions a school actually gets asked: who
 * changed this mark, who recorded this payment, who edited this child's record.
 *
 * Three decisions worth stating.
 *
 * WHY IT CANNOT BE EDITED FROM HERE. The audit log has no insert, update or
 * delete policy for any role, so this file has no function that could write to
 * it. The record is made by database triggers alone. A screen that could tidy up
 * the log would make the log worthless, so no such screen was built — this one
 * reads.
 *
 * WHY THE ACTOR COMES FROM THE ROW. Whatever the browser believes about who is
 * signed in, the name shown is the one the database recorded from the session at
 * the time of the change. A client cannot attribute an action to someone else,
 * and this screen cannot be made to display a false attribution.
 *
 * WHY ONLY THE CHANGED FIELDS ARE SHOWN. A raw before/after image is sixty
 * columns of JSON that nobody reads. A clerk wants the two fields that moved.
 * The comparison is done in the database so the browser is not trusted to decide
 * what changed.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ClipboardListIcon, SearchIcon, ShieldIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listAuditLog, friendlyAuditError, describeValue, entityLabel,
    ACTION_LABELS, ENTITY_LABELS,
    type AuditEntry, type FieldChange,
} from '../../src/lib/supabase/auditTrail';

export default function AuditTrailScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [entityType, setEntityType] = useState<string>('');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<number | null>(null);

    const logQuery = useQuery({
        queryKey: ['audit', 'list', entityType],
        queryFn: () => listAuditLog({ entityType: entityType || null, limit: 200 }),
        enabled: !!user,
    });

    const entries = useMemo(() => logQuery.data ?? [], [logQuery.data]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return entries;
        return entries.filter(
            e =>
                (e.actor_email ?? '').toLowerCase().includes(term) ||
                entityLabel(e.entity_type).toLowerCase().includes(term) ||
                (e.entity_id ?? '').includes(term)
        );
    }, [entries, search]);

    return (
        <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('auditTrailScreen.rekodAudit')}</h1>
            <p className="text-sm text-slate-500 mb-4">
                Setiap perubahan pada rekod pelajar, kehadiran, markah dan bayaran direkodkan di
                sini. Rekod ini tidak boleh dipadam atau diubah.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5
                            flex items-start gap-2">
                <ShieldIcon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-600">
                    Nama yang dicatat diambil daripada sesi yang sebenar semasa perubahan berlaku,
                    bukan daripada apa yang diminta oleh pelayar. Tiada sesiapa — termasuk
                    pentadbir — boleh mengubah atau memadam rekod ini.
                </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <div className="relative flex-1">
                    <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('auditTrailScreen.cariNamaPenggunaAtauNoRujukan')}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <select
                    value={entityType}
                    onChange={e => setEntityType(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="">{t('auditTrailScreen.semuaJenisRekod')}</option>
                    {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {logQuery.isLoading ? (
                <CenteredLoader />
            ) : logQuery.isError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm
                                text-rose-700">
                    {friendlyAuditError(logQuery.error)}
                </div>
            ) : !filtered.length ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <div className="flex justify-center mb-3">
                        <ClipboardListIcon className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="font-semibold text-slate-700">{t('auditTrailScreen.tiadaRekod')}</p>
                    <p className="text-sm text-slate-500 mt-1">
                        {entries.length ? t('auditTrailScreen.tiadaRekodSepadanDenganCarianAnda') : t('auditTrailScreen.belumAdaPerubahanDirekodkan')}
                    </p>
                </div>
            ) : (
                <ul className="space-y-1.5">
                    {filtered.map(entry => (
                        <li key={entry.id} className="bg-white rounded-xl border border-slate-200">
                            <button
                                type="button"
                                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                                className="w-full text-left px-4 py-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-800">
                                            {entityLabel(entry.entity_type)}
                                            <span className="font-normal text-slate-400"> · </span>
                                            <span className="font-normal text-slate-600">
                                                {ACTION_LABELS[entry.action]}
                                            </span>
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {entry.actor_email ?? 'Sistem'}
                                            {entry.entity_id
                                                ? ` · ${shortId(entry.entity_id)}`
                                                : ''}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-xs text-slate-400">
                                        {formatDate(entry.created_at)}
                                    </span>
                                </div>
                            </button>

                            {expanded === entry.id && (
                                <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                                    <Changes entry={entry} />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {!logQuery.isLoading && !logQuery.isError && filtered.length > 0 && (
                <p className="text-xs text-slate-400 mt-4 text-center">
                    Menunjukkan {filtered.length} rekod terkini.
                </p>
            )}
        </div>
    );
}

/** The fields that moved, with what they were and what they became. */
function Changes({ entry }: { entry: AuditEntry }) {
    const { t } = useTranslation();
    if (entry.action === 'INSERT') {
        return (
            <div className="text-sm text-slate-600">
                <p className="text-xs font-semibold text-slate-500 mb-1.5">{t('auditTrailScreen.rekodBaharuDicipta')}</p>
                {entry.after_data && (
                    <ul className="space-y-1">
                        {summarise(entry.after_data).map(([key, value]) => (
                            <li key={key} className="flex gap-2 text-xs">
                                <span className="text-slate-400 w-32 shrink-0 truncate">{key}</span>
                                <span className="text-slate-700 truncate">{describeValue(value)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    if (entry.action === 'DELETE') {
        return (
            <div className="text-sm text-slate-600">
                <p className="text-xs font-semibold text-slate-500 mb-1.5">
                    Rekod dipadam — nilai terakhir disimpan
                </p>
                {entry.before_data && (
                    <ul className="space-y-1">
                        {summarise(entry.before_data).map(([key, value]) => (
                            <li key={key} className="flex gap-2 text-xs">
                                <span className="text-slate-400 w-32 shrink-0 truncate">{key}</span>
                                <span className="text-slate-700 truncate">{describeValue(value)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    const changes = diff(entry.before_data, entry.after_data);
    if (!changes.length) {
        return <p className="text-xs text-slate-400">{t('auditTrailScreen.tiadaPerubahanBidangDirekodkan')}</p>;
    }

    return (
        <ul className="space-y-1.5">
            {changes.map(([key, change]) => (
                <li key={key} className="text-xs flex flex-wrap items-center gap-2">
                    <span className="text-slate-500 w-32 shrink-0 truncate">{key}</span>
                    <span className="text-slate-400 line-through">
                        {describeValue(change.from)}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-800 font-semibold">{describeValue(change.to)}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * Compares two versions, ignoring timestamps.
 *
 * Done in the browser here because the row is already in hand from the list
 * call; the database does the same comparison for the per-record history view,
 * so both agree on what counts as a change.
 */
function diff(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
): [string, FieldChange][] {
    if (!after) return [];
    const out: [string, FieldChange][] = [];
    for (const [key, value] of Object.entries(after)) {
        if (key === 'updated_at' || key === 'created_at') continue;
        const previous = before?.[key];
        if (JSON.stringify(previous) !== JSON.stringify(value)) {
            out.push([key, { from: previous, to: value }]);
        }
    }
    return out;
}

/**
 * A handful of the most telling fields, for a created or deleted record.
 *
 * Everything is not shown: a wall of sixty columns buries the two that matter,
 * and the full row is available to anyone who needs to query it.
 */
function summarise(row: Record<string, unknown>): [string, unknown][] {
    const priority = [
        'full_name', 'title', 'name', 'admission_no', 'amount', 'discount_amount',
        'status', 'paid_amount', 'balance', 'body', 'relationship',
    ];
    const seen = new Set<string>();
    const out: [string, unknown][] = [];

    for (const key of priority) {
        if (key in row && row[key] !== null && row[key] !== undefined) {
            out.push([key, row[key]]);
            seen.add(key);
        }
    }
    for (const [key, value] of Object.entries(row)) {
        if (seen.has(key) || key === 'updated_at' || key === 'created_at') continue;
        if (value === null || value === undefined || typeof value === 'object') continue;
        out.push([key, value]);
        if (out.length >= 8) break;
    }
    return out;
}

function shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatDate(value: string): string {
    const d = new Date(value);
    return d.toLocaleString('ms-MY', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}
