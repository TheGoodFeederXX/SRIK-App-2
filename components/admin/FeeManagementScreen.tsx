/**
 * Fee setup — SRIK.
 *
 * Where the school says what it charges, and where the month's bills are
 * produced. This replaces the removed `FeeManagement`, `AssignFeePage` and
 * `AutoInvoiceGenerator` screens, which were written against tables that do not
 * exist here and used Naira amounts.
 *
 * Three decisions worth explaining.
 *
 * WHY THE PRICE IS EDITABLE DATA, NOT CODE. A school changes its fee. If the
 * amount lived in the database schema, changing it would need a migration and a
 * developer. Here it is a row the office edits, and last year's charges keep the
 * amounts they were made with.
 *
 * WHY A FEE CAN HAVE NO PRICE. A blank price means "the school has not decided
 * yet". That is different from zero. A zero would silently bill every child
 * nothing; a blank refuses to bill at all, and says so.
 *
 * WHY GENERATING IS SAFE TO PRESS TWICE. The button may be pressed again after a
 * failed request without fear. The database refuses a second charge for the same
 * child, fee and month, so a second run reports what it added — usually nothing
 * — rather than doubling every family's bill.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    PlusIcon, EditIcon, CalculatorIcon, CheckIcon, ExclamationIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listFeeTypes, saveFeeType, generateMonthlyCharges, getCurrentAcademicYear,
    formatMoney, friendlyFinanceError,
    FREQUENCY_LABELS, MONTH_NAMES,
    type FeeType, type FeeFrequency,
} from '../../src/lib/supabase/finance';

export default function FeeManagementScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<Partial<FeeType> | null>(null);

    const feesQuery = useQuery({
        queryKey: ['finance', 'fee-types'],
        queryFn: () => listFeeTypes(true),
        enabled: !!user,
    });

    const fees = useMemo(() => feesQuery.data ?? [], [feesQuery.data]);
    const monthlyFees = useMemo(() => fees.filter(f => f.frequency === 'MONTHLY'), [fees]);

    return (
        <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h1 className="text-2xl font-bold text-slate-800">{t('feeManagementScreen.tetapanYuran')}</h1>
                <button
                    type="button"
                    onClick={() =>
                        setEditing({
                            name: '',
                            code: '',
                            frequency: 'MONTHLY',
                            default_amount: null,
                            status: 'ACTIVE',
                            sort_order: fees.length + 1,
                        })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white
                               text-sm font-bold hover:bg-indigo-700"
                >
                    <PlusIcon className="w-4 h-4" />
                    {t('feeManagementScreen.tambahJenisYuran')}
                </button>
            </div>
            <p className="text-sm text-slate-500 mb-5">
                 {t('feeManagementScreen.schoolFeesList')}
            </p>

            {feesQuery.isLoading ? (
                <CenteredLoader />
            ) : feesQuery.isError ? (
                <Notice tone="error">{friendlyFinanceError(feesQuery.error)}</Notice>
            ) : !fees.length ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="font-semibold text-slate-700">{t('feeManagementScreen.belumAdaJenisYuran')}</p>
                    <p className="text-sm text-slate-500 mt-1">
                         {t('feeManagementScreen.addFeeTypeThenGenerate')}
                    </p>
                </div>
            ) : (
                <ul className="space-y-2 mb-6">
                    {fees.map(fee => (
                        <li
                            key={fee.id}
                            className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center
                                       justify-between gap-3"
                        >
                            <div className="min-w-0">
                                <p className="font-semibold text-slate-800 truncate">
                                    {fee.name}
                                    {fee.status === 'INACTIVE' && (
                                        <span className="ml-2 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                             {t('feeManagementScreen.inactive')}
                                        </span>
                                    )}
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {fee.code}
                                    {' · '}
                                    {t(FREQUENCY_LABELS[fee.frequency])}
                                    {fee.default_amount === null && (
                                        <span className="text-amber-700">
                                            {' · '}Jumlah belum ditetapkan
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <p className="font-bold text-slate-700">
                                    {fee.default_amount === null ? '—' : formatMoney(fee.default_amount)}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setEditing(fee)}
                                    className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                                    aria-label={`Ubah ${fee.name}`}
                                >
                                    <EditIcon className="w-4 h-4" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <GeneratePanel
                monthlyFees={monthlyFees}
                onGenerated={() => {
                    queryClient.invalidateQueries({ queryKey: ['finance'] });
                }}
            />

            {editing && (
                <FeeForm
                    fee={editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        queryClient.invalidateQueries({ queryKey: ['finance'] });
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

// --- Generating a month's bills ---------------------------------------------

function GeneratePanel({
    monthlyFees, onGenerated,
}: {
    monthlyFees: FeeType[];
    onGenerated: () => void;
}) {
    const { t } = useTranslation();
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [dueDate, setDueDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [lastResult, setLastResult] = useState<number | null>(null);

    const yearQuery = useQuery({
        queryKey: ['finance', 'current-year'],
        queryFn: () => getCurrentAcademicYear(),
    });

    async function handleGenerate() {
        if (!yearQuery.data) {
            toast.error(t('feeManagementScreen.tiadaTahunAkademikSemasaDitetapkan'));
            return;
        }
        setBusy(true);
        try {
            const result = await generateMonthlyCharges(
                yearQuery.data.id,
                year,
                month,
                monthlyFees.map(f => f.id),
                dueDate || null
            );
            setLastResult(result.charges_created);
            toast.success(
                result.charges_created === 0
                    ? t('feeManagementScreen.noNewCharges', { month: MONTH_NAMES[month - 1], year: year })
                    : t('feeManagementScreen.chargesGenerated', { count: result.charges_created, month: MONTH_NAMES[month - 1], year: year })
            );
            onGenerated();
        } catch (err) {
            toast.error(friendlyFinanceError(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
                <CalculatorIcon className="w-5 h-5 text-indigo-600" />
                <h2 className="font-bold text-slate-800">{t('feeManagementScreen.janaBilBulanan')}</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4">
                 {t('feeManagementScreen.createThisMonthsCharges')}
                tidak akan bil pelajar dua kali.
            </p>

            {!monthlyFees.length ? (
                <Notice tone="info">
                     {t('feeManagementScreen.noMonthlyFeeInList')}
                </Notice>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                {t('feeManagementScreen.month')}
                            </label>
                            <select
                                value={month}
                                onChange={e => setMonth(Number(e.target.value))}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {MONTH_NAMES.map((name, i) => (
                                    <option key={name} value={i + 1}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                {t('feeManagementScreen.year')}
                            </label>
                            <input
                                type="number"
                                min="2000"
                                max="2100"
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                {t('feeManagementScreen.dueDateOptional')}
                            </label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    <p className="text-xs text-slate-500 mb-3">
                        Akan dijana: {monthlyFees.map(f => `${f.name} (${formatMoney(f.default_amount)})`).join(', ')}
                    </p>

                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={busy}
                        className="px-5 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold
                                   hover:bg-slate-900 disabled:bg-slate-300"
                    >
                        {busy ? 'Menjana…' : `${t('feeManagementScreen.janaUntuk')} ${MONTH_NAMES[month - 1]} ${year}`}
                    </button>

                    {lastResult !== null && (
                        <p className="text-sm text-slate-600 mt-3 inline-flex items-center gap-1.5">
                            {lastResult === 0 ? (
                                <>
                                    <CheckIcon className="w-4 h-4 text-emerald-500" />
                                     {t('feeManagementScreen.noNewChargesMonthAlreadyGenerated')}
                                </>
                            ) : (
                                <>
                                    <CheckIcon className="w-4 h-4 text-emerald-500" />
                                    {lastResult} caj baharu dijana.
                                </>
                            )}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

// --- Editing one fee type ---------------------------------------------------

function FeeForm({
    fee, onClose, onSaved,
}: {
    fee: Partial<FeeType>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(fee.name ?? '');
    const [code, setCode] = useState(fee.code ?? '');
    // Held as a string so a blank box stays blank, rather than becoming 0.
    const [amount, setAmount] = useState(
        fee.default_amount === null || fee.default_amount === undefined
            ? ''
            : String(fee.default_amount)
    );
    const [frequency, setFrequency] = useState<FeeFrequency>(fee.frequency ?? 'MONTHLY');
    const [description, setDescription] = useState(fee.description ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const amountNumber = amount.trim() === '' ? null : Number(amount);
    const amountInvalid =
        amountNumber !== null && (!Number.isFinite(amountNumber) || amountNumber < 0);
    const canSave = name.trim().length > 0 && code.trim().length > 0 && !amountInvalid && !busy;

    async function handleSave() {
        if (!canSave) return;
        setBusy(true);
        setError(null);
        try {
            await saveFeeType({
                id: fee.id,
                name: name.trim(),
                code: code.trim(),
                frequency,
                default_amount: amountNumber,
                description: description.trim() || null,
                status: fee.status ?? 'ACTIVE',
                sort_order: fee.sort_order ?? 0,
            });
            toast.success(fee.id ? t('feeManagementScreen.feeTypeUpdated') : t('feeManagementScreen.feeTypeAdded'));
            onSaved();
        } catch (err) {
            setError(friendlyFinanceError(err));
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto">
                <h2 className="font-bold text-slate-800 mb-4">
                    {fee.id ? t('feeManagementScreen.ubahJenisYuran') : t('feeManagementScreen.tambahJenisYuran')}
                </h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                             {t('feeManagementScreen.feeName')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={t('feeManagementScreen.contohYuranBulanan')}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            Kod
                        </label>
                        <input
                            type="text"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            placeholder={t('feeManagementScreen.contohBULANAN')}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm uppercase
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            {t('feeManagementScreen.amountRM')}
                        </label>
                        <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            placeholder={t('feeManagementScreen.biarkanKosongJikaBelumDitetapkan')}
                            className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none
                                        focus:ring-2 focus:ring-indigo-500 ${
                                            amountInvalid ? 'border-rose-300' : 'border-slate-200'
                                        }`}
                        />
                        <p className="text-xs text-slate-500 mt-1">
                             {t('feeManagementScreen.leaveBlankMeansUndecided')}
                            tidak akan dibilkan.
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            Kekerapan
                        </label>
                        <select
                            value={frequency}
                            onChange={e => setFrequency(e.target.value as FeeFrequency)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {(Object.keys(FREQUENCY_LABELS) as FeeFrequency[]).map(f => (
                                <option key={f} value={f}>
                                    {t(FREQUENCY_LABELS[f])}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            {t('feeManagementScreen.descriptionOptional')}
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {error && <Notice tone="error">{error}</Notice>}

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!canSave}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm
                                       hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            {busy ? t('feeManagementScreen.saving') : t('feeManagementScreen.save')}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm
                                       hover:bg-slate-200"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
    const cls =
        tone === 'error'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-slate-50 text-slate-700 border-slate-200';
    return (
        <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
            {children}
        </div>
    );
}
