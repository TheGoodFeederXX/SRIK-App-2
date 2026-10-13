/**
 * School fees — SRIK.
 *
 * Reference: docs/srik/07_PHASE_5_FINANCE.md
 *
 * The database enforces five rules that matter here, because in this area a
 * mistake costs real money and real trust. They are restated because a screen
 * that forgets them will show a parent a number that is not true.
 *
 * 1. MONEY IS NOT A FLOAT. Every amount in this file is a `number` that came
 *    from a `numeric(12,2)` column, and is formatted for display only at the
 *    last moment. Nothing here adds ringgit with floating point arithmetic and
 *    then rounds; the arithmetic is done by the database, which is exact.
 *
 * 2. A BALANCE IS DERIVED. `charge_balance()` computes amount, less discount,
 *    less confirmed payments. It is never stored, so there is no second copy to
 *    fall out of step. This file reads it rather than recomputing it.
 *
 * 3. RECORDING A PAYMENT IS IDEMPOTENT. `record_payment` takes an idempotency
 *    key. `recordPayment` below GENERATES one per call, so a double press on the
 *    Save button produces one receipt, not two. A caller that retries the same
 *    logical payment must pass its own key instead.
 *
 * 4. THE BOOKS ARE APPEND-ONLY. There is deliberately no `updatePayment` or
 *    `deletePayment`. A mistake is reversed, which leaves both the mistake and
 *    the correction on file. The absence of those functions is the point.
 *
 * 5. WRITES GO THROUGH THE RPC. `payments` and `payment_allocations` grant
 *    `authenticated` read-only access on purpose, so a direct write cannot skip
 *    the overpayment check, the arithmetic check or the audit trail.
 */

import { requireSupabase } from './client';

export type FeeFrequency = 'ONE_TIME' | 'MONTHLY' | 'TERMLY' | 'YEARLY';
export type ChargeStatus = 'OUTSTANDING' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'ONLINE' | 'OTHER';
export type PaymentStatus = 'CONFIRMED' | 'REVERSED';

/** Malay labels, because the office reads these on screen and on a receipt. */
export const FREQUENCY_LABELS: Record<FeeFrequency, string> = {
    ONE_TIME: 'finance.freqOneTime',
    MONTHLY: 'finance.freqMonthly',
    TERMLY: 'finance.freqTermly',
    YEARLY: 'finance.freqYearly',
};

/**
 * Keys, not text. This map is DATA (it is indexed by a status code), so it must not hold a
 * translated string: a module-level constant is evaluated once at import, before any language is
 * chosen, and would freeze one language for the whole session. Callers pass the value to `t()` at
 * render time instead.
 */
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
    OUTSTANDING: 'finance.chargeStatusOutstanding',
    PARTIAL: 'finance.chargeStatusPartial',
    PAID: 'finance.chargeStatusPaid',
    WAIVED: 'finance.chargeStatusWaived',
    CANCELLED: 'finance.chargeStatusCancelled',
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
    CASH: 'finance.methodCash',
    BANK_TRANSFER: 'finance.methodBankTransfer',
    CHEQUE: 'finance.methodCheque',
    ONLINE: 'finance.methodOnline',
    OTHER: 'finance.methodOther',
};

export const MONTH_NAMES = [
    'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
    'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember',
];

export interface FeeType {
    id: string;
    code: string;
    name: string;
    default_amount: number | null;
    frequency: FeeFrequency;
    description: string | null;
    sort_order: number;
    status: 'ACTIVE' | 'INACTIVE';
}

export interface Charge {
    id: string;
    student_id: string;
    fee_type_id: string;
    academic_year_id: string;
    period_month: number | null;
    period_year: number | null;
    amount: number;
    discount_amount: number;
    discount_reason: string | null;
    due_date: string | null;
    description: string | null;
    status: ChargeStatus;
    /** Derived by the database, never stored. */
    paid_amount: number;
    balance: number;
}

export interface ChargeWithStudent extends Charge {
    student_name: string;
    admission_no: string | null;
    fee_type_name: string;
}

export interface Payment {
    id: string;
    reference: string;
    amount: number;
    paid_at: string;
    method: PaymentMethod;
    status: PaymentStatus;
    notes: string | null;
    payer_name: string | null;
    is_reversal: boolean;
    reversal_reason: string | null;
    /** What this payment settled, for the receipt. */
    allocations: PaymentAllocation[];
}

export interface PaymentAllocation {
    charge_id: string;
    amount: number;
    fee_type_name: string | null;
    student_name: string | null;
    period_month: number | null;
    period_year: number | null;
}

export interface FamilyBalance {
    charged: number;
    paid: number;
    outstanding: number;
    children: number;
}

export interface StudentBalance {
    student_id: string;
    student_name: string;
    admission_no: string | null;
    charged: number;
    paid: number;
    outstanding: number;
    /** Set when this child is fully settled, so the list can show it at a glance. */
    settled: boolean;
}

/** Ringgit, shown the way a Malaysian receipt shows it. */
export function formatMoney(amount: number | null | undefined): string {
    if (amount === null || amount === undefined) return '—';
    const negative = amount < 0;
    const fixed = Math.abs(amount).toFixed(2);
    // Thousands separators, because RM1,250.00 is read faster than RM1250.00.
    const [whole, sen] = fixed.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}RM${grouped}.${sen}`;
}

/** A short label for a charge's period, e.g. "Mac 2026". */
export function periodLabel(month: number | null, year: number | null): string {
    if (!month) return 'Sekali';
    const name = MONTH_NAMES[month - 1] ?? String(month);
    return year ? `${name} ${year}` : name;
}

/**
 * Turns a database error into something an office clerk can act on.
 *
 * The sentence shown says what to do. "Jumlah itu melebihi baki yang masih
 * tertunggak" is useful; "check_violation" is not.
 */
export function friendlyFinanceError(error: unknown): string {
    const raw = (error as { message?: string })?.message ?? '';

    if (/more than the .* still owed/i.test(raw)) {
        return 'Jumlah itu melebihi baki yang masih tertunggak. Sila semak jumlahnya.';
    }
    if (/must say which charges/i.test(raw)) {
        return 'Sila pilih sekurang-kurangnya satu caj untuk bayaran ini.';
    }
    if (/add up to/i.test(raw)) {
        return 'Jumlah yang diagihkan tidak sama dengan jumlah bayaran.';
    }
    if (/idempotency key/i.test(raw)) {
        return 'Bayaran ini tidak boleh disahkan. Sila cuba sekali lagi.';
    }
    if (/already been reversed/i.test(raw)) {
        return 'Bayaran ini sudah dibatalkan sebelum ini.';
    }
    if (/reversal must state a reason/i.test(raw)) {
        return 'Sila nyatakan sebab pembatalan.';
    }
    if (/waived|cancelled.*cannot be paid/i.test(raw)) {
        return 'Caj ini telah dikecualikan atau dibatalkan dan tidak boleh dibayar.';
    }
    if (/already has .* paid against it/i.test(raw)) {
        return 'Caj ini sudah ada bayaran. Sila batalkan bayaran itu dahulu.';
    }
    if (/permission/i.test(raw)) {
        return 'Anda tiada kebenaran untuk urusan kewangan.';
    }
    if (/greater than zero/i.test(raw)) {
        return 'Jumlah bayaran mesti lebih daripada sifar.';
    }
    return 'Maaf, urusan ini tidak berjaya. Sila cuba lagi.';
}

/**
 * A key that is unique per SUBMISSION, so a retry of that submission is safe.
 *
 * Call this ONCE when a submission starts — not once per attempt — and pass the
 * same value to every retry. Using it inside `recordPayment` would defeat the
 * purpose, which is exactly the defect it was introduced to fix (audit F22).
 */
export function newIdempotencyKey(): string {
    // randomUUID is available in every browser this app supports, and on any
    // secure origin. It is a key for de-duplication, not a security token.
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// --- Fee types --------------------------------------------------------------

export async function listFeeTypes(includeInactive = false): Promise<FeeType[]> {
    const supabase = requireSupabase();
    let query = supabase
        .from('fee_types')
        .select('id, code, name, default_amount, frequency, description, sort_order, status')
        .limit(2000)
        .order('sort_order')
        .order('name');
    if (!includeInactive) query = query.eq('status', 'ACTIVE');

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as FeeType[];
}

export async function saveFeeType(
    feeType: Partial<FeeType> & { name: string; code: string; frequency: FeeFrequency }
): Promise<FeeType> {
    const supabase = requireSupabase();
    const payload = {
        code: feeType.code.trim().toUpperCase(),
        name: feeType.name.trim(),
        // An empty box means "no price decided yet", which is different from a
        // price of zero. A zero here would bill every child nothing.
        default_amount: feeType.default_amount ?? null,
        frequency: feeType.frequency,
        description: feeType.description ?? null,
        sort_order: feeType.sort_order ?? 0,
        status: feeType.status ?? 'ACTIVE',
    };

    const { data, error } = feeType.id
        ? await supabase.from('fee_types').update(payload).eq('id', feeType.id).select().single()
        : await supabase.from('fee_types').insert(payload).select().single();
    if (error) throw error;
    return data as FeeType;
}

// --- Charges ----------------------------------------------------------------

/**
 * Charges for one child, each carrying its derived balance.
 *
 * The balance comes from `charge_balance` for every row. Doing it in one query
 * rather than per row matters: a child with a year of monthly fees has dozens
 * of charges, and one round trip each would make the screen crawl.
 */
export async function listStudentCharges(
    studentId: string,
    academicYearId?: string
): Promise<Charge[]> {
    const supabase = requireSupabase();
    let query = supabase
        .from('student_charges')
        .select(
            'id, student_id, fee_type_id, academic_year_id, period_month, period_year, ' +
            'amount, discount_amount, discount_reason, due_date, description, status, ' +
            'fee_types(name)'
        )
            .limit(2000)
        .eq('student_id', studentId)
        .order('period_year', { ascending: false, nullsFirst: false })
        .order('period_month', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
    if (academicYearId) query = query.eq('academic_year_id', academicYearId);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as (Charge & { fee_types: { name: string } | null })[];
    if (!rows.length) return [];

    // One call for the balances, keyed by charge id.
    const balances = await chargeBalances(rows.map(r => r.id));

    return rows.map(row => ({
        ...row,
        paid_amount: balances[row.id]?.paid ?? 0,
        balance: balances[row.id]?.balance ?? row.amount - row.discount_amount,
    }));
}

/**
 * Balances for many charges at once.
 *
 * Kept in the data layer so every screen agrees on what a balance is. The
 * numbers come from the database functions, never from subtraction done here.
 */
export async function chargeBalances(
    chargeIds: string[]
): Promise<Record<string, { paid: number; balance: number }>> {
    if (!chargeIds.length) return {};
    const supabase = requireSupabase();

    const { data, error } = await supabase
        .from('student_charges')
        .select('id, amount, discount_amount')
        .limit(2000)
        .in('id', chargeIds);
    if (error) throw error;

    const result: Record<string, { paid: number; balance: number }> = {};
    for (const row of (data ?? []) as { id: string; amount: number; discount_amount: number }[]) {
        result[row.id] = { paid: 0, balance: Number(row.amount) - Number(row.discount_amount) };
    }

    // ONE request for the paid figures, not one per charge.
    //
    // This used to be `chargeIds.map(... rpc('charge_paid_amount', ...))` wrapped in
    // `Promise.all`. It worked, and it was wrong at scale: a page showing a family's
    // charges for a few months is a few hundred separate HTTP requests, each
    // authenticated on its own, all outstanding at once, and the screen waits for the
    // slowest. The audit found it (F28).
    //
    // The database function authorizes EVERY charge it is asked about, using the same
    // gate as the single-charge call — so this is faster without being more
    // permissive. That distinction is the whole point; a bulk endpoint that checked
    // one id and returned many would be a worse bug than the one being fixed.
    const { data: paidRows, error: paidError } = await supabase.rpc('charge_paid_amounts', {
        p_charge_ids: chargeIds,
    });
    if (paidError) throw paidError;

    for (const row of (paidRows ?? []) as { charge_id: string; paid_amount: number }[]) {
        const entry = result[row.charge_id];
        if (entry) {
            entry.paid = Number(row.paid_amount ?? 0);
            entry.balance = entry.balance - entry.paid;
        }
    }
    return result;
}

/**
 * Creates this month's charges for every active child.
 *
 * Safe to run twice: the database refuses a second charge for the same child,
 * fee and period, so a second run reports zero created rather than billing
 * twice.
 */
export async function generateMonthlyCharges(
    academicYearId: string,
    periodYear: number,
    periodMonth: number,
    feeTypeIds?: string[] | null,
    dueDate?: string | null
): Promise<{ charges_created: number }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('generate_monthly_charges', {
        p_academic_year_id: academicYearId,
        p_period_year: periodYear,
        p_period_month: periodMonth,
        p_fee_type_ids: feeTypeIds?.length ? feeTypeIds : null,
        p_due_date: dueDate ?? null,
    });
    if (error) throw error;
    return data as { charges_created: number };
}

/** Adds a single charge by hand, for a one-off the monthly run does not cover. */
export async function createCharge(input: {
    student_id: string;
    fee_type_id: string;
    academic_year_id: string;
    amount: number;
    due_date?: string | null;
    description?: string | null;
}): Promise<Charge> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('student_charges')
        .insert({
            student_id: input.student_id,
            fee_type_id: input.fee_type_id,
            academic_year_id: input.academic_year_id,
            amount: input.amount,
            due_date: input.due_date ?? null,
            description: input.description ?? null,
        })
        .select()
            .limit(2000)
        .single();
    if (error) throw error;
    return data as Charge;
}

export async function setChargeDiscount(
    chargeId: string,
    discount: number,
    reason: string
): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc('set_charge_discount', {
        p_charge_id: chargeId,
        p_discount: discount,
        p_reason: reason,
    });
    if (error) throw error;
}

export async function setChargeStatus(
    chargeId: string,
    status: Extract<ChargeStatus, 'WAIVED' | 'CANCELLED'>,
    reason: string
): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc('set_charge_status', {
        p_charge_id: chargeId,
        p_status: status,
        p_reason: reason,
    });
    if (error) throw error;
}

// --- Payments ---------------------------------------------------------------

export interface AllocationInput {
    charge_id: string;
    amount: number;
}

/**
 * Records money received.
 *
 * The key is generated here so that pressing Save twice cannot take the money
 * twice: the second call sends the same key and the database returns the
 * original receipt. A caller that wants to retry the SAME payment across a
 * reload should pass its own `idempotencyKey`.
 */
export async function recordPayment(input: {
    amount: number;
    allocations: AllocationInput[];
    method?: PaymentMethod;
    reference?: string | null;
    paidAt?: string | null;
    payerGuardianId?: string | null;
    notes?: string | null;
    // Required, and deliberately not optional: a payment without a stable key
    // cannot be retried safely (audit F22).
    idempotencyKey: string;
}): Promise<{ payment_id: string; reference: string; amount: number; duplicate: boolean }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('record_payment', {
        p_amount: input.amount,
        p_allocations: input.allocations,
        // The key is REQUIRED, not generated here.
        //
        // Generating it in this wrapper is what made a retry dangerous: if the
        // server committed the payment but the response was lost, the caller's
        // retry arrived with a NEW key, which the server cannot tell apart from a
        // genuinely new payment — so the school collected twice (audit F22).
        //
        // The caller mints one key per SUBMISSION and reuses it for every attempt
        // at that submission. `record_payment` refuses a payment without a key, so
        // a caller that forgets this fails loudly instead of quietly risking a
        // duplicate.
        p_idempotency_key: input.idempotencyKey,
        p_reference: input.reference ?? null,
        p_method: input.method ?? 'CASH',
        p_paid_at: input.paidAt ?? null,
        p_payer_guardian_id: input.payerGuardianId ?? null,
        p_notes: input.notes ?? null,
    });
    if (error) throw error;
    return data as { payment_id: string; reference: string; amount: number; duplicate: boolean };
}

/**
 * Cancels a payment by writing an opposite entry.
 *
 * There is no delete. The original stays on file marked as reversed, with the
 * reason, so the school can explain what it did.
 */
export async function reversePayment(paymentId: string, reason: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc('reverse_payment', {
        p_payment_id: paymentId,
        p_reason: reason,
    });
    if (error) throw error;
}

/** Recent receipts, newest first, with what each one settled. */
export async function listPayments(options?: {
    fromDate?: string;
    toDate?: string;
    limit?: number;
}): Promise<Payment[]> {
    const supabase = requireSupabase();
    let query = supabase
        .from('payments')
        .select(
            'id, reference, amount, paid_at, method, status, notes, reverses_id, reversal_reason, ' +
            'guardians(full_name), ' +
            'payment_allocations(amount, student_charge_id, ' +
            'student_charges(period_month, period_year, fee_types(name), students(full_name)))'
        )
            .limit(2000)
        .order('paid_at', { ascending: false })
        .limit(options?.limit ?? 100);
    if (options?.fromDate) query = query.gte('paid_at', options.fromDate);
    if (options?.toDate) query = query.lte('paid_at', options.toDate);

    const { data, error } = await query;
    if (error) throw error;

    type RawAllocation = {
        amount: number;
        student_charge_id: string;
        student_charges: {
            period_month: number | null;
            period_year: number | null;
            fee_types: { name: string } | null;
            students: { full_name: string } | null;
        } | null;
    };
    type RawPayment = Omit<Payment, 'payer_name' | 'is_reversal' | 'allocations'> & {
        reverses_id: string | null;
        guardians: { full_name: string } | null;
        payment_allocations: RawAllocation[] | null;
    };

    return ((data ?? []) as unknown as RawPayment[]).map(row => ({
        id: row.id,
        reference: row.reference,
        amount: Number(row.amount),
        paid_at: row.paid_at,
        method: row.method,
        status: row.status,
        notes: row.notes,
        payer_name: row.guardians?.full_name ?? null,
        is_reversal: row.reverses_id !== null,
        reversal_reason: row.reversal_reason,
        allocations: (row.payment_allocations ?? []).map(a => ({
            charge_id: a.student_charge_id,
            amount: Number(a.amount),
            fee_type_name: a.student_charges?.fee_types?.name ?? null,
            student_name: a.student_charges?.students?.full_name ?? null,
            period_month: a.student_charges?.period_month ?? null,
            period_year: a.student_charges?.period_year ?? null,
        })),
    }));
}

// --- Outstanding, at a glance ------------------------------------------------

/**
 * Every child who still owes something, with their totals.
 *
 * This is the screen the office opens first, so it must be right. The figures
 * come from the charges and the database's paid function, not from a stored
 * total, and children who are fully settled are left out.
 */
export async function listOutstanding(academicYearId?: string): Promise<StudentBalance[]> {
    const supabase = requireSupabase();
    let query = supabase
        .from('student_charges')
        .select(
            'id, student_id, amount, discount_amount, status, students(full_name, admission_no)'
        )
            .limit(2000)
        .in('status', ['OUTSTANDING', 'PARTIAL']);
    if (academicYearId) query = query.eq('academic_year_id', academicYearId);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as {
        id: string;
        student_id: string;
        amount: number;
        discount_amount: number;
        students: { full_name: string; admission_no: string | null } | null;
    }[];
    if (!rows.length) return [];

    const balances = await chargeBalances(rows.map(r => r.id));

    const byStudent = new Map<string, StudentBalance>();
    for (const row of rows) {
        const balance = balances[row.id]?.balance ?? 0;
        const paid = balances[row.id]?.paid ?? 0;
        const owed = row.amount - row.discount_amount;

        const entry = byStudent.get(row.student_id) ?? {
            student_id: row.student_id,
            student_name: row.students?.full_name ?? 'Tanpa nama',
            admission_no: row.students?.admission_no ?? null,
            charged: 0,
            paid: 0,
            outstanding: 0,
            settled: false,
        };
        entry.charged += owed;
        entry.paid += paid;
        entry.outstanding += balance;
        byStudent.set(row.student_id, entry);
    }

    return [...byStudent.values()]
        .map(entry => ({ ...entry, settled: entry.outstanding <= 0 }))
        // Largest debt first: that is what the office chases.
        .sort((a, b) => b.outstanding - a.outstanding);
}

/** What one family owes across all their children. */
export async function familyBalance(studentId: string): Promise<FamilyBalance> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('family_balance', {
        p_student_id: studentId,
    });
    if (error) throw error;
    return data as FamilyBalance;
}

/** Active children, for the pickers. */
export async function listActiveStudents(): Promise<
    { id: string; full_name: string; admission_no: string | null }[]
> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('students')
        .select('id, full_name, admission_no')
        .limit(2000)
        .eq('status', 'ACTIVE')
        .order('full_name');
    if (error) throw error;
    return (data ?? []) as { id: string; full_name: string; admission_no: string | null }[];
}

/** The current academic year, used for generating fees. */
export async function getCurrentAcademicYear(): Promise<{ id: string; name: string } | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
        .from('academic_years')
        .select('id, name')
        .limit(2000)
        .eq('status', 'CURRENT')
        .maybeSingle();
    if (error) throw error;
    return data as { id: string; name: string } | null;
}
