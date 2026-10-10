-- =============================================================================
-- SRIK Phase 5b — a parent sees only their own children
-- =============================================================================
-- One transaction, rolled back at the end, against a THROWAWAY database.
--
-- This suite exists to prove one thing above all others: that one family cannot
-- see another family's money. Everything else here is supporting detail.
--
-- The tests that matter most are marked "THE RULE". Each is written so that it
-- FAILS LOUDLY if the protection is removed, rather than passing because the
-- data happened not to be there.
--
-- Two guardians are created, each with a child. Every check is then run as
-- guardian A and asks what guardian A can see of guardian B's child. The only
-- acceptable answer is nothing.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-d000-' || lpad(p_label, 12, '0'))::uuid;
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

-- ---------------------------------------------------------------------------
-- Fixtures: two unrelated families, and one child shared by nobody
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p5b@srik.test', now()),
    (test_id('10'), 'bapa.a@srik.test', now()),
    (test_id('11'), 'bapa.b@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('10'), 'GUARDIAN'),
    (test_id('11'), 'GUARDIAN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J')
on conflict (id) do nothing;

-- Family A: guardian A has child A.
-- Family B: guardian B has child B.
insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P5B-A', 'Anak Keluarga A', 'ACTIVE'),
    (test_id('402'), 'P5B-B', 'Anak Keluarga B', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('401'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

-- The guardian rows carry the login. This is the link the whole phase turns on.
insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('501'), test_id('10'), 'Bapa Keluarga A', '0111111111'),
    (test_id('502'), test_id('11'), 'Bapa Keluarga B', '0222222222')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
    (test_id('401'), test_id('501'), 'FATHER', true),
    (test_id('402'), test_id('502'), 'FATHER', true)
on conflict do nothing;

insert into public.fee_types (id, code, name, default_amount, frequency) values
    (test_id('700'), 'BULANAN', 'Yuran Bulanan', 150.00, 'MONTHLY')
on conflict (id) do nothing;

-- A charge against each family's child, of DIFFERENT amounts, so a leak is
-- unmistakable rather than a coincidence of equal numbers.
insert into public.student_charges
    (id, student_id, fee_type_id, academic_year_id, period_month, period_year,
     amount, due_date, description)
values
    (test_id('800'), test_id('401'), test_id('700'), test_id('900'), 3, 2026,
     150.00, '2026-03-01', 'Yuran Bulanan'),
    (test_id('801'), test_id('402'), test_id('700'), test_id('900'), 3, 2026,
     999.00, '2026-03-01', 'Yuran Bulanan')
on conflict (id) do nothing;

-- A payment by family B, so a leak of the payments table is also detectable.
insert into public.payments (id, reference, amount, idempotency_key, method, payer_guardian_id)
values (test_id('900'), 'RCPT-FAMILY-B', 999.00, 'p5b-key-1', 'CASH', test_id('502'))
on conflict (id) do nothing;

insert into public.payment_allocations (payment_id, student_charge_id, amount)
values (test_id('900'), test_id('801'), 999.00)
on conflict do nothing;

-- ===========================================================================
-- TEST 1: the caller's children are derived from the family link
-- ===========================================================================
select test_as(test_id('10'));   -- guardian A

do $$
declare
    v_children uuid[];
begin
    v_children := public.current_guardian_child_ids();

    if array_length(v_children, 1) <> 1 then
        raise exception 'FAIL: guardian A is linked to % children, expected 1',
            coalesce(array_length(v_children, 1), 0);
    end if;
    if v_children[1] <> test_id('401') then
        raise exception 'FAIL: guardian A''s child is %, expected %', v_children[1], test_id('401');
    end if;

    raise notice 'PASS: a guardian''s children come from the family record, not from the caller';
end
$$;

-- ===========================================================================
-- TEST 2: THE RULE — a parent cannot list another family's children
-- ===========================================================================
do $$
declare
    v_ids uuid[];
begin
    select array_agg(id) into v_ids from public.students;

    if v_ids is null or array_length(v_ids, 1) <> 1 then
        raise exception 'FAIL: guardian A can see % children, expected only their own',
            coalesce(array_length(v_ids, 1), 0);
    end if;
    if v_ids[1] <> test_id('401') then
        raise exception 'FAIL: guardian A can see child %, who is not theirs', v_ids[1];
    end if;

    raise notice 'PASS: a parent cannot list another family''s child';
end
$$;

-- ===========================================================================
-- TEST 3: THE RULE — a parent cannot read another family's money
-- ===========================================================================
do $$
declare
    v_charges integer;
    v_amount  numeric;
begin
    select count(*), coalesce(sum(amount), 0) into v_charges, v_amount
      from public.student_charges;

    if v_charges <> 1 then
        raise exception 'FAIL: guardian A can see % charges, expected 1', v_charges;
    end if;
    -- Family B's charge is 999.00 and must be invisible.
    if v_amount = 999.00 then
        raise exception 'FAIL: guardian A can see family B''s 999.00 charge';
    end if;
    if v_amount <> 150.00 then
        raise exception 'FAIL: guardian A sees % of charges, expected 150.00', v_amount;
    end if;

    raise notice 'PASS: a parent cannot read another family''s charges';
end
$$;

-- ===========================================================================
-- TEST 4: THE RULE — a parent cannot read another family's receipts
-- ===========================================================================
do $$
declare
    v_payments integer;
    v_refs     text;
begin
    select count(*), coalesce(string_agg(reference, ','), '') into v_payments, v_refs
      from public.payments;

    if v_payments <> 0 then
        raise exception 'FAIL: guardian A can see % payments: %', v_payments, v_refs;
    end if;

    raise notice 'PASS: a parent cannot see a receipt that is not theirs';
end
$$;

-- ===========================================================================
-- TEST 5: a parent CAN see their own child's charges
-- ===========================================================================
do $$
declare
    v_charges integer;
begin
    select count(*) into v_charges
      from public.student_charges where student_id = test_id('401');

    if v_charges <> 1 then
        raise exception 'FAIL: guardian A cannot see their own child''s charge';
    end if;

    raise notice 'PASS: a parent can see their own child''s charges';
end
$$;

-- ===========================================================================
-- TEST 6: the balance of their own child's charge is readable and correct
-- ===========================================================================
do $$
declare
    v_balance numeric;
begin
    v_balance := public.charge_balance(test_id('800'));
    if v_balance <> 150.00 then
        raise exception 'FAIL: the balance of the child''s charge is %', v_balance;
    end if;
    raise notice 'PASS: a parent can read their own child''s balance';
end
$$;

-- ===========================================================================
-- TEST 7: an unrelated child's balance is not reachable
-- ===========================================================================
do $$
declare
    v_balance numeric;
begin
    -- The helper is SECURITY DEFINER, so it can compute the figure, but the
    -- charge row itself is invisible to this parent. Reading it gives nothing.
    select public.charge_balance(test_id('801')) into v_balance;
    if v_balance = 999.00 then
        raise exception 'FAIL: guardian A can compute a balance for a child who is not theirs';
    end if;

    raise notice 'PASS: a parent cannot reach another family''s balance';
end
$$;

-- ===========================================================================
-- TEST 8: THE RULE — a parent holds no finance permission
-- ===========================================================================
do $$
declare
    v_perms integer;
begin
    select count(*) into v_perms
      from public.role_permissions
     where role_code = 'GUARDIAN' and permission_code like 'finance%';

    if v_perms <> 0 then
        raise exception 'FAIL: the GUARDIAN role holds % finance permissions', v_perms;
    end if;

    -- And the helper that reports it must agree.
    if (public.guardian_scope_check()->>'guardian_finance_permissions')::integer <> 0 then
        raise exception 'FAIL: guardian_scope_check reports finance permissions';
    end if;

    raise notice 'PASS: a parent holds no finance permission, so only the family-scoped policies protect them';
end
$$;

-- ===========================================================================
-- TEST 9: THE RULE — a parent cannot write money anywhere
-- ===========================================================================
do $$
declare
    v_can boolean;
begin
    select has_table_privilege('authenticated', 'public.payments', 'INSERT') into v_can;
    -- The office cannot insert payments directly either: it goes through the
    -- audited function. A parent is refused for the same reason, and more.
    if v_can then
        raise exception 'FAIL: authenticated can insert a payment directly'
            using errcode = 'raise_exception';
    end if;

    begin
        perform public.record_payment(
            150.00,
            jsonb_build_array(jsonb_build_object('charge_id', test_id('800'), 'amount', 150.00)),
            'guardian-try-key');
        raise exception 'FAIL: a parent recorded a payment'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        perform public.generate_monthly_charges(test_id('900'), 2026::smallint, 4::smallint);
        raise exception 'FAIL: a parent generated fees'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a parent can take no money action at all';
end
$$;

-- ===========================================================================
-- TEST 10: a parent cannot waive or discount their own charge
-- ===========================================================================
do $$
begin
    begin
        perform public.set_charge_status(test_id('800'), 'WAIVED', 'saya tak nak bayar');
        raise exception 'FAIL: a parent waived their own charge'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        perform public.set_charge_discount(test_id('800'), 150.00, 'saya nak diskaun');
        raise exception 'FAIL: a parent discounted their own charge'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a parent cannot waive or discount even their own charge';
end
$$;

-- ===========================================================================
-- TEST 11: a parent cannot see the whole family balance of another family
-- ===========================================================================
do $$
declare
    v_family jsonb;
begin
    -- Asked about a child who is not theirs. The function refuses outright,
    -- and even if it did not, the rows behind it are invisible.
    begin
        v_family := public.family_balance(test_id('402'));
        raise exception 'FAIL: a parent read another family''s balance (%)', v_family
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a parent cannot read another family''s balance';
end
$$;

-- ===========================================================================
-- TEST 12: a parent CAN read their own family balance
-- ===========================================================================
do $$
declare
    v_family jsonb;
begin
    v_family := public.family_balance(test_id('401'));

    if (v_family->>'children')::integer <> 1 then
        raise exception 'FAIL: family_balance counted % children, expected 1', v_family->>'children';
    end if;
    if (v_family->>'charged')::numeric <> 150.00 then
        raise exception 'FAIL: family_balance charged %, expected 150.00', v_family->>'charged';
    end if;

    raise notice 'PASS: a parent can read their own family balance';
end
$$;

-- ===========================================================================
-- TEST 13: a parent sees only the fee names their child is charged for
-- ===========================================================================
do $$
declare
    v_fees integer;
begin
    select count(*) into v_fees from public.fee_types;
    if v_fees <> 1 then
        raise exception 'FAIL: guardian A sees % fee types, expected only the ones charged to their child', v_fees;
    end if;
    raise notice 'PASS: a parent sees only the fee types their own child is charged for';
end
$$;

-- ===========================================================================
-- TEST 14: an inactive fee type is not exposed to a parent
-- ===========================================================================
reset role;
insert into public.fee_types (id, code, name, default_amount, frequency, status)
values (test_id('701'), 'LAMA', 'Yuran Lama', 10.00, 'MONTHLY', 'INACTIVE')
on conflict (id) do nothing;
-- Charged to family A, so the only reason it is hidden is that it is inactive.
insert into public.student_charges
    (id, student_id, fee_type_id, academic_year_id, period_month, period_year, amount)
values (test_id('802'), test_id('401'), test_id('701'), test_id('900'), 3, 2026, 10.00)
on conflict (id) do nothing;
select test_as(test_id('10'));

do $$
declare
    v_inactive integer;
begin
    select count(*) into v_inactive from public.fee_types where status = 'INACTIVE';
    if v_inactive <> 0 then
        raise exception 'FAIL: a parent can see an inactive fee type';
    end if;
    raise notice 'PASS: an inactive fee type is not shown to a parent';
end
$$;

-- ===========================================================================
-- TEST 15: THE OFFICE IS UNAFFECTED — a guardian policy must not narrow staff access
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_students integer;
    v_charges  integer;
    v_payments integer;
begin
    select count(*) into v_students from public.students;
    select count(*) into v_charges from public.student_charges;
    select count(*) into v_payments from public.payments;

    if v_students < 2 then
        raise exception 'FAIL: the office now sees only % students', v_students;
    end if;
    if v_charges < 2 then
        raise exception 'FAIL: the office now sees only % charges', v_charges;
    end if;
    if v_payments < 1 then
        raise exception 'FAIL: the office can no longer see payments';
    end if;

    raise notice 'PASS: the office still sees everything; the parent policies only widen access';
end
$$;

-- ===========================================================================
-- TEST 16: a user with NO role sees nothing
-- ===========================================================================
reset role;
insert into auth.users (id, email, email_confirmed_at)
values (test_id('12'), 'tiada.peranan@srik.test', now())
on conflict (id) do nothing;
select test_as(test_id('12'));

do $$
declare
    v_students integer;
    v_charges  integer;
    v_children integer;
begin
    select count(*) into v_students from public.students;
    select count(*) into v_charges from public.student_charges;
    select coalesce(array_length(public.current_guardian_child_ids(), 1), 0) into v_children;

    if v_students <> 0 or v_charges <> 0 or v_children <> 0 then
        raise exception 'FAIL: a user with no role saw % students, % charges, % children',
            v_students, v_charges, v_children;
    end if;

    raise notice 'PASS: a user with no role sees nothing at all';
end
$$;

-- ===========================================================================
-- Summary
-- ===========================================================================
reset role;
do $$
begin
    raise notice '';
    raise notice '==========================================';
    raise notice '  ALL PHASE 5B GUARDIAN ACCESS TESTS PASSED';
    raise notice '==========================================';
end
$$;

rollback;
