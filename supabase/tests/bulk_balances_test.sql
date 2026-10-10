-- Guard test for audit finding F28 — bulk balance reads, authorized per charge.
--
-- THE FINDING. `chargeBalances` called the single-charge balance function once per
-- charge, in parallel. A screen listing a family's charges for a few months made a
-- few hundred HTTP requests, and waited for the slowest.
--
-- THE FIX. One request, one query, one authorization decision PER CHARGE.
--
-- WHY THE PER-CHARGE PART IS THE WHOLE TEST. A bulk function is the classic place
-- where per-row authorization quietly becomes "authorize once". The caller passes
-- N ids, the function checks that they may read one of them, and returns all N.
--
-- That bug is invisible to a test that passes a single id, and invisible to a test
-- where every id belongs to the same child. So the checks below are built around a
-- guardian who may read SOME of the requested charges and not others — a mix — and
-- the assertion is that the call is REFUSED rather than quietly answering for 4 of
-- 5 and omitting the rest.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e800-' || lpad(p_label, 12, '0'))::uuid;
$$;

create or replace function test_as(p_user uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text,
        true
    );
    execute format('set local role %I', p_role);
end;
$$;

reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.f28@srik.test', now()),
    (test_id('10'), 'penjaga.f28@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Pentadbir F28', 'ACTIVE', false),
    (test_id('10'), 'Penjaga F28', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status,
        must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'), (test_id('10'), 'GUARDIAN')
on conflict do nothing;

-- The caller's own child, and another family's child.
insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'F28-401', 'Anak Sendiri', 'MALE', 'ACTIVE'),
    (test_id('402'), 'F28-402', 'Anak Keluarga Lain', 'FEMALE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('601'), test_id('10'), 'Penjaga F28', '019'),
    (test_id('602'), null, 'Penjaga Lain F28', '018')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary) values
    (test_id('401'), test_id('601'), 'FATHER', true),
    (test_id('402'), test_id('602'), 'FATHER', true)
on conflict do nothing;

-- The year and fee type are created by the suite: `fee_types` is not seeded by any
-- migration and a charge row needs both, and the scratch database has no academic
-- year of its own. Both were "null value in column" failures before this.
insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('950'), 'F28-2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

-- Only one year may be CURRENT; the scratch database has none to begin with, so
-- this is safe, but the fixture asserts what it produced rather than assuming.
create temporary table y28 as
select id from public.academic_years where status = 'CURRENT' limit 1;

do $$
begin
    if (select count(*) from y28) <> 1 then
        raise exception
            'F28 test setup: expected exactly one CURRENT academic year, found %',
            (select count(*) from y28)
            using errcode = 'raise_exception';
    end if;
end
$$;

insert into public.fee_types (id, code, name, default_amount, frequency, sort_order)
values (test_id('700'), 'F28', 'Yuran Ujian F28', 0, 'ONE_TIME', 98)
on conflict (id) do nothing;

-- THREE charges: two the caller's, one belonging to another family.
insert into public.student_charges
    (id, student_id, academic_year_id, fee_type_id, description, amount,
     discount_amount, status, period_month, period_year)
values
    (test_id('801'), test_id('401'), (select id from y28),
     test_id('700'), 'Caj Sendiri A', 100, 0, 'OUTSTANDING', 1, 2026),
    (test_id('802'), test_id('401'), (select id from y28),
     test_id('700'), 'Caj Sendiri B', 200, 0, 'OUTSTANDING', 2, 2026),
    (test_id('803'), test_id('402'), (select id from y28),
     test_id('700'), 'Caj Keluarga Lain', 777, 0, 'OUTSTANDING', 3, 2026)
on conflict (id) do nothing;

-- A payment against the caller's own charge, so the figures are not all zero and a
-- function that returned nothing could not pass by accident.
-- `payments` has no student_id: a payment is allocated to charges, and the child
-- is reached through `payment_allocations`. The column is `reference`, not
-- `reference_no`. Both were wrong in the first version of this fixture.
insert into public.payments (id, amount, method, status, paid_at, idempotency_key, reference, recorded_by)
values (test_id('900'), 100, 'CASH', 'CONFIRMED', now(),
        'idem-f28', 'PAY-F28', test_id('1'))
on conflict (id) do nothing;

insert into public.payment_allocations (id, payment_id, student_charge_id, amount)
values (test_id('901'), test_id('900'), test_id('801'), 100)
on conflict (id) do nothing;

-- The fixture precondition, asserted where it is made: without the payment the
-- "correct figures" check below would pass on zeroes.
do $$
begin
    if (select count(*) from public.student_charges where id in
        (test_id('801'), test_id('802'), test_id('803'))) <> 3 then
        raise exception 'F28 test setup: the charges were not created'
            using errcode = 'raise_exception';
    end if;
    if public.charge_paid_amount(test_id('801')) <> 100 then
        raise exception
            'F28 test setup: the payment fixture did not take effect (paid = %)',
            public.charge_paid_amount(test_id('801'))
            using errcode = 'raise_exception';
    end if;
end
$$;

-- ===========================================================================
-- F28a: the caller's OWN charges come back with the right figures.
--
-- The both-halves rule: a bulk function that refuses everything is not a fix.
-- ===========================================================================
select test_as(test_id('10'));

do $$
declare
    v_rows integer;
    v_paid numeric;
begin
    select count(*), coalesce(sum(paid_amount), 0)
      into v_rows, v_paid
      from public.charge_paid_amounts(
          array[test_id('801'), test_id('802')]::uuid[]
      );

    if v_rows <> 2 then
        raise exception
            'FAIL F28: asked for 2 of the caller''s own charges, got %', v_rows
            using errcode = 'raise_exception';
    end if;
    if v_paid <> 100 then
        raise exception
            'FAIL F28: the paid total is % but the fixture paid RM100', v_paid
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the caller''s own charges are returned with the right figures';
end
$$;

-- ===========================================================================
-- F28b: ONE charge outside the caller's guardianship refuses the call — with a
-- PERMITTED charge FIRST.
--
-- THIS ORDERING IS THE WHOLE TEST, and getting it wrong is how the first version of
-- this suite failed to catch the defect it was written for.
--
-- The mutation worth catching is `p_charge_ids[1]` — authorize only the FIRST id and
-- answer for all of them. Whether that mutation is caught depends entirely on which
-- id comes first:
--
--   [permitted, forbidden]  -> the mutation authorizes id 1 (permitted) and returns
--                              the forbidden charge. The test MUST fail here.
--   [forbidden, permitted]  -> the mutation refuses, but for the wrong reason: it
--                              would have refused the forbidden charge anyway. The
--                              test passes and the defect survives.
--
-- My first version used [permitted, permitted, forbidden], whose first id is
-- permitted — and the mutation passed it cleanly. So this check puts the forbidden
-- charge SECOND, where authorizing only id 1 cannot hide it.
-- ===========================================================================
do $$
declare
    v_refused boolean := false;
    v_rows    integer := 0;
begin
    begin
        select count(*) into v_rows
          from public.charge_paid_amounts(
              array[test_id('801'), test_id('803')]::uuid[]
          );
    exception when insufficient_privilege then
        v_refused := true;
    end;

    if not v_refused then
        raise exception
            'FAIL F28: a permitted charge first and another family''s charge second '
            'returned % rows — the function authorizes the first id and answers for '
            'all of them',
            v_rows
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a permitted charge first does not license an unauthorized second charge';
end
$$;

-- ===========================================================================
-- F28c: the mirror case — forbidden first, permitted second.
--
-- Both orders are checked because "authorize the first id" and "authorize the last
-- id" fail in opposite directions, and neither test alone can catch both.
-- ===========================================================================
do $$
declare
    v_refused boolean := false;
begin
    begin
        perform public.charge_paid_amounts(
            array[test_id('803'), test_id('801')]::uuid[]
        );
    exception when insufficient_privilege then
        v_refused := true;
    end;

    if not v_refused then
        raise exception
            'FAIL F28: a bulk read beginning with another family''s charge was allowed'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an unauthorized charge first is refused too';
end
$$;

-- ===========================================================================
-- F28c1: the LAYER THAT ACTUALLY REFUSES must be named, because there are two.
--
-- A note on what the checks above can and cannot prove, found by mutation testing.
--
-- This function refuses an unauthorized charge in TWO places: its own loop, and then
-- `charge_paid_amount(v_id)`, which carries the same gate from the F03 work. Removing
-- the loop's gate does NOT make the function exploitable — the inner call refuses
-- anyway — so the three checks above still pass with it removed. Defence in depth is
-- working, but it means those checks cannot distinguish "the loop guard is doing its
-- job" from "the loop guard is gone and the inner call saved us".
--
-- That is worth stating plainly rather than leaving a test that looks stronger than
-- it is. What the checks above DO prove is the behaviour that matters: no caller gets
-- another family's figure out of this function through any route tested.
--
-- This check names the belt-and-braces explicitly, so a future change that removes
-- BOTH layers fails here rather than silently opening a hole.
-- ===========================================================================
do $$
declare
    v_inner text;
begin
    v_inner := pg_get_functiondef((select oid from pg_proc where proname = 'charge_paid_amount'));
    if v_inner not like '%has_permission%' then
        raise exception
            'FAIL F28: charge_paid_amount no longer carries its own gate. The bulk '
            'function refuses unauthorized charges in two places, and this was the '
            'second one — with both gone, a bulk read returns another family''s money'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the inner per-charge call still carries its own guard';
end
$$;

-- ===========================================================================
-- F28c2: and a request for ONLY the forbidden charge.
--
-- The simplest case, and the one that pins the gate down: a bulk function that
-- authorized nothing at all would also fail the two checks above, so this proves the
-- refusal is about THIS charge rather than a function that refuses everything.
-- ===========================================================================
do $$
declare
    v_refused boolean := false;
begin
    begin
        perform public.charge_paid_amounts(array[test_id('803')]::uuid[]);
    exception when insufficient_privilege then
        v_refused := true;
    end;

    if not v_refused then
        raise exception
            'FAIL F28: a request for another family''s charge alone was allowed'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: another family''s charge alone is refused';
end
$$;

-- ===========================================================================
-- F28d: the OFFICE sees every charge, including other families'.
--
-- The office holds `finance.view`. A fix that restricted this function to a
-- caller's own family would break the fee screen the school actually uses.
-- ===========================================================================
reset role;
select test_as(test_id('1'));

do $$
declare
    v_rows integer;
    v_paid numeric;
begin
    select count(*), coalesce(sum(paid_amount), 0)
      into v_rows, v_paid
      from public.charge_paid_amounts(
          array[test_id('801'), test_id('802'), test_id('803')]::uuid[]
      );

    if v_rows <> 3 then
        raise exception 'FAIL F28: the office asked for 3 charges and got %', v_rows
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the office reaches every charge it asks about';
end
$$;

-- ===========================================================================
-- F28e: the bulk answer agrees with the single-charge answer.
--
-- If the two disagree, one of them is lying and the screens will contradict each
-- other. The bulk function delegates rather than reimplementing the formula, and
-- this is what proves it.
-- ===========================================================================
do $$
declare
    v_bulk numeric;
    v_one  numeric;
begin
    select paid_amount into v_bulk
      from public.charge_paid_amounts(array[test_id('801')]::uuid[]);
    v_one := public.charge_paid_amount(test_id('801'));

    if v_bulk is distinct from v_one then
        raise exception
            'FAIL F28: the bulk figure is % and the single-charge figure is % — the '
            'same charge has two different balances depending on how it was asked',
            v_bulk, v_one
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the bulk figure matches the single-charge figure';
end
$$;

-- ===========================================================================
-- F28f: an empty request is empty, not an error.
--
-- A screen with no charges should render an empty list, not a failure.
-- ===========================================================================
do $$
declare
    v_rows integer;
begin
    select count(*) into v_rows
      from public.charge_paid_amounts('{}'::uuid[]);
    if v_rows <> 0 then
        raise exception 'FAIL F28: an empty request returned % rows', v_rows
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an empty request returns nothing and does not fail';
end
$$;

-- ===========================================================================
-- F28f2: the GRANTS are what make "authenticated only" true.
--
-- Being refused as `anon` does not prove the grant is absent: the suite runs as the
-- owner, and an owner bypasses privileges entirely. Removing the `grant ... to
-- authenticated` line — a one-word deletion — would leave every behavioural check in
-- this file passing while the fee screen broke for every real user, because no real
-- user is the owner.
--
-- So the privilege itself is inspected, in both directions.
-- ===========================================================================
do $$
begin
    if not has_function_privilege(
        'authenticated', 'public.charge_paid_amounts(uuid[])', 'execute'
    ) then
        raise exception
            'FAIL F28: a signed-in user cannot call charge_paid_amounts, so the fee '
            'screen cannot read a single balance'
            using errcode = 'raise_exception';
    end if;

    if has_function_privilege('anon', 'public.charge_paid_amounts(uuid[])', 'execute') then
        raise exception
            'FAIL F28: an anonymous caller holds execute on charge_paid_amounts'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: only a signed-in caller holds the grant';
end
$$;

-- ===========================================================================
-- F28g: an anonymous caller cannot use it at all.
-- ===========================================================================
reset role;

do $$
declare
    v_refused boolean := false;
begin
    begin
        execute 'set local role anon';
        perform public.charge_paid_amounts(array[test_id('801')]::uuid[]);
    exception when others then
        v_refused := true;
    end;
    reset role;

    if not v_refused then
        raise exception
            'FAIL F28: an anonymous caller can read charge balances'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an anonymous caller is refused';
end
$$;

rollback;
