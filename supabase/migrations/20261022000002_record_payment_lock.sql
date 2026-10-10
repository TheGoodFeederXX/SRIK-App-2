-- ---------------------------------------------------------------------------
-- F22 — a concurrent retry could over-allocate a charge.
--
-- This REPLACES record_payment, and the only change is the row lock marked below.
-- The rest of the function is the live definition, reproduced verbatim, because
-- the arithmetic and the checks were already correct — the concurrency was not.
--
-- The original read each charge's remaining balance and then inserted an
-- allocation, with nothing preventing a second submission doing the same between
-- those two steps. Two clerks collecting at once, or one clerk with two tabs,
-- could both read "RM100 remaining" and both allocate RM100.
--
-- The idempotency key does NOT cover this: it deduplicates the same SUBMISSION
-- retried, which is a different problem from two different submissions racing.
-- Both are handled, and they need separate mechanisms.
--
-- The locks are taken in a deterministic order — the allocations sorted by charge
-- id — because Postgres aborts with a deadlock error if two transactions acquire
-- the same locks in different orders. A deadlock during fee collection would be
-- considerably more alarming to the clerk than the over-allocation it prevents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment(p_amount numeric, p_allocations jsonb, p_idempotency_key text, p_reference text DEFAULT NULL::text, p_method payment_method DEFAULT 'CASH'::payment_method, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_payer_guardian_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- Take every lock this transaction will need UP FRONT, in a deterministic
    -- order (charge id ascending), before any balance is read.
    --
    -- Doing it here rather than per-iteration is what makes the order fixed: the
    -- loop below follows the caller's JSON order, which two callers can supply
    -- differently for the same pair of charges — the classic deadlock setup.
    perform 1
       from public.student_charges c
      where c.id in (
            select (a->>'charge_id')::uuid
              from jsonb_array_elements(p_allocations) a
          )
      order by c.id
        for update;

    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
        v_charge_id := (v_alloc->>'charge_id')::uuid;
        v_alloc_amt := (v_alloc->>'amount')::numeric(12,2);

        if v_alloc_amt is null or v_alloc_amt <= 0 then
            raise exception 'Each allocation must be greater than zero'
                using errcode = 'invalid_parameter_value';
        end if;

        -- Already locked by the sorted pre-pass above, so no lock is taken here;
        -- taking one would reintroduce the caller's ordering.
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
$function$;

-- ---------------------------------------------------------------------------
-- Verify the property on the function that was actually deployed.
--
-- This check lives HERE and not in the integrity migration, because it inspects
-- `record_payment` and the integrity migration runs BEFORE this file replaces it —
-- a check placed there would inspect the old definition and either pass or fail for
-- the wrong reason. It was written in the wrong file first and reported a defect
-- that this very migration had already fixed.
-- ---------------------------------------------------------------------------
do $$
declare
    v_body text := pg_get_functiondef(
        (select oid from pg_proc where proname = 'record_payment')
    );
begin
    if v_body not like '%order by c.id%' or v_body not like '%for update%' then
        raise exception
            'F22 guard: record_payment does not lock charges in a deterministic '
            'order, so concurrent collections can over-allocate'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
