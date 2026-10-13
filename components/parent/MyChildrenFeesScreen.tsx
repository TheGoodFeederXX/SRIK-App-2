/**
 * My children's fees — SRIK.
 *
 * What a parent sees when they open the app: what each of their children owes,
 * and how much of it has been paid.
 *
 * This replaces `FeeStatusScreen` and `FeesPiggyBank`, which were removed. The
 * old screens read a `fees` table that does not exist here, showed amounts in
 * Naira, and offered Paystack and Flutterwave checkout. None of that applies to
 * this school.
 *
 * Four decisions worth explaining.
 *
 * WHY THERE IS NO PAY BUTTON. The school takes money at the counter or by bank
 * transfer, and the office records it. Adding an online checkout would mean a
 * payment gateway, card details, and a reconciliation problem the school has not
 * asked for. What a parent needs is to know what they owe and to see that a
 * payment was received — both of which this screen does.
 *
 * WHY THE CHILD IS NOT A PARAMETER. The database decides which children belong
 * to the signed-in parent, from the family record. If the screen could name a
 * child, a parent could name someone else's.
 *
 * WHY "BELUM DIREKOD" IS NOT "BELUM BAYAR". A charge with no payment recorded
 * against it may still have been paid at the counter five minutes ago. The
 * wording says what the system knows, not what the family did.
 *
 * WHY IT PRINTS. A parent who can hold a statement, or show it to a spouse, has
 * something more useful than a figure on a phone. Browser print needs no extra
 * software and uploads nothing.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
    CurrencyDollarIcon, CheckIcon, ExclamationIcon, PrinterIcon, UsersIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listMyChildrenFees,
    formatMoney,
    periodLabel,
    CHARGE_STATUS_LABELS,
    isSettled,
    type ChildFeeSummary,
} from '../../src/lib/supabase/parentFees';

export default function MyChildrenFeesScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();

    const feesQuery = useQuery({
        queryKey: ['parent', 'fees'],
        queryFn: () => listMyChildrenFees(),
        enabled: !!user,
    });

    const children = useMemo(() => feesQuery.data ?? [], [feesQuery.data]);

    const familyTotal = useMemo(
        () => children.reduce((sum, c) => sum + c.outstanding, 0),
        [children]
    );

    if (feesQuery.isLoading) return <CenteredLoader />;

    if (feesQuery.isError) {
        return (
            <div className="p-4 sm:p-6 max-w-3xl mx-auto">
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-700">
                     {t('myChildrenFeesScreen.cannotOpenStatementNow')}
                </div>
            </div>
        );
    }

    if (!children.length) {
        return (
            <div className="p-4 sm:p-6 max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('myChildrenFeesScreen.yuranAnakSaya')}</h1>
                <p className="text-sm text-slate-500 mb-6">{t('myChildrenFeesScreen.bayaranYuranUntukAnakAnda')}</p>
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <div className="flex justify-center mb-3">
                        <UsersIcon className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="font-semibold text-slate-700">{t('myChildrenFeesScreen.tiadaRekodAnak')}</p>
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                        {t('myChildrenFeesScreen.accountNotConnected')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 max-w-3xl mx-auto">
            <div className="no-print">
                <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('myChildrenFeesScreen.yuranAnakSaya')}</h1>
                <p className="text-sm text-slate-500 mb-5">
                    {t('myChildrenFeesScreen.feePaymentsForChild')}
                </p>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        {t('myChildrenFeesScreen.familyOutstandingTotal')}
                    </p>
                    <p
                        className={`text-3xl font-bold mt-1 ${
                            familyTotal > 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                    >
                        {formatMoney(familyTotal)}
                    </p>
                    {familyTotal <= 0 && (
                        <p className="text-sm text-emerald-700 mt-1 inline-flex items-center gap-1.5">
                            <CheckIcon className="w-4 h-4" />
                             {t('myChildrenFeesScreen.allFeesSettled')}
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800
                               text-white text-sm font-bold hover:bg-slate-900 mb-5"
                >
                    <PrinterIcon className="w-4 h-4" />
                    {t('myChildrenFeesScreen.printStatement')}
                </button>
            </div>

            <div className="space-y-4">
                {children.map(child => (
                    <ChildCard key={child.student_id} child={child} />
                ))}
            </div>

            <p className="no-print text-xs text-slate-400 mt-6 text-center">
                 {t('myChildrenFeesScreen.paymentNotShownContactOffice')}
                sekolah. Rekod di sini dikemas kini apabila pejabat merekodkan bayaran.
            </p>
        </div>
    );
}

function ChildCard({ child }: { child: ChildFeeSummary }) {
    const { t } = useTranslation();
    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden parent-fee-card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">{child.student_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        t('myChildrenFeesScreen.noRegistrationNumber')
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">{t('myChildrenFeesScreen.tertunggak')}</p>
                    <p
                        className={`font-bold ${
                            child.outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                    >
                        {formatMoney(child.outstanding)}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
                <div className="px-5 py-3">
                    <p className="text-xs text-slate-400">{t('myChildrenFeesScreen.jumlahDicaj')}</p>
                    <p className="font-semibold text-slate-700">{formatMoney(child.charged)}</p>
                </div>
                <div className="px-5 py-3">
                    <p className="text-xs text-slate-400">{t('myChildrenFeesScreen.telahDibayar')}</p>
                    <p className="font-semibold text-emerald-700">{formatMoney(child.paid)}</p>
                </div>
            </div>

            {!child.charges.length ? (
                <p className="px-5 py-4 text-sm text-slate-500">
                     {t('myChildrenFeesScreen.noFeeChargesForChild')}
                </p>
            ) : (
                <ul className="divide-y divide-slate-50">
                    {child.charges.map(charge => (
                        <li key={charge.id} className="px-5 py-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-700 truncate">
                                    t('myChildrenFeesScreen.fees')
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {periodLabel(charge.period_month, charge.period_year)}
                                    {charge.due_date ? ` · Perlu bayar ${charge.due_date}` : ''}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <ChargeMark charge={charge} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * How one charge reads to a parent.
 *
 * A settled charge shows a tick and nothing else, because a figure of RM0.00
 * invites the question "was that free, or was it paid". An unpaid one shows what
 * is still owed.
 */
function ChargeMark({
    charge,
}: {
    charge: { status: 'OUTSTANDING' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'CANCELLED'; balance: number; amount: number };
}) {
    const { t } = useTranslation();
    if (charge.status === 'WAIVED' || charge.status === 'CANCELLED') {
        return (
            <span className="text-xs font-semibold text-slate-500">
                {t(t(CHARGE_STATUS_LABELS[charge.status]))}
            </span>
        );
    }
    if (isSettled(charge.status, charge.balance)) {
        return (
            <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                <CheckIcon className="w-3.5 h-3.5" />
                {t('myChildrenFeesScreen.resolved')}
            </span>
        );
    }
    return (
        <span className="text-sm font-bold text-rose-600 inline-flex items-center gap-1.5">
            {charge.status === 'PARTIAL' && (
                <ExclamationIcon className="w-3.5 h-3.5" />
            )}
            {formatMoney(charge.balance)}
        </span>
    );
}

/**
 * A short figure for a dashboard tile.
 *
 * Exported so the parent home can show one number without importing the office
 * finance module, which would blur the two views together.
 */
export function formatParentMoney(amount: number): string {
    return formatMoney(amount);
}

export { CurrencyDollarIcon };
