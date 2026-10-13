/**
 * Fee collection — SRIK.
 *
 * A new screen. The source project had fee screens, but they were built for a
 * Nigerian multi-tenant SaaS: they read a `fees` table that does not exist here,
 * showed amounts in Naira, and offered Paystack, Flutterwave and mobile-money
 * checkout. All of that was removed. This screen was written against the real
 * Phase 5 tables.
 *
 * What the office does, in order:
 *   1. See who still owes money, biggest debt first.
 *   2. Open a child and see exactly which charges make up what they owe.
 *   3. Type the amount received and tick the charges it settles.
 *   4. Save once. The receipt number is shown, ready to give to the parent.
 *
 * Five decisions worth explaining.
 *
 * WHY THE BALANCE IS NEVER CALCULATED HERE. What a child owes comes from the
 * database (`charge_balance`), which computes amount, less discount, less
 * confirmed payments. Recomputing it in the browser would create a second answer
 * that could disagree with the ledger, and then nobody would know which is true.
 *
 * WHY THE ALLOCATION BOXES PRE-FILL BUT STAY EDITABLE. A parent usually pays one
 * charge in full, so ticking it would be a waste of clicks. But a parent paying
 * RM100 against a RM150 fee must be describable, so every box can be typed into.
 * Nothing is auto-saved; the clerk always confirms the split.
 *
 * WHY A REVERSAL IS A SCREEN ACTION, NOT A DELETE. The database has no delete
 * for a payment, and this screen has no such button. A mistake is reversed with
 * a written reason, which leaves both the mistake and the correction on file.
 * An office that can erase a receipt cannot prove what it received.
 *
 * WHY THE SAVE BUTTON IS DISABLED UNTIL THE NUMBERS ADD UP. A payment whose
 * allocations do not equal the amount received would leave money unexplained in
 * the accounts. The database refuses it; the screen shows why before the clerk
 * presses Save, rather than after.
 *
 * WHY OVERPAYING ONE CHARGE IS BLOCKED. Paying RM200 against a RM30 PIBG fee is
 * nearly always a typo, and it would leave a credit nobody can explain. The
 * screen stops it and points at the other charges instead.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    CurrencyDollarIcon, UsersIcon, CheckIcon, PrinterIcon, ExclamationIcon,
    RotateCcwIcon, ReceiptIcon, SearchIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listOutstanding, listStudentCharges, recordPayment, listPayments, reversePayment,
    newIdempotencyKey,
    formatMoney, periodLabel, friendlyFinanceError,
    CHARGE_STATUS_LABELS, METHOD_LABELS,
    type StudentBalance, type Charge, type Payment, type PaymentMethod,
} from '../../src/lib/supabase/finance';

type Tab = 'outstanding' | 'receipts';

export default function FeeCollectionScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<Tab>('outstanding');
    const [selected, setSelected] = useState<StudentBalance | null>(null);
    const [search, setSearch] = useState('');

    const outstandingQuery = useQuery({
        queryKey: ['finance', 'outstanding'],
        queryFn: () => listOutstanding(),
        enabled: !!user,
    });

    const paymentsQuery = useQuery({
        queryKey: ['finance', 'payments'],
        queryFn: () => listPayments({ limit: 100 }),
        enabled: !!user,
    });

    const outstanding = useMemo(
        () => outstandingQuery.data ?? [],
        [outstandingQuery.data]
    );

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return outstanding;
        return outstanding.filter(
            s =>
                s.student_name.toLowerCase().includes(term) ||
                (s.admission_no ?? '').toLowerCase().includes(term)
        );
    }, [outstanding, search]);

    const totalOutstanding = useMemo(
        () => outstanding.reduce((sum, s) => sum + s.outstanding, 0),
        [outstanding]
    );

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <div className="no-print">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <h1 className="text-2xl font-bold text-slate-800">{t('feeCollectionScreen.bayaranYuran')}</h1>
                    <div className="flex rounded-xl overflow-hidden border border-slate-200">
                        <button
                            type="button"
                            onClick={() => setTab('outstanding')}
                            className={`px-4 py-2 text-sm font-semibold transition-colors ${
                                tab === 'outstanding'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            Tunggakan
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('receipts')}
                            className={`px-4 py-2 text-sm font-semibold transition-colors ${
                                tab === 'receipts'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            Resit
                        </button>
                    </div>
                </div>
                <p className="text-sm text-slate-500 mb-5">
                     {t('feeCollectionScreen.recordFeePaymentsArrearsReceipts')}
                </p>

                {tab === 'outstanding' && (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Jumlah tertunggak
                                </p>
                                <p className="text-2xl font-bold text-slate-800 mt-1">
                                    {outstandingQuery.isLoading ? '—' : formatMoney(totalOutstanding)}
                                </p>
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                     {t('feeCollectionScreen.studentsOutstanding')}
                                </p>
                                <p className="text-2xl font-bold text-slate-800 mt-1">
                                    {outstandingQuery.isLoading ? '—' : `${outstanding.length} orang`}
                                </p>
                            </div>
                        </div>

                        <div className="relative mb-4">
                            <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={t('feeCollectionScreen.cariNamaPelajarAtauNomborPendaftaran')}
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        {outstandingQuery.isLoading ? (
                            <CenteredLoader />
                        ) : outstandingQuery.isError ? (
                            <Notice tone="error">
                                {friendlyFinanceError(outstandingQuery.error)}
                            </Notice>
                        ) : !outstanding.length ? (
                            <EmptyState
                                icon={<CheckIcon className="w-8 h-8 text-emerald-500" />}
                                title={t('feeCollectionScreen.tiadaTunggakan')}
                                body="Semua pelajar sudah menyelesaikan bayaran mereka, atau yuran bulan ini belum dijana."
                            />
                        ) : !visible.length ? (
                            <EmptyState
                                icon={<UsersIcon className="w-8 h-8 text-slate-400" />}
                                title={t('feeCollectionScreen.tiadaPelajarSepadan')}
                                body="Cuba nama atau nombor pendaftaran yang lain."
                            />
                        ) : (
                            <ul className="space-y-2">
                                {visible.map(student => (
                                    <li key={student.student_id}>
                                        <button
                                            type="button"
                                            onClick={() => setSelected(student)}
                                            className="w-full text-left bg-white rounded-2xl border border-slate-200
                                                       p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-slate-800 truncate">
                                                        {student.student_name}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-0.5">
                                                        {student.admission_no ?? 'Tiada nombor pendaftaran'}
                                                        {' · '}
                                                        {formatMoney(student.paid)} telah dibayar
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-bold text-rose-600">
                                                        {formatMoney(student.outstanding)}
                                                    </p>
                                                    <p className="text-xs text-slate-400">tertunggak</p>
                                                </div>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}

                {tab === 'receipts' && (
                    <ReceiptsTab
                        query={paymentsQuery}
                        onReversed={() => {
                            queryClient.invalidateQueries({ queryKey: ['finance'] });
                        }}
                    />
                )}
            </div>

            {selected && (
                <CollectPanel
                    student={selected}
                    onClose={() => setSelected(null)}
                    onRecorded={() => {
                        queryClient.invalidateQueries({ queryKey: ['finance'] });
                        setSelected(null);
                        setTab('receipts');
                    }}
                />
            )}
        </div>
    );
}

// --- Collecting payment for one child ---------------------------------------

function CollectPanel({
    student, onClose, onRecorded,
}: {
    student: StudentBalance;
    onClose: () => void;
    onRecorded: () => void;
}) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<PaymentMethod>('CASH');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    /** What the clerk has typed against each charge, keyed by charge id. */
    const [allocation, setAllocation] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chargesQuery = useQuery({
        queryKey: ['finance', 'charges', student.student_id],
        queryFn: () => listStudentCharges(student.student_id),
        enabled: !!user,
    });

    const charges = useMemo(
        () =>
            (chargesQuery.data ?? []).filter(
                c => c.status === 'OUTSTANDING' || c.status === 'PARTIAL'
            ),
        [chargesQuery.data]
    );

    // Pre-fill each charge with the smaller of what it owes and what is being
    // paid, spread in order. This covers the common case — one parent settling
    // one or two fees — without hiding the split from the clerk.
    useEffect(() => {
        const paidSoFar = Number(amount) || 0;
        const next: Record<string, string> = {};
        let remaining = paidSoFar;
        for (const charge of charges) {
            const take = Math.min(charge.balance, Math.max(remaining, 0));
            next[charge.id] = take > 0 ? take.toFixed(2) : '';
            remaining -= take;
        }
        setAllocation(next);
    }, [amount, charges]);

    const allocatedTotal = useMemo(
        () =>
            Object.values(allocation).reduce((sum, v) => {
                const n = Number(v);
                return sum + (Number.isFinite(n) && n > 0 ? n : 0);
            }, 0),
        [allocation]
    );

    const amountValue = Number(amount) || 0;
    const difference = amountValue - allocatedTotal;
    // Compared to the sen, because that is the unit the ledger uses.
    const addsUp = Math.abs(difference) < 0.005;

    const overpaidCharge = useMemo(() => {
        for (const charge of charges) {
            const typed = Number(allocation[charge.id]) || 0;
            if (typed > charge.balance + 0.0001) return charge;
        }
        return null;
    }, [charges, allocation]);

    const canSave =
        amountValue > 0 && allocatedTotal > 0 && addsUp && !overpaidCharge && !saving;

    // The key for the submission currently in progress.
    //
    // A ref rather than state: it must NOT change when the component re-renders,
    // because a re-render between the two attempts would produce a new key and
    // recreate the duplicate-payment risk this exists to remove (audit F22).
    const submissionKeyRef = useRef<string | null>(null);

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        // ONE key for THIS submission, kept if the attempt fails so the retry
        // reuses it (audit F22).
        //
        // This is the whole point: if the server records the payment but the reply
        // is lost, the clerk presses save again — and the second attempt must be
        // recognisable as the same submission. A key minted inside the call would
        // be new every time, so the server would see a second, different payment
        // and the school would collect twice. Persisted in a ref so it survives
        // re-renders and a second press, and cleared only once the result is
        // definitive.
        const key = submissionKeyRef.current ?? newIdempotencyKey();
        submissionKeyRef.current = key;
        try {
            const result = await recordPayment({
                amount: amountValue,
                allocations: Object.entries(allocation)
                    .map(([charge_id, value]) => ({ charge_id, amount: Number(value) }))
                    .filter(a => a.amount > 0),
                method,
                reference: reference.trim() || null,
                notes: notes.trim() || null,
                idempotencyKey: key,
            });
            // Definitive result, so the submission is finished and the key must not
            // be reused for a different payment.
            submissionKeyRef.current = null;
            toast.success(
                result.duplicate
                    ? `Bayaran ini sudah direkodkan. Resit ${result.reference}.`
                    : `Bayaran ${formatMoney(result.amount)} direkodkan. Resit ${result.reference}.`
            );
            onRecorded();
        } catch (err) {
            setError(friendlyFinanceError(err));
            setSaving(false);
        }
    }

    return (
        <div className="no-print fixed inset-0 z-50 flex justify-end">
            <div
                className="absolute inset-0 bg-slate-900/40"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl">
                <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="font-bold text-slate-800">{t('feeCollectionScreen.kutipBayaran')}</h2>
                        <p className="text-sm text-slate-500">{student.student_name}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                        aria-label="Tutup"
                    >
                        ×
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {chargesQuery.isLoading ? (
                        <CenteredLoader />
                    ) : chargesQuery.isError ? (
                        <Notice tone="error">{friendlyFinanceError(chargesQuery.error)}</Notice>
                    ) : !charges.length ? (
                        <EmptyState
                            icon={<CheckIcon className="w-8 h-8 text-emerald-500" />}
                            title={t('feeCollectionScreen.tiadaCajTertunggak')}
                            body="Pelajar ini tidak mempunyai caj yang belum dibayar."
                        />
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Jumlah diterima (RM)
                                </label>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full px-3 py-3 rounded-xl border border-slate-200 text-lg font-bold
                                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Jumlah tertunggak: <strong>{formatMoney(student.outstanding)}</strong>
                                </p>
                            </div>

                            <div>
                                <p className="text-sm font-semibold text-slate-700 mb-2">
                                     {t('feeCollectionScreen.allocateToThisCharge')}
                                </p>
                                <ul className="space-y-2">
                                    {charges.map(charge => (
                                        <ChargeRow
                                            key={charge.id}
                                            charge={charge}
                                            value={allocation[charge.id] ?? ''}
                                            onChange={v =>
                                                setAllocation(prev => ({ ...prev, [charge.id]: v }))
                                            }
                                            over={overpaidCharge?.id === charge.id}
                                        />
                                    ))}
                                </ul>
                            </div>

                            <div
                                className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
                                    addsUp && allocatedTotal > 0
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-amber-50 text-amber-800'
                                }`}
                            >
                                {addsUp && allocatedTotal > 0 ? (
                                    <>
                                        <CheckIcon className="w-4 h-4" />
                                        {t('feeCollectionScreen.amountMatches', { amount: formatMoney(allocatedTotal) })}
                                    </>
                                ) : allocatedTotal === 0 ? (
                                    <>
                                        <ExclamationIcon className="w-4 h-4" />
                                         {t('feeCollectionScreen.enterAmountForAtLeastOneCharge')}
                                    </>
                                ) : (
                                    <>
                                        <ExclamationIcon className="w-4 h-4" />
                                        {difference > 0
                                            ? t('feeCollectionScreen.unallocated', { amount: formatMoney(difference) })
                                            : t('feeCollectionScreen.overAllocated', { amount: formatMoney(-difference) })}
                                    </>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                        Cara bayaran
                                    </label>
                                    <select
                                        value={method}
                                        onChange={e => setMethod(e.target.value as PaymentMethod)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map(m => (
                                            <option key={m} value={m}>
                                                {t(METHOD_LABELS[m])}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                        No. resit (pilihan)
                                    </label>
                                    <input
                                        type="text"
                                        value={reference}
                                        onChange={e => setReference(e.target.value)}
                                        placeholder="Auto"
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                                   focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    {t('feeCollectionScreen.catatanPilihan')}
                                </label>
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder={t('feeCollectionScreen.contohDibayarOlehNenek')}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {error && <Notice tone="error">{error}</Notice>}

                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave}
                                className="w-full py-3 rounded-xl font-bold text-white transition-colors
                                           disabled:bg-slate-300 disabled:cursor-not-allowed
                                           bg-indigo-600 hover:bg-indigo-700"
                            >
                                {saving ? t('feeCollectionScreen.menyimpan') : t('feeCollectionScreen.simpanBayaran')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function ChargeRow({
    charge, value, onChange, over,
}: {
    charge: Charge;
    value: string;
    onChange: (v: string) => void;
    over: boolean;
}) {
    const { t } = useTranslation();
    return (
        <li
            className={`rounded-xl border p-3 ${
                over ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                        {charge.description || periodLabel(charge.period_month, charge.period_year)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {periodLabel(charge.period_month, charge.period_year)}
                        {' · '}
                        {t(t(CHARGE_STATUS_LABELS[charge.status]))}
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">{t('feeCollectionScreen.remaining')}</p>
                    <p className="text-sm font-bold text-slate-700">{formatMoney(charge.balance)}</p>
                </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">Bayar</span>
                <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder="0.00"
                    className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {over && (
                    <span className="text-xs font-semibold text-rose-600">
                        Melebihi baki
                    </span>
                )}
            </div>
        </li>
    );
}

// --- Receipts ---------------------------------------------------------------

function ReceiptsTab({
    query, onReversed,
}: {
    query: { data?: Payment[]; isLoading: boolean; isError: boolean; error: unknown };
    onReversed: () => void;
}) {
    const { t } = useTranslation();
    const payments = useMemo(() => query.data ?? [], [query.data]);

    if (query.isLoading) return <CenteredLoader />;
    if (query.isError) return <Notice tone="error">{friendlyFinanceError(query.error)}</Notice>;
    if (!payments.length) {
        return (
            <EmptyState
                icon={<ReceiptIcon className="w-8 h-8 text-slate-400" />}
                title={t('feeCollectionScreen.tiadaResitLagi')}
                body="Resit akan muncul di sini sebaik bayaran pertama direkodkan."
            />
        );
    }

    return (
        <ul className="space-y-2">
            {payments.map(payment => (
                <ReceiptCard key={payment.id} payment={payment} onReversed={onReversed} />
            ))}
        </ul>
    );
}

function ReceiptCard({ payment, onReversed }: { payment: Payment; onReversed: () => void }) {
    const { t } = useTranslation();
    const [reversing, setReversing] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const reversed = payment.status === 'REVERSED';

    async function handleReverse() {
        if (!reason.trim()) {
            toast.error(t('feeCollectionScreen.silaNyatakanSebabPembatalan'));
            return;
        }
        setBusy(true);
        try {
            await reversePayment(payment.id, reason.trim());
            toast.success(`Bayaran ${payment.reference} telah dibatalkan.`);
            onReversed();
        } catch (err) {
            toast.error(friendlyFinanceError(err));
            setBusy(false);
        }
    }

    return (
        <li className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                        {payment.reference}
                        {payment.is_reversal && (
                            <span className="ml-2 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                Pembatalan
                            </span>
                        )}
                        {reversed && (
                            <span className="ml-2 text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                                 {t('feeCollectionScreen.cancelled')}
                            </span>
                        )}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(payment.paid_at).toLocaleString('ms-MY')}
                        {' · '}
                        {t(METHOD_LABELS[payment.method])}
                        {payment.payer_name ? ` · ${payment.payer_name}` : ''}
                    </p>
                </div>
                <p
                    className={`font-bold shrink-0 ${
                        payment.is_reversal || reversed ? 'text-slate-400 line-through' : 'text-emerald-700'
                    }`}
                >
                    {formatMoney(payment.amount)}
                </p>
            </div>

            {payment.allocations.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                    {payment.allocations.map((a, i) => (
                        <li key={i} className="flex justify-between text-xs text-slate-600">
                            <span className="truncate">
                                {a.student_name ? `${a.student_name} — ` : ''}
                                {a.fee_type_name ?? 'Yuran'}
                                {' · '}
                                {periodLabel(a.period_month, a.period_year)}
                            </span>
                            <span className="shrink-0 ml-2">{formatMoney(a.amount)}</span>
                        </li>
                    ))}
                </ul>
            )}

            {reversed && payment.reversal_reason && (
                <p className="mt-2 text-xs text-rose-700">
                    Sebab pembatalan: {payment.reversal_reason}
                </p>
            )}

            {!reversed && !payment.is_reversal && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                    {!reversing ? (
                        <button
                            type="button"
                            onClick={() => setReversing(true)}
                            className="text-xs font-semibold text-slate-500 hover:text-rose-600 inline-flex items-center gap-1"
                        >
                            <RotateCcwIcon className="w-3.5 h-3.5" />
                            Batalkan bayaran ini
                        </button>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-xs text-slate-500">
                                 {t('feeCollectionScreen.paymentNotDeleted')}
                            </p>
                            <input
                                type="text"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                                placeholder={t('feeCollectionScreen.sebabPembatalanWajib')}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleReverse}
                                    disabled={busy}
                                    className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold
                                               hover:bg-rose-700 disabled:bg-slate-300"
                                >
                                    {busy ? t('feeCollectionScreen.membatalkan') : t('feeCollectionScreen.sahkanPembatalan')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReversing(false);
                                        setReason('');
                                    }}
                                    className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold
                                               hover:bg-slate-200"
                                >
                                    Kembali
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

// --- Small shared pieces ----------------------------------------------------

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
    const cls =
        tone === 'error'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-slate-50 text-slate-700 border-slate-200';
    return (
        <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`} role="status">
            {children}
        </div>
    );
}

function EmptyState({
    icon, title, body,
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <div className="flex justify-center mb-3">{icon}</div>
            <p className="font-semibold text-slate-700">{title}</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>
        </div>
    );
}
