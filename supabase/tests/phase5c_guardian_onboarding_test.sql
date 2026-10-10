-- =============================================================================
-- SRIK Phase 5c — giving a parent an account
-- =============================================================================
-- One transaction, rolled back at the end, against a THROWAWAY database.
--
-- These tests exist because this is the one place in the system that writes to
-- `auth.users` directly. A mistake here does not merely show wrong data: it can
-- create a login that reaches a child's records.
--
-- The rules proved below:
--   * the password is hashed, never stored, and a wrong password does not match;
--   * the account is always GUARDIAN, never staff;
--   * an account without a linked child sees nothing, not everyone;
--   * unlinking a child removes access at once;
--   * a duplicate email, a short password, a missing reason and a malformed
--     email are all refused.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e000-' || lpad(p_label, 12, '0'))::uuid;
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
-- Fixtures
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p5c@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code)
values (test_id('1'), 'ADMIN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P5C-A', 'Anak Keluarga A', 'ACTIVE'),
    (test_id('402'), 'P5C-B', 'Anak Keluarga B', 'ACTIVE')
on conflict (id) do nothing;

insert into public.guardians (id, full_name, phone) values
    (test_id('501'), 'Bapa Keluarga A', '0111111111'),
    (test_id('502'), 'Bapa Keluarga B', '0222222222')
on conflict (id) do nothing;

insert into public.fee_types (id, code, name, default_amount, frequency)
values (test_id('700'), 'BULANAN', 'Yuran Bulanan', 150.00, 'MONTHLY')
on conflict (id) do nothing;

insert into public.student_charges
    (id, student_id, fee_type_id, academic_year_id, period_month, period_year, amount)
values (test_id('800'), test_id('401'), test_id('700'), test_id('900'), 3, 2026, 150.00)
on conflict (id) do nothing;

-- ===========================================================================
-- TEST 1: an account is created, and the password is hashed
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_result jsonb;
    v_uid    uuid;
begin
    v_result := public.create_guardian_account(
        test_id('501'), 'bapa.a@srik.test', 'KataLaluan#2026', 'Ibu bapa baharu');
    v_uid := (v_result->>'user_id')::uuid;

    if v_uid is null then
        raise exception 'FAIL: no account was created';
    end if;

    -- The stored value must be a hash that verifies the password, and must not
    -- be the password itself. Storing it in clear text would be a breach the
    -- moment the table was read.
    if not exists (
        select 1 from auth.users
         where id = v_uid
           and encrypted_password = extensions.crypt('KataLaluan#2026', encrypted_password)
    ) then
        raise exception 'FAIL: the stored password does not verify';
    end if;

    if exists (select 1 from auth.users where id = v_uid and encrypted_password = 'KataLaluan#2026') then
        raise exception 'FAIL: the password was stored in clear text';
    end if;

    raise notice 'PASS: an account is created and the password is stored only as a hash';
end
$$;

-- ===========================================================================
-- TEST 2: a wrong password does not verify
-- ===========================================================================
do $$
declare
    v_uid uuid;
begin
    select user_id into v_uid from public.guardians where id = test_id('501');

    if exists (
        select 1 from auth.users
         where id = v_uid
           and encrypted_password = extensions.crypt('kata-laluan-salah', encrypted_password)
    ) then
        raise exception 'FAIL: a wrong password verified';
    end if;

    raise notice 'PASS: a wrong password does not match the stored hash';
end
$$;

-- ===========================================================================
-- TEST 3: THE RULE — the account is a GUARDIAN, never staff
-- ===========================================================================
do $$
declare
    v_uid   uuid;
    v_roles text;
begin
    select user_id into v_uid from public.guardians where id = test_id('501');

    select string_agg(role_code, ',' order by role_code) into v_roles
      from public.user_roles where user_id = v_uid;

    if v_roles <> 'GUARDIAN' then
        raise exception 'FAIL: a parent''s account has roles: %', v_roles;
    end if;

    if exists (select 1 from public.user_roles where user_id = v_uid and role_code in ('ADMIN', 'TEACHER')) then
        raise exception 'FAIL: a parent''s account also holds a staff role';
    end if;

    raise notice 'PASS: a parent''s account is a GUARDIAN and never staff';
end
$$;

-- ===========================================================================
-- TEST 4: THE RULE — an account with no child linked sees nothing
-- ===========================================================================
do $$
declare
    v_uid      uuid;
    v_students integer;
    v_charges  integer;
    v_children integer;
begin
    select user_id into v_uid from public.guardians where id = test_id('501');

    perform test_as(v_uid);

    select count(*) into v_students from public.students;
    select count(*) into v_charges from public.student_charges;
    select coalesce(array_length(public.current_guardian_child_ids(), 1), 0) into v_children;

    if v_students <> 0 or v_charges <> 0 or v_children <> 0 then
        raise exception 'FAIL: a parent with no linked child saw % students, % charges, % children',
            v_students, v_charges, v_children;
    end if;

    raise notice 'PASS: an account with no child linked sees nothing, not everyone';
end
$$;

-- ===========================================================================
-- TEST 5: linking a child gives access to that child only
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_uid      uuid;
    v_students integer;
begin
    perform public.set_guardian_child_link(
        test_id('501'), test_id('401'), true, 'FATHER', 'Sahkan bapa');

    select user_id into v_uid from public.guardians where id = test_id('501');
    perform test_as(v_uid);

    select count(*) into v_students from public.students;
    if v_students <> 1 then
        raise exception 'FAIL: a linked parent sees % children, expected 1', v_students;
    end if;

    raise notice 'PASS: a linked parent sees their own child and no other';
end
$$;

-- ===========================================================================
-- TEST 6: a linked parent can read their own child's balance
-- ===========================================================================
do $$
declare
    v_balance numeric;
begin
    v_balance := public.charge_balance(test_id('800'));
    if v_balance <> 150.00 then
        raise exception 'FAIL: the parent read a balance of %, expected 150.00', v_balance;
    end if;
    raise notice 'PASS: a linked parent can read their own child''s balance';
end
$$;

-- ===========================================================================
-- TEST 7: THE RULE — unlinking removes access immediately
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_uid      uuid;
    v_students integer;
    v_charges  integer;
begin
    perform public.set_guardian_child_link(
        test_id('501'), test_id('401'), false, 'FATHER', 'Keluarga berpindah');

    select user_id into v_uid from public.guardians where id = test_id('501');
    perform test_as(v_uid);

    select count(*) into v_students from public.students;
    select count(*) into v_charges from public.student_charges;

    if v_students <> 0 or v_charges <> 0 then
        raise exception 'FAIL: an unlinked parent still sees % students and % charges',
            v_students, v_charges;
    end if;

    raise notice 'PASS: unlinking a child removes access at once, with nothing cached';
end
$$;

-- ===========================================================================
-- TEST 8: THE RULE — the office's list still shows everything
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_rows integer;
begin
    select count(*) into v_rows from public.list_guardians_with_children();
    if v_rows < 2 then
        raise exception 'FAIL: the office sees only % guardians', v_rows;
    end if;
    raise notice 'PASS: the office still sees every guardian';
end
$$;

-- ===========================================================================
-- TEST 9: the list reports whether a parent can log in
-- ===========================================================================
do $$
declare
    v_has_login boolean;
    v_children  bigint;
begin
    select has_login, child_count into v_has_login, v_children
      from public.list_guardians_with_children() where guardian_id = test_id('501');

    if not v_has_login then
        raise exception 'FAIL: the guardian has a login but the list says otherwise';
    end if;
    -- The link was removed in test 7, so the count must be zero.
    if v_children <> 0 then
        raise exception 'FAIL: the list still reports % children after unlinking', v_children;
    end if;

    select has_login into v_has_login
      from public.list_guardians_with_children() where guardian_id = test_id('502');
    if v_has_login then
        raise exception 'FAIL: a guardian with no account is reported as having one';
    end if;

    raise notice 'PASS: the list says truthfully who can log in';
end
$$;

-- ===========================================================================
-- TEST 10: a duplicate email is refused
-- ===========================================================================
do $$
begin
    begin
        perform public.create_guardian_account(
            test_id('502'), 'bapa.a@srik.test', 'KataLaluan#2026', 'Cuba');
        raise exception 'FAIL: a duplicate email was accepted'
            using errcode = 'raise_exception';
    exception
        when unique_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a duplicate email is refused';
end
$$;

-- ===========================================================================
-- TEST 11: a short password is refused
-- ===========================================================================
do $$
begin
    begin
        perform public.create_guardian_account(test_id('502'), 'bapa.b@srik.test', '123', 'Cuba');
        raise exception 'FAIL: a short password was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a password shorter than 8 characters is refused';
end
$$;

-- ===========================================================================
-- TEST 12: creating an account must state a reason
-- ===========================================================================
do $$
begin
    begin
        perform public.create_guardian_account(test_id('502'), 'bapa.b@srik.test', 'KataLaluan#2026', '');
        raise exception 'FAIL: an account was created with no reason'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: creating an account must state a reason';
end
$$;

-- ===========================================================================
-- TEST 13: a malformed email is refused
-- ===========================================================================
do $$
begin
    begin
        perform public.create_guardian_account(test_id('502'), 'bukan-emel', 'KataLaluan#2026', 'Cuba');
        raise exception 'FAIL: a malformed email was accepted'
            using errcode = 'raise_exception';
    exception
        when invalid_parameter_value then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a malformed email is refused';
end
$$;

-- ===========================================================================
-- TEST 14: one guardian cannot be given two logins
-- ===========================================================================
do $$
begin
    begin
        perform public.create_guardian_account(
            test_id('501'), 'kedua@srik.test', 'KataLaluan#2026', 'Cuba');
        raise exception 'FAIL: a second login was created for the same guardian'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a guardian cannot be given two logins';
end
$$;

-- ===========================================================================
-- TEST 15: a teacher cannot create an account
-- ===========================================================================
reset role;
insert into auth.users (id, email, email_confirmed_at)
values (test_id('3'), 'guru.p5c@srik.test', now())
on conflict (id) do nothing;
insert into public.user_roles (user_id, role_code)
values (test_id('3'), 'TEACHER')
on conflict do nothing;

select test_as(test_id('3'));

do $$
begin
    begin
        perform public.create_guardian_account(
            test_id('502'), 'curi@srik.test', 'KataLaluan#2026', 'Cuba');
        raise exception 'FAIL: a teacher created an account'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a teacher cannot create a login';
end
$$;

-- ===========================================================================
-- TEST 16: every account action is audited
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_created integer;
    v_linked  integer;
    v_unlink  integer;
begin
    select count(*) into v_created from public.authorization_audit
     where action = 'GUARDIAN_ACCOUNT_CREATED';
    select count(*) into v_linked from public.authorization_audit
     where action = 'GUARDIAN_CHILD_LINKED';
    select count(*) into v_unlink from public.authorization_audit
     where action = 'GUARDIAN_CHILD_UNLINKED';

    if v_created = 0 or v_linked = 0 or v_unlink = 0 then
        raise exception 'FAIL: an account action was not audited (created=%, linked=%, unlinked=%)',
            v_created, v_linked, v_unlink;
    end if;

    raise notice 'PASS: creating, linking and unlinking are all audited';
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
    raise notice '  ALL PHASE 5C GUARDIAN ONBOARDING TESTS PASSED';
    raise notice '==========================================';
end
$$;

rollback;
