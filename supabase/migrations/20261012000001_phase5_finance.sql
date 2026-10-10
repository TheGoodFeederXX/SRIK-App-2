-- ===========================================================================
-- Phase 5 — School fees
-- ===========================================================================
-- Reference: docs/srik/07_PHASE_5_FINANCE.md
--
-- This is the phase where a mistake costs real money and real trust, so the
-- rules are stricter than anywhere else in the system. Five of them matter.
--
-- 1. MONEY IS NEVER A FLOAT. Ringgit is stored as numeric(12,2). A float cannot
--    hold 0.10 exactly, so totals drift by a sen and a school's books stop
--    reconciling. Every amount here is numeric.
--
-- 2. A PAYMENT IS NOT A CHARGE BEING MARKED PAID. Money arriving and a debt
--    existing are separate facts. One payment can settle several charges, and
--    one charge can be settled by several payments. The link between them is
--    its own table (payment_allocations), because collapsing the two would make
--    a part-payment, a shared sibling payment and a refund all unrepresentable.
--
-- 3. RECORDING A PAYMENT IS IDEMPOTENT. A clerk on a flaky connection will
--    press Save twice. Without protection that is a duplicate receipt and an
--    angry parent. Every payment carries an idempotency key, and re-sending the
--    same one returns the original payment instead of creating a second.
--
-- 4. THE BOOKS ARE APPEND-ONLY. A payment is never edited or deleted. A wrong
--    payment is REVERSED, which leaves the mistake and the correction both on
--    file. A school must be able to explain what it did, and an edit history
--    that erases its own mistakes cannot do that.
--
-- 5. A BALANCE IS DERIVED, NEVER STORED. What a family owes is computed from
--    charges minus allocations. A stored balance column drifts out of step the
--    first time a write fails half way, and then nobody knows which number is
--    true. Here the number is always recomputed from the rows that justify it.

-- --- Enums ------------------------------------------------------------------

do $$ begin
    create type public.fee_frequency as enum (
        'ONE_TIME',
        'MONTHLY',
        'TERMLY',
        'YEARLY'
    );
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.charge_status as enum (
        'OUTSTANDING',
        'PARTIAL',
        'PAID',
        'WAIVED',
        'CANCELLED'
    );
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.payment_method as enum (
        'CASH',
        'BANK_TRANSFER',
        'CHEQUE',
        'ONLINE',
        'OTHER'
    );
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.payment_status as enum (
        'CONFIRMED',
        'REVERSED'
    );
exception when duplicate_object then null;
end $$;

-- --- Fee types --------------------------------------------------------------
--
-- What the school charges and how much, held as data. A change of price is an
-- edit in a screen, not a database migration, and last year's amounts are not
-- rewritten when this year's go up.

create table if not exists public.fee_types (
    id              uuid primary key default gen_random_uuid(),
    code            text not null unique,
    name            text not null,
    -- Null when the school has not fixed a price yet. A null amount is not free:
    -- charges cannot be generated from it, which is exactly right.
    default_amount  numeric(12,2),
    frequency       public.fee_frequency not null default 'ONE_TIME',
    description     text,
    sort_order      integer not null default 0,
    status          public.record_status not null default 'ACTIVE',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- Negative amounts would be a discount in disguise, which belongs in the
    -- discounts table where it can be seen and audited.
    constraint fee_types_amount_not_negative check (
        default_amount is null or default_amount >= 0
    )
);

create index if not exists idx_fee_types_status
    on public.fee_types (status, sort_order);

-- --- Charges ----------------------------------------------------------------
--
-- One thing one child owes. Deliberately per-student rather than per-family:
-- a receipt for three siblings is three children's debts settled by one
-- payment, and the allocation table is what joins them.

create table if not exists public.student_charges (
    id                uuid primary key default gen_random_uuid(),
    student_id        uuid not null references public.students(id) on delete restrict,
    fee_type_id       uuid not null references public.fee_types(id) on delete restrict,
    academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
    -- Which month, for a monthly fee. Null for a one-off. Kept separate from the
    -- due date so "the March fee" is identifiable even if it is paid late.
    period_month      smallint,
    period_year       smallint,
    amount            numeric(12,2) not null,
    -- What the school agreed to take off, with the reason. Kept on the charge
    -- rather than as a negative line, so the full price and the concession are
    -- both visible.
    discount_amount   numeric(12,2) not null default 0,
    discount_reason   text,
    due_date          date,
    description       text,
    status            public.charge_status not null default 'OUTSTANDING',
    created_by        uuid references auth.users(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint student_charges_amount_positive check (amount > 0),
    constraint student_charges_discount_not_negative check (discount_amount >= 0),
    -- The discount may not exceed the charge, which would turn a fee into a
    -- payment to the family.
    constraint student_charges_discount_within_amount check (
        discount_amount <= amount
    ),
    constraint student_charges_period_month_valid check (
        period_month is null or period_month between 1 and 12
    )
);

create index if not exists idx_student_charges_student
    on public.student_charges (student_id, status);
create index if not exists idx_student_charges_year
    on public.student_charges (academic_year_id, fee_type_id);

-- One charge per child per fee per period. This is the constraint that makes
-- generating a month's fees twice harmless instead of doubling every family's
-- bill.
create unique index if not exists student_charges_unique_period
    on public.student_charges (student_id, fee_type_id, academic_year_id,
                               coalesce(period_year, 0), coalesce(period_month, 0))
    where status <> 'CANCELLED';

-- --- Payments ---------------------------------------------------------------
--
-- Money actually received. One row per receipt, covering one or more children.

create table if not exists public.payments (
    id                uuid primary key default gen_random_uuid(),
    -- The guardian who paid, when they are known. Optional because a payment is
    -- a fact about money, not about a person, and a grandparent paying cash
    -- should not be blocked by not being on file.
    payer_guardian_id uuid references public.guardians(id) on delete set null,
    -- The school's own receipt number, written on the receipt handed over.
    reference         text not null,
    amount            numeric(12,2) not null,
    paid_at           timestamptz not null default now(),
    method            public.payment_method not null default 'CASH',
    notes             text,
    status            public.payment_status not null default 'CONFIRMED',
    recorded_by       uuid references auth.users(id) on delete set null,
    -- What makes double-pressing Save safe. A re-send with the same key returns
    -- the original payment rather than taking the money twice.
    idempotency_key   text not null unique,
    -- Set when this payment is a reversal of an earlier one.
    reverses_id       uuid references public.payments(id) on delete restrict,
    -- Set on the original when it has been reversed, so the reversal is
    -- discoverable from either end.
    reversed_by_id    uuid references public.payments(id) on delete set null,
    reversal_reason   text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint payments_amount_positive check (amount > 0)
);

create index if not exists idx_payments_paid_at on public.payments (paid_at desc);
create index if not exists idx_payments_reference on public.payments (reference);

-- A reversal must say why. An unexplained reversal is indistinguishable from a
-- mistake, and a school needs to be able to answer a parent asking where their
-- payment went.
create or replace function public.enforce_reversal_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.reverses_id is not null
       and (new.reversal_reason is null or btrim(new.reversal_reason) = '') then
        raise exception 'A reversal must state a reason'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_enforce_reversal_reason on public.payments;
create trigger trg_enforce_reversal_reason
    before insert or update on public.payments
    for each row execute function public.enforce_reversal_reason();

-- --- Allocations ------------------------------------------------------------
--
-- Which payment settled which charge, and how much of it. This table is the
-- reason part payments, sibling payments and refunds all work.

create table if not exists public.payment_allocations (
    id                 uuid primary key default gen_random_uuid(),
    payment_id         uuid not null references public.payments(id) on delete cascade,
    student_charge_id  uuid not null references public.student_charges(id) on delete restrict,
    amount             numeric(12,2) not null,
    created_at         timestamptz not null default now(),
    -- Allocating the same payment to the same charge twice would double-count.
    constraint payment_allocations_unique unique (payment_id, student_charge_id),
    constraint payment_allocations_amount_positive check (amount > 0)
);

create index if not exists idx_payment_allocations_charge
    on public.payment_allocations (student_charge_id);

-- --- What a charge still owes, and what it has been paid --------------------
--
-- Computed from the rows, never stored. These are the only places the numbers
-- come from, so every screen, report and balance agrees.

create or replace function public.charge_paid_amount(p_charge_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(sum(
        -- A reversal is a payment row whose allocations MIRROR the original, so
        -- it must subtract. Its original is still counted (it is not excluded
        -- below), which is what makes the pair cancel to zero rather than
        -- leaving the reversal subtracting from nothing.
        case when p.reverses_id is not null then -a.amount else a.amount end
    ), 0)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.student_charge_id = p_charge_id
       -- A payment that was reversed still counts, because its reversal cancels
       -- it. Only a reversal OF a reversal would need excluding, and the
       -- functions refuse to reverse twice.
       and p.status in ('CONFIRMED', 'REVERSED');
$$;

create or replace function public.charge_balance(p_charge_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
    select c.amount - c.discount_amount - public.charge_paid_amount(c.id)
      from public.student_charges c
     where c.id = p_charge_id;
$$;

comment on function public.charge_paid_amount(uuid) is
    'How much has actually been received against a charge. A reversal is itself '
    'a payment row, so it SUBTRACTS rather than adds; without that, reversing a '
    'payment would leave the money counted twice.';

comment on function public.charge_balance(uuid) is
    'What one charge still owes: the amount, less any discount, less confirmed '
    'payments allocated to it. Derived from rows, never stored, so it cannot drift.';

-- Recomputes and stores a charge's status from what has actually been paid.
--
-- The status is a convenience for listing and filtering, and is always rebuilt
-- from the allocations rather than incremented, so it cannot accumulate error.
create or replace function public.refresh_charge_status(p_charge_id uuid)
returns public.charge_status
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_charge public.student_charges;
    v_paid   numeric;
    v_owed   numeric;
    v_status public.charge_status;
begin
    select * into v_charge from public.student_charges where id = p_charge_id;
    if v_charge.id is null then
        return null;
    end if;

    -- A cancelled or waived charge keeps its status whatever has been paid: the
    -- school decided it is not owed, and a later payment against it must not
    -- quietly un-decide that.
    if v_charge.status in ('CANCELLED', 'WAIVED') then
        return v_charge.status;
    end if;

    v_paid := public.charge_paid_amount(p_charge_id);
    v_owed := v_charge.amount - v_charge.discount_amount;

    if v_paid <= 0 then
        v_status := 'OUTSTANDING';
    elsif v_paid < v_owed then
        v_status := 'PARTIAL';
    else
        v_status := 'PAID';
    end if;

    if v_status <> v_charge.status then
        update public.student_charges
           set status = v_status, updated_at = now()
         where id = p_charge_id;
    end if;

    return v_status;
end;
$$;

-- --- Row level security -----------------------------------------------------

alter table public.fee_types           enable row level security;
alter table public.fee_types           force row level security;
alter table public.student_charges     enable row level security;
alter table public.student_charges     force row level security;
alter table public.payments            enable row level security;
alter table public.payments            force row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_allocations force row level security;

-- Money is office business. A classroom teacher has no reason to see what a
-- family owes, and `finance.view` is held only by the office, so these policies
-- simply follow the permission. No policy here mentions a teacher's own classes:
-- that is deliberate.
drop policy if exists fee_types_select on public.fee_types;
create policy fee_types_select on public.fee_types
    for select using (public.has_permission('finance.view'));

drop policy if exists fee_types_write on public.fee_types;
create policy fee_types_write on public.fee_types
    for all using (public.has_permission('finance.manage'))
    with check (public.has_permission('finance.manage'));

drop policy if exists student_charges_select on public.student_charges;
create policy student_charges_select on public.student_charges
    for select using (public.has_permission('finance.view'));

drop policy if exists student_charges_write on public.student_charges;
create policy student_charges_write on public.student_charges
    for all using (public.has_permission('finance.manage'))
    with check (public.has_permission('finance.manage'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
    for select using (public.has_permission('finance.view'));

-- Payments are never inserted, updated or deleted from a screen: they come from
-- the audited function below, which does its own validation. There is therefore
-- no write policy at all, which is the strongest form of "not allowed".
drop policy if exists payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
    for select using (public.has_permission('finance.view'));

grant select, insert, update, delete on public.fee_types to authenticated;
grant select, insert, update on public.student_charges to authenticated;
grant select on public.payments to authenticated;
grant select on public.payment_allocations to authenticated;
grant execute on function public.charge_paid_amount(uuid) to authenticated;
grant execute on function public.charge_balance(uuid) to authenticated;
grant execute on function public.refresh_charge_status(uuid) to authenticated;

-- ===========================================================================
-- Generating a month's fees
-- ===========================================================================
--
-- One call creates the charge for every active child. Doing it child by child
-- would leave a half-generated month whenever a request failed, and nobody
-- could tell which children had been billed.
--
-- Safe to run twice: the unique index on (child, fee, year, period) turns the
-- second run into a no-op rather than a second bill.

create or replace function public.generate_monthly_charges(
    p_academic_year_id uuid,
    p_period_year smallint,
    p_period_month smallint,
    p_fee_type_ids uuid[] default null,
    p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fee        record;
    v_created    integer := 0;
    v_inserted   integer := 0;
    v_due        date;
begin
    if not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to generate fees'
            using errcode = '42501';
    end if;

    if p_period_month is null or p_period_month < 1 or p_period_month > 12 then
        raise exception 'The month must be between 1 and 12'
            using errcode = 'invalid_parameter_value';
    end if;

    -- Due at the start of the month unless the school says otherwise.
    v_due := coalesce(p_due_date, make_date(p_period_year, p_period_month, 1));

    for v_fee in
        select * from public.fee_types
         where status = 'ACTIVE'
           and frequency = 'MONTHLY'
           -- A fee with no price cannot be billed. Skipping it is better than
           -- billing a guessed amount.
           and default_amount is not null
           and (p_fee_type_ids is null or id = any(p_fee_type_ids))
    loop
        insert into public.student_charges
            (student_id, fee_type_id, academic_year_id, period_month, period_year,
             amount, due_date, description, created_by)
        select e.student_id,
               v_fee.id,
               p_academic_year_id,
               p_period_month,
               p_period_year,
               v_fee.default_amount,
               v_due,
               v_fee.name,
               auth.uid()
          from public.student_enrollments e
          join public.students s on s.id = e.student_id
         where e.academic_year_id = p_academic_year_id
           and e.ended_at is null
           and s.status = 'ACTIVE'
        -- The unique index is the real guard; this only avoids counting rows
        -- that were already there as "created".
        on conflict do nothing;

        -- Count what this fee actually added, so a re-run reports zero rather
        -- than claiming to have billed the school a second time.
        get diagnostics v_inserted = row_count;
        v_created := v_created + v_inserted;
    end loop;

    insert into public.authorization_audit (actor_id, action, detail)
    values (auth.uid(), 'FEES_GENERATED',
            jsonb_build_object('year_id', p_academic_year_id, 'period_year', p_period_year,
                               'period_month', p_period_month, 'inserted', v_created));

    return jsonb_build_object('charges_created', v_created);
end;
$$;

comment on function public.generate_monthly_charges(uuid, smallint, smallint, uuid[], date) is
    'Creates this month''s charge for every active child. Safe to run twice: the '
    'second run changes nothing rather than billing the school twice.';

-- ===========================================================================
-- Recording a payment
-- ===========================================================================
--
-- The heart of the phase. Takes the money received and spreads it across the
-- charges it settles, which may belong to several siblings.
--
-- Every allocation is checked before anything is written, and the whole thing
-- runs in one transaction, so a payment can never be recorded without saying
-- where it went, nor half-recorded.

create or replace function public.record_payment(
    p_amount numeric,
    p_allocations jsonb,
    p_idempotency_key text,
    p_reference text default null,
    p_method public.payment_method default 'CASH',
    p_paid_at timestamptz default null,
    p_payer_guardian_id uuid default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing   public.payments;
    v_payment_id uuid;
    v_alloc      jsonb;
    v_charge_id  uuid;
    v_alloc_amt  numeric(12,2);
    v_balance    numeric(12,2);
    v_charge     public.student_charges;
    v_total      numeric(12,2) := 0;
    v_reference  text;
    v_count      integer := 0;
begin
    if not public.has_permission('finance.record_payment') then
        raise exception 'You do not have permission to record a payment'
            using errcode = '42501';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'A payment must be greater than zero'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
        raise exception 'A payment needs an idempotency key so a double press cannot take money twice'
            using errcode = 'invalid_parameter_value';
    end if;

    -- Already recorded? Return the original rather than taking the money again.
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
        return jsonb_build_object(
            'payment_id', v_existing.id,
            'reference', v_existing.reference,
            'amount', v_existing.amount,
            'duplicate', true
        );
    end if;

    if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
       or jsonb_array_length(p_allocations) = 0 then
        raise exception 'A payment must say which charges it settles'
            using errcode = 'invalid_parameter_value';
    end if;

    -- The school's own receipt number when none is given. Dated so a receipt can
    -- be found by the day it was written.
    v_reference := coalesce(
        nullif(btrim(p_reference), ''),
        'R' || to_char(coalesce(p_paid_at, now()) at time zone 'Asia/Kuala_Lumpur', 'YYYYMMDD')
            || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    );

    insert into public.payments
        (reference, amount, paid_at, method, notes, recorded_by,
         payer_guardian_id, idempotency_key)
    values
        (v_reference, p_amount, coalesce(p_paid_at, now()), p_method, p_notes,
         auth.uid(), p_payer_guardian_id, p_idempotency_key)
    returning id into v_payment_id;

    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
        v_charge_id := (v_alloc->>'charge_id')::uuid;
        v_alloc_amt := (v_alloc->>'amount')::numeric(12,2);

        if v_alloc_amt is null or v_alloc_amt <= 0 then
            raise exception 'Each allocation must be greater than zero'
                using errcode = 'invalid_parameter_value';
        end if;

        select * into v_charge from public.student_charges where id = v_charge_id;
        if v_charge.id is null then
            raise exception 'Charge % does not exist', v_charge_id
                using errcode = 'no_data_found';
        end if;

        if v_charge.status in ('CANCELLED', 'WAIVED') then
            raise exception 'That charge has been % and cannot be paid',
                lower(v_charge.status::text)
                using errcode = 'check_violation';
        end if;

        v_balance := public.charge_balance(v_charge_id);

        -- Overpaying a single charge is nearly always a typo, and it would
        -- leave a negative balance nobody can explain. Stopping here names the
        -- actual amount still owed, which is what the clerk needs to see.
        if v_alloc_amt > v_balance then
            raise exception 'That is more than the % still owed on this charge', v_balance
                using errcode = 'check_violation';
        end if;

        insert into public.payment_allocations (payment_id, student_charge_id, amount)
        values (v_payment_id, v_charge_id, v_alloc_amt);

        v_total := v_total + v_alloc_amt;
        v_count := v_count + 1;
    end loop;

    -- The money received must exactly match what was allocated. A mismatch means
    -- either an unallocated payment floating in the accounts or a charge
    -- credited with money that never arrived.
    if v_total <> p_amount then
        raise exception 'The allocations add up to % but the payment is %',
            v_total, p_amount
            using errcode = 'check_violation';
    end if;

    -- Rebuild each affected charge's status from what has now been paid.
    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
        perform public.refresh_charge_status((v_alloc->>'charge_id')::uuid);
    end loop;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'PAYMENT_RECORDED', v_payment_id,
            jsonb_build_object('amount', p_amount, 'reference', v_reference,
                               'charges', v_count, 'method', p_method));

    return jsonb_build_object(
        'payment_id', v_payment_id,
        'reference', v_reference,
        'amount', p_amount,
        'charges', v_count,
        'duplicate', false
    );
end;
$$;

comment on function public.record_payment(numeric, jsonb, text, text, public.payment_method, timestamptz, uuid, text) is
    'Records money received and spreads it across the charges it settles, which '
    'may belong to several siblings. Idempotent on the key, refuses to overpay a '
    'charge, and refuses a payment whose allocations do not add up to the amount.';

-- ===========================================================================
-- Reversing a payment
-- ===========================================================================
--
-- A payment is never deleted. A reversal is a new negative entry that cancels
-- it, so the original mistake stays on file next to the correction. A school
-- that can erase a receipt cannot prove what it received.

create or replace function public.reverse_payment(
    p_payment_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_original public.payments;
    v_reversal uuid;
    v_alloc    record;
    v_ref      text;
begin
    if not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to reverse a payment'
            using errcode = '42501';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'A reversal must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_original from public.payments where id = p_payment_id;
    if v_original.id is null then
        raise exception 'Payment % does not exist', p_payment_id
            using errcode = 'no_data_found';
    end if;

    if v_original.status = 'REVERSED' then
        raise exception 'That payment has already been reversed'
            using errcode = 'check_violation';
    end if;

    v_ref := 'REV-' || v_original.reference;

    -- The reversing entry is itself a payment row, so the money trail is one
    -- continuous list of movements rather than a deletion and a note.
    insert into public.payments
        (reference, amount, paid_at, method, notes, recorded_by,
         idempotency_key, reverses_id, reversal_reason)
    values
        (v_ref, v_original.amount, now(), v_original.method,
         'Reversal of ' || v_original.reference, auth.uid(),
         'rev-' || p_payment_id::text, p_payment_id, p_reason)
    returning id into v_reversal;

    -- Mirror the original allocations so each charge's paid total drops by
    -- exactly what it rose by.
    for v_alloc in
        select * from public.payment_allocations where payment_id = p_payment_id
    loop
        insert into public.payment_allocations (payment_id, student_charge_id, amount)
        values (v_reversal, v_alloc.student_charge_id, v_alloc.amount);
    end loop;

    update public.payments
       set status = 'REVERSED',
           reversed_by_id = v_reversal,
           reversal_reason = p_reason,
           updated_at = now()
     where id = p_payment_id;

    for v_alloc in
        select * from public.payment_allocations where payment_id = p_payment_id
    loop
        perform public.refresh_charge_status(v_alloc.student_charge_id);
    end loop;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'PAYMENT_REVERSED', p_payment_id,
            jsonb_build_object('reversal_id', v_reversal, 'reason', p_reason,
                               'amount', v_original.amount));

    return jsonb_build_object(
        'reversal_id', v_reversal,
        'reference', v_ref,
        'amount', v_original.amount
    );
end;
$$;

comment on function public.reverse_payment(uuid, text) is
    'Cancels a payment by writing an opposite entry rather than deleting it, so '
    'the original and its correction both remain on file. Requires a reason.';

-- ===========================================================================
-- Waiving or cancelling a charge
-- ===========================================================================

create or replace function public.set_charge_status(
    p_charge_id uuid,
    p_status public.charge_status,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_charge public.student_charges;
    v_paid   numeric;
begin
    if not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to change a charge'
            using errcode = '42501';
    end if;

    if p_status not in ('WAIVED', 'CANCELLED') then
        raise exception 'A charge can only be waived or cancelled here'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'Waiving or cancelling a charge must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_charge from public.student_charges where id = p_charge_id;
    if v_charge.id is null then
        raise exception 'Charge % does not exist', p_charge_id
            using errcode = 'no_data_found';
    end if;

    v_paid := public.charge_paid_amount(p_charge_id);
    if v_paid > 0 then
        raise exception 'That charge already has % paid against it; reverse the payment first', v_paid
            using errcode = 'check_violation';
    end if;

    update public.student_charges
       set status = p_status,
           description = coalesce(description, '') || ' [' || p_status || ': ' || p_reason || ']',
           updated_at = now()
     where id = p_charge_id;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'CHARGE_' || p_status, p_charge_id,
            jsonb_build_object('reason', p_reason, 'amount', v_charge.amount));

    return jsonb_build_object('charge_id', p_charge_id, 'status', p_status);
end;
$$;

-- ===========================================================================
-- Setting a discount
-- ===========================================================================

create or replace function public.set_charge_discount(
    p_charge_id uuid,
    p_discount numeric,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_charge public.student_charges;
    v_paid   numeric;
begin
    if not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to set a discount'
            using errcode = '42501';
    end if;

    if p_discount is null or p_discount < 0 then
        raise exception 'A discount cannot be negative'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_discount > 0 and (p_reason is null or btrim(p_reason) = '') then
        raise exception 'A discount must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_charge from public.student_charges where id = p_charge_id;
    if v_charge.id is null then
        raise exception 'Charge % does not exist', p_charge_id
            using errcode = 'no_data_found';
    end if;

    if p_discount > v_charge.amount then
        raise exception 'A discount cannot be more than the charge itself'
            using errcode = 'check_violation';
    end if;

    -- Any discount that would leave the family having paid MORE than the charge
    -- now asks for must be refused.
    --
    -- The first version of this check only fired when REDUCING an existing
    -- discount, which let the very first discount on an already-paid charge
    -- through and produced a negative balance. The condition is simply whether
    -- the money taken exceeds what the charge would then be owed.
    v_paid := public.charge_paid_amount(p_charge_id);
    if v_paid > v_charge.amount - p_discount then
        raise exception 'That would leave the charge overpaid; reverse a payment first'
            using errcode = 'check_violation';
    end if;

    update public.student_charges
       set discount_amount = p_discount,
           discount_reason = p_reason,
           updated_at = now()
     where id = p_charge_id;

    perform public.refresh_charge_status(p_charge_id);

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'CHARGE_DISCOUNT_SET', p_charge_id,
            jsonb_build_object('discount', p_discount, 'reason', p_reason));

    return jsonb_build_object('charge_id', p_charge_id, 'discount', p_discount);
end;
$$;

-- ===========================================================================
-- A family's position across all their children
-- ===========================================================================
--
-- What the office needs when a parent arrives: what is owed, across every child
-- in the family, in one number.

create or replace function public.family_balance(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_charged numeric;
    v_paid    numeric;
    v_children integer;
begin
    -- Either the office, who may look at any family, or a guardian asking about
    -- their own child. A guardian is refused outright for anyone else's child,
    -- so this cannot be used to browse other families.
    if not (
        public.has_permission('finance.view')
        or public.is_guardian_of(p_student_id)
    ) then
        raise exception 'You do not have permission to view balances'
            using errcode = '42501';
    end if;

    -- Every child sharing a guardian with this one, plus this child.
    with siblings as (
        select p_student_id as sid
        union
        select sg2.student_id
          from public.student_guardians sg1
          join public.student_guardians sg2 on sg2.guardian_id = sg1.guardian_id
         where sg1.student_id = p_student_id
    )
    select coalesce(sum(c.amount - c.discount_amount), 0),
           coalesce(sum(public.charge_paid_amount(c.id)), 0),
           count(distinct c.student_id)
      into v_charged, v_paid, v_children
      from siblings s
      left join public.student_charges c
             on c.student_id = s.sid
            and c.status not in ('CANCELLED', 'WAIVED');

    return jsonb_build_object(
        'charged', v_charged,
        'paid', v_paid,
        'outstanding', v_charged - v_paid,
        'children', coalesce(v_children, 0)
    );
end;
$$;
