-- =============================================================================
-- SRIK Phase 5 — school fees test suite
-- =============================================================================
-- One transaction, rolled back at the end, against a THROWAWAY database.
--
-- These tests exist to prove the rules that stop a school losing money or
-- losing a parent's trust:
--
--   * pressing Save twice does not take the money twice;
--   * a payment cannot be recorded without saying which charges it settles;
--   * the allocations must add up to the amount received;
--   * a charge cannot be paid more than it owes;
--   * one payment can settle several siblings' charges at once;
--   * a balance is derived, and a reversal puts it back exactly;
--   * a reversal must give a reason, and never deletes the original;
--   * a teacher cannot see or touch any of it;
--   * generating a month twice does not bill a family twice.
--
-- Requires the shim, then Phases 1 to 5 applied in order.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-c000-' || lpad(p_label, 12, '0'))::uuid;
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

-- Money compared to the sen. Comparing numeric directly is exact, but the
-- expected values are written as ringgit so the intent is readable.
create or replace function test_money_ok(p_actual numeric, p_expected numeric, p_label text)
returns void language plpgsql as $$
begin
    if p_actual is distinct from p_expected then
        raise exception 'FAIL: % expected %, got %', p_label, p_expected, p_actual;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p5@srik.test', now()),
    (test_id('3'), 'teacher.p5@srik.test', now()),
    (test_id('4'), 'clerk.p5@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'ADMIN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P5S1', 'Ahmad Zaki', 'ACTIVE'),
    (test_id('402'), 'P5S2', 'Nur Aisyah', 'ACTIVE'),
    (test_id('403'), 'P5S3', 'Umar Faruq', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('401'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('403'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

-- A family: one guardian for two siblings, so a shared payment can be tested.
insert into public.guardians (id, full_name, phone) values
    (test_id('501'), 'Encik Ahmad', '0123456789')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
    (test_id('401'), test_id('501'), 'FATHER', true),
    (test_id('402'), test_id('501'), 'FATHER', true)
on conflict do nothing;

-- The school's real fee list, with the amounts the owner gave.
insert into public.fee_types (id, code, name, default_amount, frequency, sort_order) values
    (test_id('700'), 'BULANAN', 'Yuran Bulanan', 150.00, 'MONTHLY', 1),
    (test_id('701'), 'PENDAFTARAN', 'Yuran Pendaftaran', 200.00, 'ONE_TIME', 2),
    (test_id('702'), 'PIBG', 'Yuran PIBG', 30.00, 'MONTHLY', 3)
on conflict (id) do nothing;

-- ===========================================================================
-- TEST 1: money is exact to the sen
-- ===========================================================================
do $$
declare
    v_charge public.student_charges;
begin
    reset role;
    -- A fee that would lose money as a float: 0.10 and 0.20.
    insert into public.fee_types (id, code, name, default_amount, frequency)
    values (test_id('703'), 'SEN', 'Yuran Sen', 0.30, 'ONE_TIME')
    on conflict (id) do nothing;

    insert into public.student_charges
        (id, student_id, fee_type_id, academic_year_id, amount)
    values (test_id('800'), test_id('401'), test_id('703'), test_id('900'), 0.30)
    on conflict (id) do nothing;

    -- A real payment row, because an allocation must belong to one.
    insert into public.payments (id, reference, amount, idempotency_key, method)
    values (test_id('900'), 'SEN-0001', 0.10, 'key-test-1', 'CASH')
    on conflict (id) do nothing;

    insert into public.payment_allocations (payment_id, student_charge_id, amount)
    values (test_id('900'), test_id('800'), 0.10)
    on conflict do nothing;

    -- 0.30 - 0.10 must be exactly 0.20, not 0.19999999999999998.
    perform test_money_ok(public.charge_balance(test_id('800')), 0.20::numeric,
                          'balance of a 30 sen charge with 10 sen paid');
    raise notice 'PASS: money is exact to the sen, with no floating point drift';
end
$$;

-- ===========================================================================
-- TEST 2: generating a month bills every active child once
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_result jsonb;
    v_count  integer;
begin
    v_result := public.generate_monthly_charges(test_id('900'), 2026::smallint, 3::smallint, null, '2026-03-01');

    -- Two monthly fees (Bulanan and PIBG) for three children.
    if (v_result->>'charges_created')::integer <> 6 then
        raise exception 'FAIL: expected 6 charges for March, got %', v_result->>'charges_created';
    end if;

    -- The one-off registration fee must NOT have been generated monthly.
    select count(*) into v_count
      from public.student_charges
     where fee_type_id = test_id('701') and period_month = 3;
    if v_count <> 0 then
        raise exception 'FAIL: a one-time fee was billed as a monthly one';
    end if;

    raise notice 'PASS: generating a month bills every active child for monthly fees only';
end
$$;

-- ===========================================================================
-- TEST 3: generating the same month twice does not bill twice
-- ===========================================================================
do $$
declare
    v_result jsonb;
    v_count  integer;
begin
    v_result := public.generate_monthly_charges(test_id('900'), 2026::smallint, 3::smallint, null, '2026-03-01');

    if (v_result->>'charges_created')::integer <> 0 then
        raise exception 'FAIL: a second run created % more charges',
            v_result->>'charges_created';
    end if;

    select count(*) into v_count
      from public.student_charges where period_year = 2026 and period_month = 3;
    if v_count <> 6 then
        raise exception 'FAIL: expected 6 charges still, found %', v_count;
    end if;

    raise notice 'PASS: re-running a month is a no-op, so nobody is billed twice';
end
$$;

-- ===========================================================================
-- TEST 4: the amounts are the school's real amounts, to the sen
-- ===========================================================================
do $$
declare
    v_monthly numeric;
    v_pibg    numeric;
begin
    select amount into v_monthly
      from public.student_charges
     where student_id = test_id('401') and fee_type_id = test_id('700')
       and period_month = 3;
    select amount into v_pibg
      from public.student_charges
     where student_id = test_id('401') and fee_type_id = test_id('702')
       and period_month = 3;

    perform test_money_ok(v_monthly, 150.00::numeric, 'monthly fee charged');
    perform test_money_ok(v_pibg, 30.00::numeric, 'PIBG fee charged');
    raise notice 'PASS: the charges carry the school''s real amounts';
end
$$;

-- ===========================================================================
-- TEST 5: a payment settles a charge, and the balance is derived
-- ===========================================================================
do $$
declare
    v_charge uuid;
    v_result jsonb;
    v_paid   numeric;
    v_status public.charge_status;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('401') and fee_type_id = test_id('700')
       and period_month = 3;

    v_result := public.record_payment(
        150.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 150.00)),
        'key-test-5',
        'RCPT-0001'
    );

    if (v_result->>'amount')::numeric <> 150.00 then
        raise exception 'FAIL: the payment amount was not stored as given';
    end if;

    perform test_money_ok(public.charge_paid_amount(v_charge), 150.00::numeric, 'amount paid');
    perform test_money_ok(public.charge_balance(v_charge), 0::numeric, 'balance after full payment');

    select status into v_status from public.student_charges where id = v_charge;
    if v_status <> 'PAID' then
        raise exception 'FAIL: a fully paid charge is marked %', v_status;
    end if;

    raise notice 'PASS: a payment settles a charge and the balance is derived from it';
end
$$;

-- ===========================================================================
-- TEST 6: THE RULE — pressing Save twice does not take the money twice
-- ===========================================================================
do $$
declare
    v_charge   uuid;
    v_first    jsonb;
    v_second   jsonb;
    v_payments integer;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('402') and fee_type_id = test_id('700')
       and period_month = 3;

    v_first := public.record_payment(
        150.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 150.00)),
        'key-test-6', 'RCPT-0002');

    -- The clerk's connection drops and they press Save again.
    v_second := public.record_payment(
        150.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 150.00)),
        'key-test-6', 'RCPT-0002');

    if (v_second->>'duplicate')::boolean is not true then
        raise exception 'FAIL: the second call was treated as a new payment';
    end if;
    if (v_second->>'payment_id')::uuid <> (v_first->>'payment_id')::uuid then
        raise exception 'FAIL: the second call created a different payment';
    end if;

    select count(*) into v_payments from public.payments where idempotency_key = 'key-test-6';
    if v_payments <> 1 then
        raise exception 'FAIL: % payments exist for one key', v_payments;
    end if;

    -- And the family was only charged once.
    perform test_money_ok(public.charge_paid_amount(v_charge), 150.00::numeric,
                          'paid after a double press');

    raise notice 'PASS: pressing Save twice returns the original payment and takes no more money';
end
$$;

-- ===========================================================================
-- TEST 7: a charge cannot be paid more than it owes
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('702')
       and period_month = 3;

    begin
        -- The PIBG fee is 30; paying 100 against it is a typo.
        perform public.record_payment(
            100.00,
            jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 100.00)),
            'key-test-7');
        raise exception 'FAIL: overpaying a charge was allowed'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a charge cannot be paid more than it still owes';
end
$$;

-- ===========================================================================
-- TEST 8: the allocations must add up to the amount received
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('702')
       and period_month = 3;

    begin
        -- 20 received but only 10 allocated: 10 ringgit would be unexplained.
        perform public.record_payment(
            20.00,
            jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 10.00)),
            'key-test-8');
        raise exception 'FAIL: a payment whose allocations did not add up was recorded'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    -- And nothing was written: the whole call is one transaction.
    if exists (select 1 from public.payments where idempotency_key = 'key-test-8') then
        raise exception 'FAIL: a refused payment left a row behind'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: a payment whose allocations do not add up is refused, and writes nothing';
end
$$;

-- ===========================================================================
-- TEST 9: a payment cannot be recorded without saying what it settles
-- ===========================================================================
do $$
begin
    begin
        perform public.record_payment(50.00, '[]'::jsonb, 'key-test-9');
        raise exception 'FAIL: a payment with no allocations was recorded'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a payment must say which charges it settles';
end
$$;

-- ===========================================================================
-- TEST 10: one payment settles several siblings' charges at once
-- ===========================================================================
do $$
declare
    v_c1   uuid;
    v_c2   uuid;
    v_res  jsonb;
begin
    -- The March monthly fee for both children of the same guardian.
    select id into v_c1 from public.student_charges
     where student_id = test_id('401') and fee_type_id = test_id('702')
       and period_month = 3;
    select id into v_c2 from public.student_charges
     where student_id = test_id('402') and fee_type_id = test_id('702')
       and period_month = 3;

    -- One parent pays 60 ringgit covering both children's PIBG fees.
    v_res := public.record_payment(
        60.00,
        jsonb_build_array(
            jsonb_build_object('charge_id', v_c1, 'amount', 30.00),
            jsonb_build_object('charge_id', v_c2, 'amount', 30.00)
        ),
        'key-test-10',
        'RCPT-FAMILY'
    );

    if (v_res->>'charges')::integer <> 2 then
        raise exception 'FAIL: the payment settled % charges, expected 2',
            v_res->>'charges';
    end if;

    perform test_money_ok(public.charge_balance(v_c1), 0::numeric, 'first sibling balance');
    perform test_money_ok(public.charge_balance(v_c2), 0::numeric, 'second sibling balance');

    raise notice 'PASS: one payment settles charges belonging to two siblings';
end
$$;

-- ===========================================================================
-- TEST 11: a part payment leaves the right balance and a PARTIAL status
-- ===========================================================================
do $$
declare
    v_charge uuid;
    v_status public.charge_status;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('700')
       and period_month = 3;

    perform public.record_payment(
        50.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 50.00)),
        'key-test-11');

    perform test_money_ok(public.charge_balance(v_charge), 100.00::numeric,
                          'balance after paying 50 of 150');

    select status into v_status from public.student_charges where id = v_charge;
    if v_status <> 'PARTIAL' then
        raise exception 'FAIL: a part-paid charge is marked %', v_status;
    end if;

    raise notice 'PASS: a part payment leaves a PARTIAL charge with the correct balance';
end
$$;

-- ===========================================================================
-- TEST 12: a discount reduces what is owed without inventing a payment
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    -- A fresh month, so the charge has nothing paid against it. Discounting a
    -- fully paid charge would leave the family having overpaid, which the
    -- database refuses (proved in the next test).
    perform public.generate_monthly_charges(test_id('900'), 2026::smallint, 6::smallint);

    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('702')
       and period_month = 6;

    perform test_money_ok(public.charge_balance(v_charge), 30.00::numeric,
                          'balance before the discount');

    perform public.set_charge_discount(v_charge, 10.00, 'Anak yatim');

    -- 30 charged, 10 waived, nothing paid: 20 still owed.
    perform test_money_ok(public.charge_balance(v_charge), 20.00::numeric,
                          'balance after a 10 ringgit discount');

    -- The discount must never be counted as money received.
    perform test_money_ok(public.charge_paid_amount(v_charge), 0::numeric,
                          'paid amount ignores the discount entirely');

    raise notice 'PASS: a discount lowers what is owed without inventing a payment';
end
$$;

-- ===========================================================================
-- TEST 12b: a discount cannot leave a paid charge overpaid
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    -- Give this charge a full payment, so a discount on top would put the
    -- family in credit for a fee the school has already taken.
    select id into v_charge from public.student_charges
     where student_id = test_id('402') and fee_type_id = test_id('700')
       and period_month = 6;

    perform public.record_payment(
        150.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 150.00)),
        'key-test-12b');

    begin
        perform public.set_charge_discount(v_charge, 50.00, 'cuba');
        raise exception 'FAIL: a discount left a fully paid charge overpaid'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a discount cannot leave a family having overpaid a charge';
end
$$;

-- ===========================================================================
-- TEST 13: THE RULE — a reversal puts the balance back exactly
-- ===========================================================================
do $$
declare
    v_charge   uuid;
    v_payment  uuid;
    v_res      jsonb;
    v_status   public.charge_status;
    v_original record;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('700')
       and period_month = 3;
    select id into v_payment from public.payments where idempotency_key = 'key-test-11';

    perform test_money_ok(public.charge_balance(v_charge), 100.00::numeric,
                          'balance before the reversal');

    v_res := public.reverse_payment(v_payment, 'Duit dimasukkan ke akaun salah');

    -- The balance returns to exactly what it was before the payment.
    perform test_money_ok(public.charge_balance(v_charge), 150.00::numeric,
                          'balance after the reversal');
    perform test_money_ok(public.charge_paid_amount(v_charge), 0::numeric,
                          'paid amount after the reversal');

    select status into v_status from public.student_charges where id = v_charge;
    if v_status <> 'OUTSTANDING' then
        raise exception 'FAIL: the charge is % after reversing its payment', v_status;
    end if;

    -- The original must still exist, marked reversed. A school that can delete
    -- a receipt cannot prove what it received.
    select * into v_original from public.payments where id = v_payment;
    if v_original.status <> 'REVERSED' then
        raise exception 'FAIL: the original payment is % after reversal', v_original.status;
    end if;
    if v_original.reversed_by_id is null then
        raise exception 'FAIL: the original does not point at its reversal';
    end if;
    if v_original.reversal_reason is null then
        raise exception 'FAIL: the reversal recorded no reason';
    end if;

    raise notice 'PASS: a reversal restores the balance exactly and keeps the original on file';
end
$$;

-- ===========================================================================
-- TEST 14: a reversal must give a reason
-- ===========================================================================
do $$
declare
    v_charge  uuid;
    v_payment uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('700')
       and period_month = 6;
    perform public.record_payment(
        20.00,
        jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 20.00)),
        'key-test-14');
    select id into v_payment from public.payments where idempotency_key = 'key-test-14';

    begin
        perform public.reverse_payment(v_payment, '');
        raise exception 'FAIL: a reversal with no reason was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a reversal must state a reason';
end
$$;

-- ===========================================================================
-- TEST 15: a payment cannot be reversed twice
-- ===========================================================================
do $$
declare
    v_payment uuid;
begin
    select id into v_payment from public.payments where idempotency_key = 'key-test-11';

    begin
        perform public.reverse_payment(v_payment, 'again');
        raise exception 'FAIL: an already-reversed payment was reversed again'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a payment cannot be reversed twice';
end
$$;

-- ===========================================================================
-- TEST 16: a waived charge is not owed, and cannot then be paid
-- ===========================================================================
do $$
declare
    v_charge uuid;
    v_status public.charge_status;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('401') and fee_type_id = test_id('702')
       and period_month = 3;

    -- Give it back first: it was paid by the family payment in test 10.
    perform public.reverse_payment(
        (select id from public.payments where idempotency_key = 'key-test-10'),
        'Ujian: batalkan bayaran keluarga');

    perform public.set_charge_status(v_charge, 'WAIVED', 'Ibu bapa tunggal');

    select status into v_status from public.student_charges where id = v_charge;
    if v_status <> 'WAIVED' then
        raise exception 'FAIL: the charge is % after being waived', v_status;
    end if;

    begin
        perform public.record_payment(
            30.00,
            jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount', 30.00)),
            'key-test-16');
        raise exception 'FAIL: a waived charge was paid'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a waived charge is not owed and cannot then be paid';
end
$$;

-- ===========================================================================
-- TEST 17: waiving must give a reason
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('702')
       and period_month = 3;

    begin
        perform public.set_charge_status(v_charge, 'CANCELLED', '');
        raise exception 'FAIL: a cancellation with no reason was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: waiving or cancelling a charge must state a reason';
end
$$;

-- ===========================================================================
-- TEST 18: a charge with money against it cannot be waived
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('402') and fee_type_id = test_id('700')
       and period_month = 3;

    begin
        perform public.set_charge_status(v_charge, 'WAIVED', 'cuba-cuba');
        raise exception 'FAIL: a charge with a payment against it was waived'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a charge that has been paid against cannot be waived';
end
$$;

-- ===========================================================================
-- TEST 19: the family balance covers every sibling
-- ===========================================================================
do $$
declare
    v_balance jsonb;
    v_children integer;
begin
    v_balance := public.family_balance(test_id('401'));

    v_children := (v_balance->>'children')::integer;
    if v_children <> 2 then
        raise exception 'FAIL: the family balance counted % children, expected 2', v_children;
    end if;

    -- Charged minus paid must equal the outstanding figure, always.
    if (v_balance->>'charged')::numeric - (v_balance->>'paid')::numeric
       <> (v_balance->>'outstanding')::numeric then
        raise exception 'FAIL: the family balance does not add up: %', v_balance;
    end if;

    raise notice 'PASS: the family balance covers every sibling and always adds up';
end
$$;

-- ===========================================================================
-- TEST 20: THE RULE — a teacher can see none of this
-- ===========================================================================
select test_as(test_id('3'));   -- TEACHER

do $$
declare
    v_charges integer;
    v_payments integer;
    v_fees integer;
begin
    select count(*) into v_charges from public.student_charges;
    select count(*) into v_payments from public.payments;
    select count(*) into v_fees from public.fee_types;

    if v_charges <> 0 or v_payments <> 0 or v_fees <> 0 then
        raise exception 'FAIL: a teacher saw % charges, % payments, % fees',
            v_charges, v_payments, v_fees;
    end if;

    -- And they cannot record one either.
    begin
        perform public.record_payment(10.00, '[{}]'::jsonb, 'teacher-key');
        raise exception 'FAIL: a teacher recorded a payment'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        perform public.generate_monthly_charges(test_id('900'), 2026::smallint, 4::smallint);
        raise exception 'FAIL: a teacher generated fees'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a teacher can neither see nor touch any part of the school''s money';
end
$$;

-- ===========================================================================
-- TEST 21: the office can read them
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_charges integer;
begin
    select count(*) into v_charges from public.student_charges;
    if v_charges = 0 then
        raise exception 'FAIL: the office could not see the charges';
    end if;
    raise notice 'PASS: the office can see the charges';
end
$$;

-- ===========================================================================
-- TEST 22: a payment with no idempotency key is refused
-- ===========================================================================
do $$
begin
    begin
        perform public.record_payment(10.00, jsonb_build_array(jsonb_build_object('charge_id', test_id('800'), 'amount', 0.10)), '');
        raise exception 'FAIL: a payment with no idempotency key was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: every payment needs a key, so a double press is always safe';
end
$$;

-- ===========================================================================
-- TEST 23: a payment of zero or less is refused
-- ===========================================================================
do $$
begin
    begin
        perform public.record_payment(0, jsonb_build_array(jsonb_build_object('charge_id', test_id('800'), 'amount', 0.10)), 'zero-key');
        raise exception 'FAIL: a zero payment was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    begin
        perform public.record_payment(-50, jsonb_build_array(jsonb_build_object('charge_id', test_id('800'), 'amount', 0.10)), 'neg-key');
        raise exception 'FAIL: a negative payment was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a payment must be greater than zero';
end
$$;

-- ===========================================================================
-- TEST 24: a discount cannot exceed the charge
-- ===========================================================================
do $$
declare
    v_charge uuid;
begin
    select id into v_charge from public.student_charges
     where student_id = test_id('403') and fee_type_id = test_id('702')
       and period_month = 3;

    begin
        perform public.set_charge_discount(v_charge, 500.00, 'terlalu banyak');
        raise exception 'FAIL: a discount larger than the charge was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a discount cannot be more than the charge itself';
end
$$;

-- ===========================================================================
-- TEST 25: every money movement is audited
-- ===========================================================================
do $$
declare
    v_pay  integer;
    v_rev  integer;
    v_gen  integer;
    v_disc integer;
begin
    select count(*) into v_pay  from public.authorization_audit where action = 'PAYMENT_RECORDED';
    select count(*) into v_rev  from public.authorization_audit where action = 'PAYMENT_REVERSED';
    select count(*) into v_gen  from public.authorization_audit where action = 'FEES_GENERATED';
    select count(*) into v_disc from public.authorization_audit where action = 'CHARGE_DISCOUNT_SET';

    if v_pay = 0 or v_rev = 0 or v_gen = 0 or v_disc = 0 then
        raise exception 'FAIL: something moved money without an audit record (pay=%, rev=%, gen=%, disc=%)',
            v_pay, v_rev, v_gen, v_disc;
    end if;

    raise notice 'PASS: generating fees, taking money, reversing it and discounting are all audited';
end
$$;

-- ===========================================================================
-- TEST 26: RLS is on and forced for every finance table
-- ===========================================================================
do $$
declare
    v_missing text;
begin
    select string_agg(c.relname, ', ') into v_missing
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname in ('fee_types', 'student_charges', 'payments', 'payment_allocations')
       and not (c.relrowsecurity and c.relforcerowsecurity);

    if v_missing is not null then
        raise exception 'FAIL: RLS is not enabled and forced on: %', v_missing;
    end if;

    raise notice 'PASS: RLS is enabled and forced on all four finance tables';
end
$$;

-- ===========================================================================
-- TEST 27: payments cannot be written from a screen at all
-- ===========================================================================
do $$
declare
    v_ok boolean;
begin
    select has_table_privilege('authenticated', 'public.payments', 'INSERT') into v_ok;
    if v_ok then
        raise exception 'FAIL: authenticated can insert a payment directly'
            using errcode = 'raise_exception';
    end if;

    select has_table_privilege('authenticated', 'public.payments', 'UPDATE') into v_ok;
    if v_ok then
        raise exception 'FAIL: authenticated can update a payment directly, bypassing the audit trail'
            using errcode = 'raise_exception';
    end if;

    select has_table_privilege('authenticated', 'public.payment_allocations', 'INSERT') into v_ok;
    if v_ok then
        raise exception 'FAIL: authenticated can insert an allocation directly'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: payments and allocations can only be written through the audited functions';
end
$$;

-- ===========================================================================
-- TEST 28: a null-priced fee is not billed
-- ===========================================================================
do $$
declare
    v_count integer;
begin
    insert into public.fee_types (id, code, name, default_amount, frequency)
    values (test_id('704'), 'TIADA', 'Yuran Belum Diputuskan', null, 'MONTHLY')
    on conflict (id) do nothing;

    perform public.generate_monthly_charges(test_id('900'), 2026::smallint, 5::smallint);

    select count(*) into v_count from public.student_charges
     where fee_type_id = test_id('704');
    if v_count <> 0 then
        raise exception 'FAIL: a fee with no price was billed at % charges', v_count;
    end if;

    raise notice 'PASS: a fee with no price is not billed at all';
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
    raise notice '  ALL PHASE 5 SCHOOL FEE TESTS PASSED';
    raise notice '==========================================';
end
$$;

rollback;
