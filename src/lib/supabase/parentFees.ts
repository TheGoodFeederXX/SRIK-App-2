/**
 * A parent's view of their own children's fees — SRIK.
 *
 * Reference: docs/srik/07_PHASE_5_FINANCE.md
 *
 * A SEPARATE FILE FROM `finance.ts`, ON PURPOSE.
 *
 * `finance.ts` is the office's view: every child, every receipt, every action.
 * This file is a parent's view: their own children, read only. Keeping them
 * apart means the parent path cannot accidentally acquire an office capability,
 * and a reader can see the whole of what a parent is allowed to do by reading
 * one file.
 *
 * What a parent cannot do is enforced by the database, not by this file. A
 * parent holds no finance permission, so `finance.view`-gated calls fail for
 * them, and the family-scoped policies in the database decide which rows exist
 * for them at all. This file simply does not offer the actions.
 *
 * Three things worth being clear about:
 *
 * 1. THERE IS NO `recordPayment` HERE. A parent cannot record a payment, and
 *    there is no function to call. Money is taken at the counter and recorded
 *    by the office, which keeps the audit trail in one place.
 *
 * 2. A PARENT SEES A BALANCE, NEVER A FORMULA. The figures come from the
 *    database's own derived functions, so a parent and the office always see
 *    the same number for the same child.
 *
 * 3. A CHILD WITH NOTHING OWED STILL APPEARS. Hiding a settled child would make
 *    a parent wonder whether the record had been lost.
 */

import { requireSupabase } from './client';
import {
    formatMoney,
    periodLabel,
    CHARGE_STATUS_LABELS,
    type Charge,
    type ChargeStatus,
    type FamilyBalance,
} from './finance';

export interface ChildFeeSummary {
    student_id: string;
    student_name: string;
    admission_no: string | null;
    charged: number;
    paid: number;
    outstanding: number;
    charges: Charge[];
}

/**
 * The signed-in parent's own children and their fees.
 *
 * No child id is passed in: the database decides which children belong to the
 * caller. That is deliberate, because a parameter would be a name a caller
 * could change, and this is exactly the value that must not be changeable.
 */
export async function listMyChildrenFees(): Promise<ChildFeeSummary[]> {
    const supabase = requireSupabase();

    // The children, through the family link. The database returns only the
    // caller's own, because the policy on `students` allows nothing else.
    const { data: students, error: studentError } = await supabase
        .from('students')
        .select('id, full_name, admission_no')
        .eq('status', 'ACTIVE')
        .order('full_name');
    if (studentError) throw studentError;

    const rows = (students ?? []) as {
        id: string;
        full_name: string;
        admission_no: string | null;
    }[];
    if (!rows.length) return [];

    const summaries = await Promise.all(
        rows.map(async student => {
            const charges = await listMyChildCharges(student.id);
            let charged = 0;
            let paid = 0;
            let outstanding = 0;
            for (const c of charges) {
                // A waived or cancelled charge is not owed, so counting it would
                // overstate what the family has to pay.
                if (c.status === 'CANCELLED' || c.status === 'WAIVED') continue;
                charged += c.amount - c.discount_amount;
                paid += c.paid_amount;
                outstanding += c.balance;
            }
            return {
                student_id: student.id,
                student_name: student.full_name,
                admission_no: student.admission_no,
                charged,
                paid,
                outstanding,
                charges,
            };
        })
    );

    return summaries;
}

/**
 * One child's charges, with balances.
 *
 * Fails closed: a child who is not the caller's returns an empty list rather
 * than an error, because the rows are simply not visible. An empty list is the
 * honest answer to "what does this child owe" when the caller has no business
 * asking.
 */
export async function listMyChildCharges(studentId: string): Promise<Charge[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('student_charges')
        .select(
            'id, student_id, fee_type_id, academic_year_id, period_month, period_year, ' +
            'amount, discount_amount, discount_reason, due_date, description, status, ' +
            'fee_types(name)'
        )
        .eq('student_id', studentId)
        .order('period_year', { ascending: false, nullsFirst: false })
        .order('period_month', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as unknown as (Charge & { fee_types: { name: string } | null })[];
    if (!rows.length) return [];

    // Balances come from the database's own function, one per charge, so a
    // parent's figure and the office's figure are the same by construction.
    const withBalances = await Promise.all(
        rows.map(async row => {
            const { data: paid } = await supabase.rpc('charge_paid_amount', {
                p_charge_id: row.id,
            });
            const paidAmount = Number(paid ?? 0);
            const owed = Number(row.amount) - Number(row.discount_amount);
            return {
                ...row,
                amount: Number(row.amount),
                discount_amount: Number(row.discount_amount),
                paid_amount: paidAmount,
                balance: owed - paidAmount,
            };
        })
    );

    return withBalances;
}

/**
 * The family's total across every child.
 *
 * Allowed for a guardian, but only for their own child: the database function
 * refuses outright for anyone else's, so passing a child id the caller is not
 * linked to is an error rather than a leak.
 */
export async function myFamilyBalance(studentId: string): Promise<FamilyBalance> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('family_balance', {
        p_student_id: studentId,
    });
    if (error) {
        // A guardian asking about a child who is not theirs is refused. That is
        // the correct answer, so it becomes an empty total rather than an error
        // the parent cannot act on.
        if (/permission/i.test(error.message)) {
            return { charged: 0, paid: 0, outstanding: 0, children: 0 };
        }
        throw error;
    }
    return data as FamilyBalance;
}

/** True when a charge has been settled, for a short "Selesai" marker. */
export function isSettled(status: ChargeStatus, balance: number): boolean {
    return status === 'PAID' || balance <= 0;
}

// Re-exported so a parent screen can format money without reaching into the
// office module, which would blur the line between the two views.
export { formatMoney, periodLabel, CHARGE_STATUS_LABELS };
