/**
 * A child's fee statement — SRIK.
 *
 * What the office opens when a parent telephones, and what it prints to hand
 * over. Written against the real Phase 5 tables; the removed `FeeDetailsScreen`
 * it replaces read tables that do not exist here.
 *
 * Two decisions worth explaining.
 *
 * WHY A DISCOUNT AND A WAIVER ARE DIFFERENT THINGS. A discount lowers what a
 * charge asks for while the child still owes the rest. A waiver says the school
 * has decided the charge is not owed at all. Both need a written reason, because
 * a school should be able to explain, months later, why it took less money than
 * it asked for.
 *
 * WHY THIS PRINTS. A statement a parent can hold is worth more than a figure on
 * a screen, and browser print needs no third-party service. The controls are
 * hidden when printing, so the sheet is clean.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    PrinterIcon, UsersIcon, SearchIcon, CheckIcon, ExclamationIcon, CurrencyDollarIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listOutstanding, listStudentCharges, listActiveStudents, familyBalance,
    setChargeDiscount, setChargeStatus, formatMoney, periodLabel, friendlyFinanceError,
    CHARGE_STATUS_LABELS,
    type StudentBalance, type Charge, type FamilyBalance,
} from '../../src/lib/supabase/finance';

interface StudentOption {
    id: string;
    full_name: string;
    admission_no: string | null;
}

export default function StudentFeesScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [studentId, setStudentId] = useState('');
    const [search, setSearch] = useState('');

    const studentsQuery = useQuery({
        queryKey: ['finance', 'active-students'],
        queryFn: () => listActiveStudents(),
        enabled: !!user,
    });

    const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);

    // Selecting nothing is a real state, so it is cleared rather than left
    // pointing at a student who may no longer be in the list.
    useEffect(() => {
        if (!students.length) return;
        if (!studentId) return;
        if (!students.some(s => s.id === studentId)) setStudentId('');
    }, [students, studentId]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return students;
        return students.filter(
            s =>
                s.full_name.toLowerCase().includes(term) ||
                (s.admission_no ?? '').toLowerCase().includes(term)
        );
    }, [students, search]);

    const selected = useMemo(
        () => students.find(s => s.id === studentId) ?? null,
        [students, studentId]
    );

    return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            <div className="no-print">
                 {t('reportCardScreen.student')}
                <p className="text-sm text-slate-500 mb-5">
                     {t('studentFeesScreen.viewChargesPaymentsBalance')}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={t('studentFeesScreen.cariNamaPelajar')}
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <select
                        value={studentId}
                        onChange={e => setStudentId(e.target.value)}
                        className="sm:w-72 px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">{t('studentFeesScreen.pilihPelajar')}</option>
                        {filtered.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.full_name}
                                {s.admission_no ? ` (${s.admission_no})` : ''}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {studentsQuery.isLoading ? (
                <CenteredLoader />
            ) : studentsQuery.isError ? (
                <Notice tone="error">{friendlyFinanceError(studentsQuery.error)}</Notice>
            ) : !students.length ? (
                <EmptyState
                    title={t('studentFeesScreen.tiadaPelajarAktif')}
                    body={t('studentFeesScreen.enrolStudentFirst')}
                />
            ) : !studentId ? (
                <EmptyState
                    icon={<UsersIcon className="w-8 h-8 text-slate-400" />}
                    title={t('studentFeesScreen.pilihSeorangPelajar')}
                    body={t('studentFeesScreen.selectStudentAbove')}
                />
            ) : (
                <Statement studentId={studentId} studentName={selected?.full_name ?? ''} />
            )}
        </div>
    );
}

function Statement({ studentId, studentName }: { studentId: string; studentName: string }) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const chargesQuery = useQuery({
        queryKey: ['finance', 'charges', studentId],
        queryFn: () => listStudentCharges(studentId),
        enabled: !!user,
    });

    const familyQuery = useQuery({
        queryKey: ['finance', 'family', studentId],
        queryFn: () => familyBalance(studentId),
        enabled: !!user,
    });

    const charges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data]);
    const family: FamilyBalance | undefined = familyQuery.data;

    const totals = useMemo(() => {
        let charged = 0;
        let paid = 0;
        let owed = 0;
        for (const c of charges) {
            if (c.status === 'CANCELLED' || c.status === 'WAIVED') continue;
            charged += c.amount - c.discount_amount;
            paid += c.paid_amount;
            owed += c.balance;
        }
        return { charged, paid, owed };
    }, [charges]);

    function refresh() {
        queryClient.invalidateQueries({ queryKey: ['finance'] });
    }

    if (chargesQuery.isLoading) return <CenteredLoader />;
    if (chargesQuery.isError) return <Notice tone="error">{friendlyFinanceError(chargesQuery.error)}</Notice>;

    return (
        <div>
            <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex flex-wrap gap-3">
                    <Stat label={t('studentFeesScreen.charged')} value={formatMoney(totals.charged)} />
                    <Stat label={t('studentFeesScreen.dibayar')} value={formatMoney(totals.paid)} />
                    <Stat
                        label={t('studentFeesScreen.remaining')}
                        value={formatMoney(totals.owed)}
                        tone={totals.owed > 0 ? 'owed' : 'settled'}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-white
                               text-sm font-bold hover:bg-slate-900"
                >
                    <PrinterIcon className="w-4 h-4" />
                    Cetak penyata
                </button>
            </div>

            {family && family.children > 1 && (
                <div className="no-print bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800">
                    Keluarga ini mempunyai {family.children} orang anak. Jumlah tertunggak
                    keseluruhan keluarga: <strong>{formatMoney(family.outstanding)}</strong>.
                </div>
            )}

            <div className="statement-sheet">
                <div className="hidden print:block mb-4">
                    <h2 className="text-lg font-bold">Penyata Yuran — {studentName}</h2>
                </div>

                {!charges.length ? (
                    <EmptyState
                        title={t('studentFeesScreen.tiadaCaj')}
                        body={t('studentFeesScreen.noFeeChargesYet')}
                    />
                ) : (
                    <ul className="space-y-2">
                        {charges.map(charge => (
                            <ChargeLine
                                key={charge.id}
                                charge={charge}
                                onChanged={refresh}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function ChargeLine({ charge, onChanged }: { charge: Charge; onChanged: () => void }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState<'discount' | 'waive' | null>(null);
    const [discount, setDiscount] = useState(String(charge.discount_amount || ''));
    const [reason, setReason] = useState('');

    const closed = charge.status === 'CANCELLED' || charge.status === 'WAIVED';

    async function handleDiscount() {
        const value = Number(discount);
        if (!Number.isFinite(value) || value < 0) {
            toast.error(t('studentFeesScreen.diskaunMestiNomborYangSah'));
            return;
        }
        if (value > 0 && !reason.trim()) {
            toast.error(t('studentFeesScreen.silaNyatakanSebabDiskaun'));
            return;
        }
        setBusy('discount');
        try {
            await setChargeDiscount(charge.id, value, reason.trim());
            toast.success(t('studentFeesScreen.diskaunDisimpan'));
            setBusy(null);
            setReason('');
            onChanged();
        } catch (err) {
            toast.error(friendlyFinanceError(err));
            setBusy(null);
        }
    }

    async function handleWaive() {
        if (!reason.trim()) {
            toast.error(t('studentFeesScreen.silaNyatakanSebabPengecualian'));
            return;
        }
        setBusy('waive');
        try {
            await setChargeStatus(charge.id, 'WAIVED', reason.trim());
            toast.success(t('studentFeesScreen.cajDikecualikan'));
            setBusy(null);
            setReason('');
            onChanged();
        } catch (err) {
            toast.error(friendlyFinanceError(err));
            setBusy(null);
        }
    }

    return (
        <li className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                        {charge.description || 'Yuran'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {periodLabel(charge.period_month, charge.period_year)}
                        {' · '}
                        <span
                            className={
                                charge.status === 'PAID'
                                    ? 'text-emerald-700 font-semibold'
                                    : charge.status === 'PARTIAL'
                                    ? 'text-amber-700 font-semibold'
                                    : closed
                                    ? 'text-slate-500'
                                    : 'text-rose-700 font-semibold'
                            }
                        >
                            {t(t(CHARGE_STATUS_LABELS[charge.status]))}
                        </span>
                        {charge.due_date && ` · Perlu bayar ${charge.due_date}`}
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700">{formatMoney(charge.amount)}</p>
                    {charge.discount_amount > 0 && (
                        <p className="text-xs text-emerald-700">
                            tolak {formatMoney(charge.discount_amount)}
                        </p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                        Baki {formatMoney(charge.balance)}
                    </p>
                </div>
            </div>

            {charge.discount_reason && (
                <p className="text-xs text-slate-500 mt-2">
                    Sebab diskaun: {charge.discount_reason}
                </p>
            )}

            {!closed && (
                <div className="no-print mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={discount}
                        onChange={e => setDiscount(e.target.value)}
                        placeholder={t('studentFeesScreen.diskaunRM')}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('studentFeesScreen.sebabWajib')}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleDiscount}
                            disabled={busy !== null}
                            className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold
                                       hover:bg-indigo-700 disabled:bg-slate-300"
                        >
                            {busy === 'discount' ? '…' : t('studentFeesScreen.saveDiscount')}
                        </button>
                        <button
                            type="button"
                            onClick={handleWaive}
                            disabled={busy !== null || charge.paid_amount > 0}
                            title={
                                charge.paid_amount > 0
                                    ? t('studentFeesScreen.chargeAlreadyHasPayment')
                                    : undefined
                            }
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold
                                       hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-300
                                       disabled:cursor-not-allowed"
                        >
                            {busy === 'waive' ? '…' : 'Kecualikan'}
                        </button>
                    </div>
                </div>
            )}
        </li>
    );
}

function Stat({
    label, value, tone,
}: {
    label: string;
    value: string;
    tone?: 'owed' | 'settled';
}) {
    const color =
        tone === 'owed' ? 'text-rose-600' : tone === 'settled' ? 'text-emerald-600' : 'text-slate-800';
    return (
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 min-w-[7rem]">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
            <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
        </div>
    );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
    const cls =
        tone === 'error'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-slate-50 text-slate-700 border-slate-200';
    return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function EmptyState({
    icon, title, body,
}: {
    icon?: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            {icon && <div className="flex justify-center mb-3">{icon}</div>}
            <p className="font-semibold text-slate-700">{title}</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>
        </div>
    );
}
