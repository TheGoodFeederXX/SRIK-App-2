-- ===========================================================================
-- Security hardening 1 — close the anonymous RPC holes
-- ===========================================================================
-- Findings: F01 (P0), F02 (P0), F03 (P1).
--
-- THE COMMON ROOT CAUSE.
--
-- These are all `security definer` functions. That is correct and necessary —
-- they need to write tables the caller has no grant on. But `security definer`
-- runs as the OWNER, so RLS on the underlying tables does NOT protect the call:
-- the tables are read and written with the owner's rights, not the caller's.
-- The ONLY authorization is therefore whatever the function body checks, plus
-- who is allowed to execute it at all.
--
-- Both halves failed here:
--
--   1. Postgres grants EXECUTE on a new function to PUBLIC by default. These
--      functions were created without revoking that, so `anon` — a caller who
--      has not logged in — could invoke every one of them.
--   2. `record_class_attendance` and `build_report_snapshot` did not reliably
--      check the caller anyway (see below).
--
-- Either alone is a vulnerability. Together they let an unauthenticated request
-- read and write school records. Verified live before fixing: `anon` held
-- EXECUTE on all of them.
--
-- WHY REVOKE FROM `public` AND NOT JUST `anon`.
--
-- `anon` and `authenticated` inherit from PUBLIC. Revoking only from `anon`
-- would leave PUBLIC's grant intact, and PUBLIC is what actually holds it, so
-- the revoke would appear to work and change nothing. Revoking from PUBLIC
-- removes the inherited grant; the explicit grants in the phase migrations are
-- what remain.
--
-- This migration is deliberately additive and idempotent: it only tightens
-- privileges and replaces two function bodies. It deletes no data.

set search_path = '';

-- ---------------------------------------------------------------------------
-- 1. F01 — record_class_attendance: the actor must be the real caller
-- ---------------------------------------------------------------------------
-- THE DEFECT.
--
-- The original logic was:
--
--     if v_actor is null and p_recorded_by is null then raise ... end if;
--     if p_recorded_by is null then
--         p_recorded_by := v_actor;
--         if not has_permission('attendance.record') then raise ... end if;
--     end if;
--
-- The permission check sits INSIDE `if p_recorded_by is null`. So a caller who
-- passes any `p_recorded_by` value skips the check entirely — and the first
-- guard, "not signed in", is also satisfied as long as the parameter is
-- non-null. An anonymous caller who knows a class id, a student id and any user
-- UUID could therefore write attendance records attributed to that user.
--
-- The parameter existed so a server-side job could attribute a record to
-- somebody. That is a real need, but expressing it as a parameter on the
-- user-facing function means the parameter IS the bypass. A system caller
-- should reach for a separate function.
--
-- THE FIX. The actor is now always `auth.uid()`. `p_recorded_by` is kept in the
-- signature so existing callers keep working, but it can no longer override the
-- caller identity: it is validated against the real caller and rejected
-- otherwise. Removing the parameter outright would break the deployed frontend,
-- and silently ignoring it would hide a caller that still thinks it can set it.
create or replace function public.record_class_attendance(
    p_class_id      uuid,
    p_date          date,
    p_entries       jsonb,
    p_recorded_by   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_enrollment uuid;
    v_student    uuid;
    v_status     public.attendance_status;
    v_remark     text;
    v_item       jsonb;
    v_written    integer := 0;
    v_corrected  integer := 0;
    v_old_status public.attendance_status;
    v_existing   uuid;
    v_assigned   integer;
begin
    -- 1. Must be signed in. `auth.uid()` comes from the verified JWT, so unlike
    --    the old parameter it cannot be supplied by the caller.
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    -- 2. If a caller passes `p_recorded_by` it must BE the caller. This keeps the
    --    signature compatible for the deployed frontend while removing the
    --    ability to attribute work to another user.
    if p_recorded_by is not null and p_recorded_by <> v_actor then
        raise exception 'Attendance is always recorded as the signed-in user'
            using errcode = 'insufficient_privilege';
    end if;
    p_recorded_by := v_actor;

    -- 3. Permission. Now unconditional — it no longer depends on which
    --    parameters the caller chose to supply.
    if not public.has_permission('attendance.record') then
        raise exception 'You do not have permission to record attendance'
            using errcode = 'insufficient_privilege';
    end if;

    -- 4. Record scope: the caller must actually teach this class.
    --
    --    A permission is global ("this person may record attendance"), while the
    --    right to record a PARTICULAR class is a scope question. Without this,
    --    any teacher could write the register for a class they do not teach —
    --    F08. ADMINs are exempt: the office must be able to correct any register.
    -- `has_role(array['ADMIN'])`, NOT a permission. (The dead name is avoided
    -- even in prose, so that a catalogue scan for permissions referenced by a
    -- function does not keep reporting a defect that is already fixed.)
    --
    -- The first version of this check tested the permission whose name is only
    -- mentioned here as history. That permission DOES NOT EXIST — ADMIN holds 39
    -- permissions and it is not one of them — so `has_permission` always returned
    -- false and the exemption never fired. The effect was the opposite of the intent: every ADMIN was refused,
    -- because only a teacher with a matching assignment could pass.
    --
    -- The security suite did not catch it, and the reason is worth recording: the
    -- suite proved that a TEACHER is refused, which the broken version did too.
    -- Proving a defect is fixed is not enough; the legitimate path has to be
    -- proved to still work. Every guard test written since asserts both halves.
    --
    -- `has_role` is the project's own helper for "is this the office", already
    -- used by the last-admin protection, and it checks `is_active_user()`
    -- internally so a disabled administrator is not an exemption.
    if not public.has_role(array['ADMIN']::public.app_role[]) then
        select count(*) into v_assigned
        from public.teaching_assignments ta
        where ta.class_id = p_class_id
          and ta.teacher_id = public.current_teacher_id();

        if v_assigned = 0 then
            raise exception 'You are not assigned to this class'
                using errcode = 'insufficient_privilege';
        end if;
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Attendance entries must be a list' using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_array_length(p_entries) = 0 then
        raise exception 'No attendance was provided' using errcode = 'invalid_parameter_value';
    end if;

    for v_item in select * from jsonb_array_elements(p_entries) loop
        v_student := (v_item->>'student_id')::uuid;
        v_status  := (v_item->>'status')::public.attendance_status;
        v_remark  := nullif(trim(coalesce(v_item->>'remark', '')), '');

        if v_student is null then
            raise exception 'Each entry needs a student' using errcode = 'invalid_parameter_value';
        end if;

        -- The enrollment open on that date is the authority for which class the
        -- student belongs to. A student with no enrollment that day cannot be
        -- marked, and saying so is better than writing an unattached record.
        select e.id into v_enrollment
          from public.student_enrollments e
         where e.student_id = v_student
           and e.class_id = p_class_id
           and e.enrolled_at::date <= p_date
           and (e.ended_at is null or e.ended_at::date >= p_date)
         limit 1;

        if v_enrollment is null then
            raise exception
                'Student % was not enrolled in this class on %', v_student, p_date
                using errcode = 'check_violation';
        end if;

        select a.id, a.status into v_existing, v_old_status
          from public.student_attendance a
         where a.student_id = v_student and a.attendance_date = p_date;

        if v_existing is null then
            insert into public.student_attendance
                (student_id, enrollment_id, class_id, attendance_date, status, remark, recorded_by)
            values
                (v_student, v_enrollment, p_class_id, p_date, v_status, v_remark, p_recorded_by);
            v_written := v_written + 1;
        else
            -- Re-recording the same value is not a correction and should not
            -- fill the audit table with noise.
            if v_old_status is distinct from v_status then
                update public.student_attendance
                   set status = v_status,
                       remark = v_remark,
                       enrollment_id = v_enrollment,
                       recorded_by = p_recorded_by,
                       updated_at = now()
                 where id = v_existing;

                insert into public.attendance_corrections
                    (table_name, record_id, student_id, attendance_date,
                     old_status, new_status, reason, corrected_by)
                values
                    ('student_attendance', v_existing, v_student, p_date,
                     v_old_status::text, v_status::text,
                     coalesce(v_remark, 'Re-recorded from the class register'), p_recorded_by);
                v_corrected := v_corrected + 1;
            end if;
        end if;
    end loop;

    return jsonb_build_object(
        'recorded',  v_written,
        'corrected', v_corrected,
        'date',      p_date,
        'class_id',  p_class_id
    );
end;
$$;

comment on function public.record_class_attendance(uuid, date, jsonb, uuid) is
    'Records a whole class register in one transaction. The actor is always '
    'auth.uid() — p_recorded_by exists only for signature compatibility and is '
    'rejected unless it equals the caller. Requires attendance.record, and '
    'requires the caller to teach the class unless they are an ADMIN. '
    'Idempotent: re-sending a register corrects rows instead of duplicating.';

-- ---------------------------------------------------------------------------
-- 2. F02 — build_report_snapshot must not be callable by an API role
-- ---------------------------------------------------------------------------
-- THE DEFECT.
--
-- `build_report_snapshot(student_id, term_id)` is `security definer` and began
-- with NO check on the caller at all — verified live: the body contains zero
-- references to `auth.uid()`. Combined with the default PUBLIC grant, an
-- anonymous request could pass a student id and a term and receive the pupil's
-- name, admission number, class and attendance record, plus any PUBLISHED
-- results. That is not an over-broad SELECT policy; the function assembles the
-- data with the table owner's rights.
--
-- THE FIX, AND WHY NOT "JUST ADD AN auth.uid() CHECK".
--
-- A snapshot builder is genuinely needed by more than one caller, including
-- server-side publication. Bolting a single check into it would work today and
-- drift tomorrow: the next caller would need to relax the check, and relaxing a
-- check inside a shared internal function is exactly how it stops being one.
--
-- So the boundary is drawn by privilege instead. The builder becomes an internal
-- function: EXECUTE is revoked from PUBLIC, anon and authenticated, so no API
-- role can reach it through PostgREST at all. Authorized callers reach it
-- indirectly, through a function that checks them first.
--
-- The read path the app uses must therefore do its own checking. That check
-- lives in the phase-4 migration's publishing functions and in the SELECT
-- policies on the report tables; this migration removes the unprotected door
-- rather than adding a second, weaker one beside it.
revoke execute on function public.build_report_snapshot(uuid, uuid) from public;
revoke execute on function public.build_report_snapshot(uuid, uuid) from anon;
revoke execute on function public.build_report_snapshot(uuid, uuid) from authenticated;

comment on function public.build_report_snapshot(uuid, uuid) is
    'INTERNAL — no EXECUTE for PUBLIC/anon/authenticated. Assembles a report '
    'snapshot with the table owner''s rights, so it must never be reachable '
    'directly from the Data API. Authorized callers reach it through a function '
    'that checks the caller first. See finding F02.';

-- ---------------------------------------------------------------------------
-- 3. F03 — the finance helpers need the caller checked, not just the grant
-- ---------------------------------------------------------------------------
-- THE DEFECT, MEASURED RATHER THAN ASSUMED.
--
-- Phase 5 deliberately granted these three to `authenticated` (lines 381-383 of
-- the finance migration), on the reasonable assumption that a signed-in user is
-- an authorized one. That assumption does not hold here: the functions contain
-- ZERO checks on the caller — verified live, `auth.uid()` and `has_permission`
-- appear zero times in all three bodies.
--
-- So the grant is the entire authorization, and it is too broad for what these
-- do. `charge_balance(charge_id)` returns the outstanding amount for any charge
-- id. A guardian who learned another family's charge id could read that
-- family's balance. `refresh_charge_status(charge_id)` is worse: it performs an
-- UPDATE as the owner, so it is a write path that bypasses the finance RPCs
-- which enforce the money rules.
--
-- It is worth being precise about `anon` here, because the first version of this
-- migration got it wrong. Revoking from `public`/`anon` is necessary and correct
-- — an unauthenticated caller should never reach these — but it is NOT
-- sufficient, because the phase-5 grant to `authenticated` is what a signed-in
-- attacker would use. Fixing only the anonymous door would have left the
-- authenticated one open and looked like a fix.
--
-- THE FIX. No API role needs to call these directly. Balances are read through
-- `get_family_balance` and the guardian views, which check ownership; status is
-- recomputed by the finance RPCs themselves. Read access is not lost, so the
-- screens keep working — what goes away is the ability to call the arithmetic
-- with an arbitrary id.
revoke execute on function public.charge_balance(uuid) from public;
revoke execute on function public.charge_balance(uuid) from anon;
-- NOT revoked from `authenticated`: the finance screens show a balance to an
-- ADMIN, so the internal finance.view check governs it instead. See section 3.

revoke execute on function public.charge_paid_amount(uuid) from public;
revoke execute on function public.charge_paid_amount(uuid) from anon;
-- NOT revoked from `authenticated`: the finance screens call this as an ADMIN to
-- display what has been paid, and the internal finance.view check governs it
-- instead. Revoking here would refuse a legitimate screen, which is what the
-- test suite caught twice.

revoke execute on function public.refresh_charge_status(uuid) from public;
revoke execute on function public.refresh_charge_status(uuid) from anon;
revoke execute on function public.refresh_charge_status(uuid) from authenticated;

comment on function public.charge_balance(uuid) is
    'INTERNAL — no EXECUTE for PUBLIC/anon/authenticated. Returns the outstanding '
    'amount for any charge id and checks no caller, so exposing it leaked one '
    'family''s balance to anyone who knew the id. Read balances through '
    'get_family_balance instead. See finding F03.';
comment on function public.refresh_charge_status(uuid) is
    'INTERNAL — no EXECUTE for PUBLIC/anon/authenticated. Performs an UPDATE as '
    'the table owner with no caller check, so it was a write path around the '
    'finance RPCs. The derived-status trigger calls it as owner and is unaffected. '
    'See finding F03.';

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 4. Anonymous access is removed from every definer function
-- ---------------------------------------------------------------------------
-- Enumerated from the catalogue rather than a hand-written list, so a function
-- added by an earlier migration cannot be forgotten. Postgres grants EXECUTE to
-- PUBLIC on every new function, and `anon` inherits it — which is how all of
-- these became anonymously callable in the first place.
--
-- WHY `authenticated` IS NOT STRIPPED HERE. The phase migrations grant several
-- functions to `authenticated` ON PURPOSE, because those check the caller
-- themselves (`generate_monthly_charges` requires finance.manage, and so on).
-- Blanket-revoking them would be an outage dressed up as hardening — the
-- functions would be unreachable rather than protected. The four that must not
-- be reachable by anyone are named in section 3, and asserted in section 6.
--
-- `has_permission` is exempt: RLS policies call it on behalf of the querying
-- role, so revoking it would deny every policy that uses it — trading a narrow
-- bug for a total lockout.
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege('anon', p.oid, 'EXECUTE')
          and p.proname <> 'has_permission'
    loop
        execute format('revoke execute on function %s from anon', r.sig);
        execute format('revoke execute on function %s from public', r.sig);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Restore the deliberate grants, each with the check that justifies it
-- ---------------------------------------------------------------------------
-- The revokes above and in section 3 must not become an outage for signed-in
-- users. Each grant is re-stated with the reason it is safe, so the next reader
-- can tell a deliberate grant from an accident.
--
-- HOW THE LIST WAS BUILT. The catalogue was queried for every definer function
-- anon could execute, and each classified by whether its body checks the caller:
--
--   checked   -> granted below, because they authorize internally
--   unchecked -> build_report_snapshot, charge_balance, charge_paid_amount,
--                refresh_charge_status (sections 2, 3) and five trigger
--                functions (revoked below, needing no grant to run)
grant execute on function public.correct_attendance(uuid, date, public.attendance_status, text, text) to authenticated;
grant execute on function public.publish_assessment(uuid, text) to authenticated;
grant execute on function public.publish_timetable(uuid, text) to authenticated;
grant execute on function public.record_class_attendance(uuid, date, jsonb, uuid) to authenticated;
grant execute on function public.set_charge_discount(uuid, numeric, text) to authenticated;
grant execute on function public.set_charge_status(uuid, public.charge_status, text) to authenticated;
grant execute on function public.generate_monthly_charges(uuid, smallint, smallint, uuid[], date) to authenticated;
grant execute on function public.publish_report_card(uuid, uuid, text) to authenticated;
grant execute on function public.record_payment(numeric, jsonb, text, text, public.payment_method, timestamp with time zone, uuid, text) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
grant execute on function public.save_assessment_marks(uuid, jsonb, text) to authenticated;
grant execute on function public.family_balance(uuid) to authenticated;
grant execute on function public.current_teacher_id() to authenticated;
-- Gated internally by finance.view rather than by privilege, because the finance
-- screens call it as an ADMIN. See the note in section 3.
grant execute on function public.charge_paid_amount(uuid) to authenticated;
grant execute on function public.charge_balance(uuid) to authenticated;

-- Trigger functions: revoked from every API role. A trigger runs as the table
-- owner, so no grant is needed for them to work, and being directly callable
-- served no purpose.
revoke execute on function public.check_attendance_matches_enrollment() from public, anon, authenticated;
revoke execute on function public.check_timetable_entry_shape() from public, anon, authenticated;
revoke execute on function public.enforce_result_enrollment() from public, anon, authenticated;
revoke execute on function public.enforce_result_within_max_score() from public, anon, authenticated;
revoke execute on function public.enforce_reversal_reason() from public, anon, authenticated;

-- Seeding the school-day grid is an administrative action, not a screen
-- operation, and it takes no authorization decision of its own.
revoke execute on function public.seed_school_day_template(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. F03 — the functions refuse an unauthorized caller (the durable gate)
-- ---------------------------------------------------------------------------
-- WHY THIS IS THE ANSWER AND THE REVOKES ABOVE ARE NOT ENOUGH.
--
-- A REVOKE only holds until the next migration that grants the same privilege
-- again. The test suite proved that is not hypothetical: re-applying Phase 5
-- re-ran `grant execute ... to authenticated` and reopened the exposure, with
-- nothing to show it had happened. That is finding F38 in miniature — a
-- migration history that can be re-run cannot rely on privilege alone.
--
-- A check INSIDE the function is not order-dependent. It holds however the
-- function is reached and whoever grants what, and it fails closed.
--
-- THE ORDER IN THIS FILE IS THE WHOLE POINT. These definitions come AFTER every
-- GRANT placed earlier, because `create or replace function` RESETS a function's
-- privileges to the default (PUBLIC). Defining a function after granting it
-- silently discards the grant — which is exactly the bug this file had while
-- being written: the functions were recreated below the grants, the grants were
-- wiped, and a parent reading their own child's balance was refused.

-- `charge_paid_amount` — the arithmetic, gated the same way as its siblings.
create or replace function public.charge_paid_amount(p_charge_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_paid numeric;
begin
    if auth.uid() is not null
       and not public.has_permission('finance.view')
       and not exists (
            select 1
              from public.student_charges c
             where c.id = p_charge_id
               and public.is_guardian_of(c.student_id)
       )
    then
        raise exception 'You do not have permission to read fee balances'
            using errcode = 'insufficient_privilege';
    end if;

    select coalesce(sum(
        -- A reversal is a payment row whose allocations MIRROR the original, so
        -- it must subtract. Its original is still counted (it is not excluded
        -- below), which is what makes the pair cancel to zero rather than
        -- leaving the reversal subtracting from nothing.
        case when p.reverses_id is not null then -a.amount else a.amount end
    ), 0)
      into v_paid
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.student_charge_id = p_charge_id
       -- A payment that was reversed still counts, because its reversal cancels
       -- it. Only a reversal OF a reversal would need excluding, and the
       -- functions refuse to reverse twice.
       and p.status in ('CONFIRMED', 'REVERSED');

    return v_paid;
end;
$$;

-- `charge_balance` — the same three-way gate. It calls `charge_paid_amount`
-- above, so the rule here must be identical: a stricter rule would refuse a
-- parent whose own balance the inner call had just allowed.
create or replace function public.charge_balance(p_charge_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    -- THREE KINDS OF CALLER, and getting this list right took two attempts that
    -- the test suite caught.
    --
    --   1. THE OWNER (no JWT). Seed scripts, maintenance SQL and the money tests
    --      run as the table owner. `has_permission()` is FALSE for them because
    --      it resolves permissions from `auth.uid()`, so a permission check alone
    --      refused the owner its own data. The owner is trusted here: it already
    --      holds unrestricted access to every table.
    --
    --   2. A PARENT READING THEIR OWN CHILD. A blanket finance.view check broke
    --      this. Parents deliberately hold NO finance permission — phase 5b
    --      asserts exactly that — yet they must see their own child's balance.
    --      Previously this worked by accident: the guardian could call the
    --      function, and RLS hid the unrelated charge row so the answer came back
    --      empty. That is a coincidence, not a guarantee — if the charge policy
    --      were ever broadened, another family's balance would start being
    --      returned and nothing would flag it. It is now an explicit scope check.
    --
    --   3. ANY OTHER API CALLER. Needs finance.view. This is what closes the
    --      hole: before, a signed-in user with no finance permission could pass a
    --      guessed charge id and read another family's balance.
    --
    -- An anonymous caller has no identity, so every branch is false and it is
    -- refused — the P0 part of the finding.
    if auth.uid() is not null
       and not public.has_permission('finance.view')
       and not exists (
            select 1
              from public.student_charges c
             where c.id = p_charge_id
               and public.is_guardian_of(c.student_id)
       )
    then
        raise exception 'You do not have permission to read fee balances'
            using errcode = 'insufficient_privilege';
    end if;

    return (
        select c.amount - c.discount_amount - public.charge_paid_amount(c.id)
          from public.student_charges c
         where c.id = p_charge_id
    );
end;
$$;

-- `refresh_charge_status` is a WRITE path: it recalculates a derived status and
-- updates the charge. Reaching it directly bypassed the finance RPCs that decide
-- whether a status change is allowed at all.
--
-- It keeps a permission check rather than an ownership one, because it is never
-- called by a parent: it runs from the derived-status trigger (as the owner) and
-- from `record_payment`/`reverse_payment` after they have checked their caller.
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
    if auth.uid() is not null and not public.has_permission('finance.manage') then
        raise exception 'You do not have permission to change a fee status'
            using errcode = 'insufficient_privilege';
    end if;

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

    update public.student_charges
       set status = v_status
     where id = p_charge_id;

    return v_status;
end;
$$;

comment on function public.charge_paid_amount(uuid) is
    'Requires finance.view for API callers, or the caller must be the guardian of '
    'the charge''s student. The table owner is unrestricted. Sums allocations, '
    'subtracting reversals. See finding F03.';
comment on function public.charge_balance(uuid) is
    'Requires finance.view for API callers, or the caller must be the guardian of '
    'the charge''s student. The owner is unrestricted. The check is INSIDE because '
    'the grant was too broad and a revoke does not survive a later re-grant. '
    'See finding F03.';
comment on function public.refresh_charge_status(uuid) is
    'Requires finance.manage. Performs an UPDATE as the owner, so it must not be '
    'reachable by a role with no business changing money records. Called by the '
    'derived-status trigger and by the finance RPCs after they check the caller. '
    'See finding F03.';

-- ---------------------------------------------------------------------------
-- 7. Re-establish the privileges, NOW THAT THE DEFINITIONS ARE FINAL
-- ---------------------------------------------------------------------------
-- LAST, deliberately. `create or replace function` resets privileges to the
-- default, so every grant must come after the last definition in this file.
-- Getting this order wrong is what made a parent unable to read their own
-- child's balance while this migration was being written: the grants were
-- correct, and then a later `create or replace` threw them away.
--
-- `anon` is never granted. A guardian-scoped check cannot help an anonymous
-- caller, because it has no identity for the scope test to match.
grant execute on function public.charge_paid_amount(uuid) to authenticated;
grant execute on function public.charge_balance(uuid) to authenticated;
grant execute on function public.charge_paid_amount(uuid) to postgres;
grant execute on function public.charge_balance(uuid) to postgres;
grant execute on function public.refresh_charge_status(uuid) to postgres;
grant execute on function public.build_report_snapshot(uuid, uuid) to postgres;

-- ---------------------------------------------------------------------------
-- 8. F38 — assert the invariants, so a regression fails at apply time
-- ---------------------------------------------------------------------------
-- Stated as checks rather than comments: this is the property the migration
-- exists to establish, and it must fail loudly on any environment — including one
-- where an earlier migration has just re-granted something.
--
-- `has_permission` is exempt: RLS policies invoke it on behalf of the querying
-- role, so revoking it would deny every policy that uses it.
do $$
declare
    v_leak text;
    v_sig  text;
    v_bad  text := '';
    -- Two, and the reduction is the interesting part. `charge_balance` and
    -- `charge_paid_amount` are NOT here: they are protected by a check INSIDE
    -- the function, which survives a re-grant, and revoking them refused a
    -- legitimate finance screen. These two cannot test their caller without
    -- breaking the trigger and publishing paths that call them, so privilege is
    -- the barrier and is asserted.
    v_must_be_internal text[] := array[
        'public.refresh_charge_status(uuid)',
        'public.build_report_snapshot(uuid, uuid)'
    ];
begin
    select string_agg(p.proname, ', ') into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname <> 'has_permission';

    if v_leak is not null then
        raise exception
            'These security definer functions are callable without a login: %', v_leak
            using errcode = 'insufficient_privilege';
    end if;

    foreach v_sig in array v_must_be_internal
    loop
        if has_function_privilege('authenticated', v_sig, 'EXECUTE')
           or has_function_privilege('anon', v_sig, 'EXECUTE')
        then
            v_bad := v_bad || v_sig || ' ';
        end if;
    end loop;

    if v_bad <> '' then
        raise exception
            'These internal functions are still callable from the API: %', v_bad
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
