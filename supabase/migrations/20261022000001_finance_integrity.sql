-- ===========================================================================--
-- Finance integrity: family scope, reversals, charge immutability, publication
-- and idempotency.
--
-- Findings F18, F19, F20, F21 and F22 of the 2026-10-10 audit. They are one
-- migration because they are one subject: money records must not be able to
-- disagree with themselves.
--
-- ===========================================================================--
-- F19 — reversing a reversal invented money. PROVEN, not reasoned.
--
-- `reverse_payment` refused only `status = 'REVERSED'`. A reversal row is itself a
-- payment with `reverses_id` set and status CONFIRMED, so it passed that check and
-- a reversal of a reversal was accepted.
--
-- MEASURED against production through the real RPCs, on a RM100 charge:
--
--     pay RM100          -> paid 100.00,  balance   0.00
--     reverse it         -> paid   0.00,  balance 100.00
--     reverse THAT       -> paid -100.00, balance 200.00   <-- invented money
--
-- The reference produced was `REV-REV-PAY-F19`. The cause is a formula and a guard
-- that disagree: `charge_paid_amount` SUBTRACTS every allocation belonging to a
-- payment that has `reverses_id` — which is right for a genuine reversal and wrong
-- for a reversal of a reversal, because nothing cancels the first subtraction.
--
-- A correct signed ledger would need reversals to be balanced events rather than a
-- subtraction. That is a redesign, and the product has no requirement for undoing
-- a reversal. So the invariant is: **a payment may be reversed once, and a
-- reversal may not itself be reversed.** Correcting a mistaken reversal is done by
-- recording a new payment, which is honest about what happened.
--
-- ===========================================================================--
-- F20 — a charge could be edited after it was paid.
--
-- `student_charges` had no trigger but the audit one, and `authenticated` holds
-- UPDATE on the table. Amount, student, fee type and academic year could all be
-- changed underneath payments that were allocated against them, so the allocation
-- would then be paying something that no longer existed as it was paid. A balance
-- that changes because somebody edited history is not a balance.
--
-- The rule: once a charge has any allocation, the fields that define WHAT is owed
-- are frozen. Status and discount still move, because those are legitimate
-- corrections and they are already audited — and because freezing status would
-- make `refresh_charge_status` unable to do its job.
--
-- ===========================================================================--
-- F21 — an assessment could be published without its marks.
--
-- `assessments_write` is `for all using (has_permission('assessments.create'))`.
-- That one policy covers draft edits, mark entry AND publication, so a teacher
-- holding `assessments.create` could set `status = 'PUBLISHED'` directly and skip
-- `publish_assessment` entirely: the completeness check, the publish permission
-- and the publisher metadata all bypassed. A published report card is an immutable
-- snapshot that parents rely on; allowing it to be created without its marks is
-- the kind of defect that is discovered by a parent, not by a test.
--
-- Publication is now a transition the database owns, not a column a client writes.
--
-- ===========================================================================--
-- F18 — a family balance could include a child who is not the caller's.
--
-- The live function is `finance.view`-only, so the guardian branch the audit
-- describes is NOT reachable in production — the audit says this explicitly and it
-- is worth repeating, because the finding reads as a live leak and is not one. It
-- is a hazard for the next migration that adds a guardian path, and the family
-- traversal is wrong in a way that only becomes visible then: it treats
-- "shares a guardian" as transitive authorization.
--
-- MEASURED as the audit describes, using guardian C who cares for two children:
-- guardian A's own child has RM100 outstanding, but the family balance reports
-- RM877, because RM777 of an unrelated child's charges are folded in through the
-- shared guardian. The initial check validated the INPUT student and never the
-- children it aggregated.
--
-- The fix adds the guardian path — correctly scoped this time — so that a parent
-- can finally see their own family's balance, and it intersects the sibling set
-- with the children the caller is actually a guardian of. `family` is a fact about
-- the children; it is not by itself a grant of access.
--
-- ===========================================================================--
-- F22 — a retried payment could become a second payment.
--
-- `recordPayment` generated a fresh idempotency key whenever the caller did not
-- supply one, and the collection screen did not keep one for a submission. If the
-- server committed and the response was lost, the clerk's retry carried a new key,
-- which is indistinguishable from a genuinely new payment. The screen also had two
-- ways to submit (a double click, or two tabs), and neither was deduplicated.
--
-- The fix makes the key the CLIENT's responsibility and requires it, so a retry
-- reuses the key it already has. The RPC's own handling is hardened too: it now
-- locks the charge rows it is allocating against, so two concurrent submissions
-- cannot both read the same remaining balance and both succeed.
-- ===========================================================================--

-- ---------------------------------------------------------------------------
-- F19: reversal state, defined once.
--
-- `is_reversal(payment)` and `is_reversed(payment)` are the two questions the
-- guards and the formula both ask. Written as functions because the answer has to
-- be the same in all three places, and the original defect was precisely a
-- formula and a guard disagreeing about what a reversal is.
-- ---------------------------------------------------------------------------
create or replace function public.is_reversal(p_payment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.payments p
         where p.id = p_payment_id
           and p.reverses_id is not null
    );
$$;

comment on function public.is_reversal(uuid) is
    'True when this payment is itself a reversal of another. The single definition '
    'shared by reverse_payment and charge_paid_amount, so the guard and the formula '
    'cannot disagree (audit F19).';

create or replace function public.is_reversed(p_payment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.payments p
         where p.id = p_payment_id
           and p.status = 'REVERSED'
    );
$$;

comment on function public.is_reversed(uuid) is
    'True when this payment has already been reversed (audit F19).';

revoke execute on function public.is_reversal(uuid) from public, anon;
revoke execute on function public.is_reversed(uuid) from public, anon;
grant execute on function public.is_reversal(uuid) to authenticated;
grant execute on function public.is_reversed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- F19: the guard. A reversal cannot be reversed, and a payment cannot be reversed
-- twice.
--
-- The two refusals are different mistakes and get different messages, because the
-- clerk needs to know which one they made.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor    uuid := auth.uid();
    v_original public.payments;
    v_reversal public.payments;
    v_alloc    record;
begin
    if not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to reverse a payment'
            using errcode = 'insufficient_privilege';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'A reversal must state a reason'
            using errcode = 'check_violation';
    end if;

    -- Lock the original so two simultaneous reversals cannot both pass the checks
    -- below and produce two reversal rows for one payment.
    select * into v_original
      from public.payments
     where id = p_payment_id
       for update;

    if not found then
        raise exception 'Payment % does not exist', p_payment_id
            using errcode = 'no_data_found';
    end if;

    -- REFUSAL 1 — this payment is itself a reversal.
    --
    -- The old guard only checked `status = 'REVERSED'`, and a reversal row has
    -- status CONFIRMED, so it passed. Reversing it subtracted the same allocation
    -- a second time and produced `paid = -100` on a settled charge (audit F19).
    if public.is_reversal(p_payment_id) then
        raise exception
            'This is a reversal. A reversal cannot itself be reversed; record a new '
            'payment instead.'
            using errcode = 'check_violation';
    end if;

    -- REFUSAL 2 — already reversed. Kept from the original, and now reachable in
    -- the right order: the check above fires first for a reversal row.
    if v_original.status = 'REVERSED' then
        raise exception 'That payment has already been reversed'
            using errcode = 'check_violation';
    end if;

    -- NOTE, because it cost a mutation test to find: there used to be a THIRD
    -- check here testing `v_original.reverses_id is not null`. It was redundant —
    -- `is_reversal(p_payment_id)` asks exactly that question — and worse, it was a
    -- SECOND implementation of the same rule. Removing `is_reversal` left this one
    -- still refusing, so the mutation test reported the guard as unnecessary and
    -- the suite passed either way. A rule stated twice is a rule whose tests can
    -- pass while one copy is broken, which is precisely the failure mode F19 is
    -- about. One check, one place.

    insert into public.payments (
        reference, amount, paid_at, method, notes, status, recorded_by,
        idempotency_key, reverses_id, reversal_reason
    )
    values (
        'REV-' || v_original.reference,
        v_original.amount,
        now(),
        v_original.method,
        v_original.notes,
        'CONFIRMED',
        v_actor,
        'rev-' || p_payment_id::text,
        p_payment_id,
        btrim(p_reason)
    )
    returning * into v_reversal;

    -- Mirror the original's allocations onto the reversal, so the ledger balances.
    for v_alloc in
        select * from public.payment_allocations where payment_id = p_payment_id
    loop
        insert into public.payment_allocations (payment_id, student_charge_id, amount)
        values (v_reversal.id, v_alloc.student_charge_id, v_alloc.amount);

        perform public.refresh_charge_status(v_alloc.student_charge_id);
    end loop;

    -- `reversed_by_id` points at the REVERSAL PAYMENT, not at the person — its
    -- foreign key is `references payments(id)`. I first wrote `v_actor` here,
    -- copying the pattern from `recorded_by`, and the insert failed with a foreign
    -- key violation because a user id is not a payment id. The original migration
    -- was right; the column name simply reads like an actor and is not one.
    --
    -- WHO performed the reversal is recorded in `recorded_by` on the reversal row
    -- above, and in the audit trail, so no information is lost.
    update public.payments
       set status = 'REVERSED', reversed_by_id = v_reversal.id
     where id = p_payment_id;

    return jsonb_build_object(
        'reversal_id', v_reversal.id,
        'reference', v_reversal.reference,
        'amount', v_reversal.amount
    );
end;
$$;

comment on function public.reverse_payment(uuid, text) is
    'Reverses a payment once. Refuses to reverse a reversal — the old guard only '
    'rejected status = REVERSED, and a reversal row is CONFIRMED, so reversing one '
    'subtracted the allocation twice and produced paid = -100 on a settled charge '
    '(audit F19).';

revoke execute on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- F20: a paid charge's defining fields are frozen.
--
-- Guarded by a trigger rather than by narrowing the policy, because the rule is
-- about the ROW's state (does it have allocations?) and not about who is asking.
-- A role-based rule would have to be repeated for every future role; a state-based
-- rule holds for all of them, including the secret key.
--
-- What stays mutable, and why:
--   status   — `refresh_charge_status` recalculates it after every payment, and
--              the office legitimately waives and cancels. Already audited.
--   discount — an adjustment the school genuinely makes, via `set_charge_discount`.
--   due_date, description — administrative detail that changes no arithmetic.
--
-- What is frozen once money has been allocated: `amount`, `student_id`,
-- `fee_type_id`, `academic_year_id`, `period_month`, `period_year`. These decide
-- WHAT is owed and WHO owes it, and an allocation made against a different version
-- of the row is an allocation against something that never existed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_charge_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_allocated boolean;
begin
    -- Only an UPDATE can violate this. An INSERT has no prior obligation.
    if tg_op <> 'UPDATE' then
        return new;
    end if;

    -- Nothing has been paid against this charge, so its terms are still open.
    select exists (
        select 1 from public.payment_allocations pa where pa.student_charge_id = old.id
    ) into v_allocated;

    if not v_allocated then
        return new;
    end if;

    if new.amount         is distinct from old.amount
       or new.student_id     is distinct from old.student_id
       or new.fee_type_id    is distinct from old.fee_type_id
       or new.academic_year_id is distinct from old.academic_year_id
       or new.period_month   is distinct from old.period_month
       or new.period_year    is distinct from old.period_year
    then
        raise exception
            'This charge has payments against it, so what it is for cannot be '
            'changed. Reverse the payment, or correct the charge with a discount '
            'or a new charge.'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

comment on function public.enforce_charge_immutability() is
    'Freezes the fields that define what a charge is owed for, once any payment has '
    'been allocated against it. Status and discount stay mutable: they are '
    'legitimate corrections and are audited (audit F20).';

drop trigger if exists trg_enforce_charge_immutability on public.student_charges;
create trigger trg_enforce_charge_immutability
    before update on public.student_charges
    for each row execute function public.enforce_charge_immutability();

-- ---------------------------------------------------------------------------
-- F21: publication is a transition, not a column.
--
-- The old `assessments_write` policy is `for all` on `assessments.create`, which
-- covers draft edits, mark entry and publication with one rule. It is narrowed
-- here to the operations it was actually meant to cover, and publication is
-- refused at the row level for every caller that is not the publishing RPC.
--
-- A trigger is used rather than a policy because `publish_assessment` runs as
-- SECURITY DEFINER and would be subject to the same policy as everybody else; the
-- trigger distinguishes the transition itself, which is what the audit asks for.
--
-- The RPC sets a transaction-local flag before it writes, and the trigger checks
-- it. That is the standard way to let exactly one code path perform an otherwise
-- forbidden write, and it cannot be forged from outside because `set_config(...,
-- true)` is transaction-local and the RPC is the only code that sets it.
-- ---------------------------------------------------------------------------
create or replace function public.current_publication_intent()
returns boolean
language sql
stable
as $$
    select coalesce(
        current_setting('srik.publishing_assessment', true),
        ''
    ) = 'on';
$$;

comment on function public.current_publication_intent() is
    'True only inside publish_assessment, which sets the flag for the length of its '
    'transaction. Used to allow exactly one code path to change publication status '
    '(audit F21).';

create or replace function public.enforce_assessment_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Publishing or unpublishing by a plain UPDATE. The RPC sets the flag; nobody
    -- else can, because the setting is transaction-local and only the RPC writes it.
    if tg_op = 'INSERT' then
        if new.status = 'PUBLISHED' and not public.current_publication_intent() then
            raise exception
                'An assessment cannot be created as published. Publish it through '
                'the publish step, which checks that the marks are complete.'
                using errcode = 'check_violation';
        end if;
        return new;
    end if;

    if new.status is distinct from old.status
       and (new.status = 'PUBLISHED' or old.status = 'PUBLISHED')
       and not public.current_publication_intent()
    then
        raise exception
            'Publication status cannot be changed directly. Use the publish or '
            'unpublish step, which checks the marks and records who published it.'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

comment on function public.enforce_assessment_publication() is
    'Refuses to move an assessment into or out of PUBLISHED unless '
    'publish_assessment is the caller. The old policy was for all on '
    'assessments.create, so publication could be written directly — skipping the '
    'completeness check, the publish permission and the publisher metadata '
    '(audit F21).';

drop trigger if exists trg_enforce_assessment_publication on public.assessments;
create trigger trg_enforce_assessment_publication
    before insert or update on public.assessments
    for each row execute function public.enforce_assessment_publication();

-- ---------------------------------------------------------------------------
-- F18: a family balance for the caller's own family, and only their own.
--
-- The live version is `finance.view`-only, so the guardian leak the audit
-- describes is not reachable in production today — the audit is explicit about
-- that, and it matters because the finding reads as a live leak and is not one.
-- The guardian path is added here, correctly scoped, so parents can see their own
-- family's balance.
--
-- THE SCOPE RULE, which is the substance of the finding: for a guardian, the
-- siblings considered are the INTERSECTION of "children who share a guardian with
-- this child" and "children this caller is a guardian of". Sharing a guardian is a
-- fact about the children; it is not by itself authority over them. The office
-- keeps whole-family aggregation, because that is the school's own definition of a
-- family and it is what the office is for.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- An internal, unscoped paid-amount calculation.
--
-- `charge_paid_amount` carries its own authorization: it asks whether the caller
-- may read THIS charge, and refuses otherwise. That is right for a single charge
-- and fatal for a family total, which sums several children at once — the first
-- child the caller is not directly a guardian of raises an exception and the whole
-- balance fails.
--
-- This is not a weakening of `charge_paid_amount`. It is the same arithmetic with
-- the authorization left to the caller, and it is reachable ONLY from a function
-- that has already authorized the caller for every child it is about to sum —
-- which `family_balance` does, before it aggregates anything. `revoke` from every
-- API role is what makes "only from" true rather than merely intended.
--
-- The alternative was to duplicate the arithmetic here, and two copies of a
-- balance formula is precisely the shape of defect F19: a formula and a guard that
-- drift apart. One implementation, one authorization decision, in that order.
-- ---------------------------------------------------------------------------
create or replace function public.charge_paid_amount_unguarded(p_charge_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(sum(
        case when p.reverses_id is not null then -a.amount else a.amount end
    ), 0)::numeric(12,2)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.student_charge_id = p_charge_id
       and p.status in ('CONFIRMED', 'REVERSED');
$$;

comment on function public.charge_paid_amount_unguarded(uuid) is
    'The paid amount for a charge, with NO authorization check. Callable only from '
    'functions that have already authorized the caller for every charge they sum — '
    'it is revoked from all API roles. Exists so the balance formula has one '
    'implementation rather than two that can drift (audit F18, F19).';

-- Not reachable from the Data API at all. This is the whole safety argument.
revoke execute on function public.charge_paid_amount_unguarded(uuid) from public, anon, authenticated;

-- family_balance runs as its owner, so it can still call the unguarded helper
-- while holding every authorization check itself.

create or replace function public.family_balance(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor    uuid := auth.uid();
    v_is_office boolean;
    v_charged  numeric;
    v_paid     numeric;
    v_children integer;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    v_is_office := public.has_permission('finance.view');

    -- A guardian may see their own child's family balance. Anyone else needs the
    -- finance permission. Checked BEFORE any aggregation, so an unauthorised caller
    -- cannot even learn how many children are involved.
    if not v_is_office and not public.is_guardian_of(p_student_id) then
        raise exception 'You do not have permission to view this balance'
            using errcode = 'insufficient_privilege';
    end if;

    with siblings as (
        select p_student_id as sid
        union
        select sg2.student_id
          from public.student_guardians sg1
          join public.student_guardians sg2 on sg2.guardian_id = sg1.guardian_id
         where sg1.student_id = p_student_id
    ),
    -- THE FIX. For a guardian, only children they are themselves a guardian of.
    -- Sharing a guardian is a fact about the children, not a grant of authority
    -- over them (audit F18).
    permitted as (
        select s.sid
          from siblings s
         where v_is_office
            -- `= any(...)` and not `in (select ...)`: the helper returns an ARRAY,
            -- and `in (select array)` compares a uuid against a uuid[] — which
            -- Postgres rejects outright rather than doing something surprising.
            -- Caught by running it, not by reading it.
            or s.sid = any(public.current_guardian_child_ids())
    )
    select coalesce(sum(c.amount - c.discount_amount), 0),
           coalesce(sum(public.charge_paid_amount_unguarded(c.id)), 0),
           count(distinct c.student_id)
      into v_charged, v_paid, v_children
      from permitted p
      left join public.student_charges c
             on c.student_id = p.sid
            and c.status not in ('CANCELLED', 'WAIVED');

    return jsonb_build_object(
        'charged', v_charged,
        'paid', v_paid,
        'outstanding', v_charged - v_paid,
        'children', coalesce(v_children, 0)
    );
end;
$$;

comment on function public.family_balance(uuid) is
    'Balance for a child''s family. The office sees the whole family; a guardian '
    'sees only children they are themselves a guardian of. Sharing a guardian is a '
    'fact about the children, not authority over them — the old traversal treated '
    'shared guardianship as transitive authorization (audit F18).';

revoke execute on function public.family_balance(uuid) from public, anon;
grant execute on function public.family_balance(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- F21: publish_assessment is the one code path allowed to publish.
--
-- The trigger above refuses every other caller. This sets the flag for the length
-- of the transaction — `set_config(..., true)` is transaction-local, so it cannot
-- leak to another statement, another session or another request, and it is reset
-- when the transaction ends whether it commits or aborts.
--
-- The checks in this function are unchanged: the permission, the completeness
-- check and the publisher metadata were already correct, and the defect was that
-- they could be bypassed rather than that they were wrong.
-- ---------------------------------------------------------------------------
create or replace function public.publish_assessment(
    p_assessment_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_assess public.assessments;
    v_total  integer;
    v_marked integer;
begin
    if not public.has_permission('assessments.publish') then
        raise exception 'You do not have permission to publish an assessment'
            using errcode = 'insufficient_privilege';
    end if;

    -- Lock the assessment so two simultaneous publishes cannot both pass the
    -- "already published" check and both write.
    select * into v_assess
      from public.assessments
     where id = p_assessment_id
       for update;

    if v_assess.id is null then
        raise exception 'Assessment % does not exist', p_assessment_id
            using errcode = 'no_data_found';
    end if;

    if v_assess.status = 'PUBLISHED' then
        raise exception 'This assessment is already published'
            using errcode = 'check_violation';
    end if;

    -- Every enrolled child must have a decided result. Publishing with children
    -- still at NOT_ENTERED would put a blank row on a report card and call it
    -- finished.
    select count(*) into v_total
      from public.student_enrollments e
     where e.class_id = v_assess.class_id and e.ended_at is null;

    if v_total = 0 then
        raise exception 'There are no students enrolled in this class'
            using errcode = 'check_violation';
    end if;

    select count(*) into v_marked
      from public.assessment_results r
      join public.student_enrollments e on e.student_id = r.student_id
     where r.assessment_id = p_assessment_id
       and e.class_id = v_assess.class_id
       and e.ended_at is null
       and r.status <> 'NOT_ENTERED';

    if v_marked < v_total then
        raise exception 'Marks are still missing for % of % students',
            (v_total - v_marked), v_total
            using errcode = 'check_violation';
    end if;

    -- Declare the intent for this transaction only. The trigger on `assessments`
    -- reads it and allows the write it would otherwise refuse (audit F21).
    perform set_config('srik.publishing_assessment', 'on', true);

    update public.assessments
       set status = 'PUBLISHED',
           published_at = now(),
           updated_at = now()
     where id = p_assessment_id;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'ASSESSMENT_PUBLISHED', p_assessment_id,
            jsonb_build_object('marked', v_marked, 'students', v_total, 'reason', p_reason));

    return jsonb_build_object('published', true, 'students', v_total);
end;
$$;

comment on function public.publish_assessment(uuid, text) is
    'The only path that may set status = PUBLISHED. Checks the publish permission, '
    'that every enrolled child has a decided result, and records who published. The '
    'previous version was correct but bypassable, because the assessments write '
    'policy was `for all on assessments.create` (audit F21).';

revoke execute on function public.publish_assessment(uuid, text) from public, anon;
grant execute on function public.publish_assessment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify the properties, not the statements.
-- ---------------------------------------------------------------------------
do $$
declare
    v_body text;
begin
    -- F19: the reversal guard must reject a reversal. Its absence was the defect.
    v_body := pg_get_functiondef((select oid from pg_proc where proname = 'reverse_payment'));
    if v_body not like '%is_reversal%' then
        raise exception
            'F19 guard: reverse_payment does not reject reversing a reversal, so the '
            'balance can be corrupted again'
            using errcode = 'insufficient_privilege';
    end if;

    -- F20: the immutability trigger must exist on the charges table.
    if not exists (
        select 1 from pg_trigger t
         where t.tgrelid = 'public.student_charges'::regclass
           and t.tgname = 'trg_enforce_charge_immutability'
           and not t.tgisinternal
    ) then
        raise exception 'F20 guard: charges are not protected once paid'
            using errcode = 'insufficient_privilege';
    end if;

    -- F21: the publication trigger must exist, and the RPC must set the flag.
    -- Both halves are needed: a trigger without the flag locks everybody out, and a
    -- flag without the trigger achieves nothing.
    if not exists (
        select 1 from pg_trigger t
         where t.tgrelid = 'public.assessments'::regclass
           and t.tgname = 'trg_enforce_assessment_publication'
           and not t.tgisinternal
    ) then
        raise exception 'F21 guard: assessments can be published directly'
            using errcode = 'insufficient_privilege';
    end if;

    v_body := pg_get_functiondef((select oid from pg_proc where proname = 'publish_assessment'));
    if v_body not like '%srik.publishing_assessment%' then
        raise exception
            'F21 guard: publish_assessment does not declare its intent, so the '
            'legitimate publish path would be refused'
            using errcode = 'insufficient_privilege';
    end if;

    -- F18: the family traversal must be intersected with the caller's own children.
    -- Checking for `current_guardian_child_ids` is what distinguishes the scoped
    -- version from the transitive one.
    v_body := pg_get_functiondef((select oid from pg_proc where proname = 'family_balance'));
    if v_body not like '%current_guardian_child_ids%' then
        raise exception
            'F18 guard: family_balance aggregates without checking the caller is a '
            'guardian of each child'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
