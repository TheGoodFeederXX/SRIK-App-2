-- ===========================================================================
-- Security hardening test — the anonymous RPC holes must stay closed
-- ===========================================================================
-- Guards audit findings F01, F02 and F03.
--
-- WHY THESE TESTS EXIST IN THIS SHAPE.
--
-- Every one of these bugs was invisible from the application's side. The app
-- never tried to call `build_report_snapshot` without logging in, so nothing in
-- the UI broke and no unit test moved. The functions were simply reachable by
-- anybody with a URL, and the only way to see that is to ask the database what
-- it will ACCEPT — which is what this suite does.
--
-- The tests therefore assert on capability, not on behaviour: not "does
-- recording attendance work" but "can an anonymous caller do it at all".
--
-- WHY `anon` AND NOT A FAKE CLAIM.
--
-- The rest of the suite uses `test_as(...)` to impersonate a signed-in user by
-- setting `request.jwt.claims`. That is the wrong tool here: the bug is
-- specifically about a request with NO identity, so the test drops to the `anon`
-- role directly and asserts that the call is REFUSED. If the function is
-- reachable, the expectation fails — which is the point.
--
-- EVERY GUARDED CHECK USES raise_exception, so a failure aborts the transaction
-- instead of being printed and ignored.

-- The harness helpers (test_id, test_as) are created INSIDE each phase suite's
-- transaction, and every one of those suites ends in `rollback` — so by the time
-- this file runs, they no longer exist. This suite therefore defines its own,
-- with the same UUID convention (...-a000-...) so the ids mean the same thing.
create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-a000-' || lpad(p_label, 12, '0'))::uuid;
$$;

-- Act as a given user. auth.uid() reads the JSON `request.jwt.claims` blob, not
-- the dot-separated setting; the wrong one leaves auth.uid() NULL and every
-- policy denies, which would look like a passing security test.
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

-- MOSTLY NO FIXTURES, and that is still the point for the refusal checks: the
-- property under test is what the database ACCEPTS, which is true regardless of
-- which rows exist. That is what makes those checks meaningful on a live database
-- as well as in CI.
--
-- BUT "no fixtures" IS NOT ENOUGH FOR THE ALLOWED CASE, and this file was wrong
-- about that. `is_active_user()` reads `profiles.status`, and the phase suites
-- never create profile rows — they call `test_as` with ids that have an
-- `auth.users` entry and nothing else. So for every user these tests act as,
-- `is_active_user()` was FALSE, every `has_permission` was false, and a check that
-- asserted "this is refused" was passing for the wrong reason.
--
-- It surfaced the moment the ADMIN half of F01 was added: the admin was refused,
-- correctly and for an unrelated reason. A refusal that happens because the test's
-- own user is not real is not evidence of a security property.

begin;

-- Fixtures for the ALLOWED case only: an ACTIVE administrator, and a class the
-- admin does not teach, so passing proves the exemption rather than an assignment.
--
-- The `auth.users` row is required, not decorative: `profiles.id` is a foreign key
-- to it. The phase suites create their own user rows and roll back, so this suite
-- must create the one it depends on.
insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.hardening@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
    (test_id('1'), 'Pentadbir Ujian Keselamatan', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN')
on conflict do nothing;

-- A second account holding NO finance permission, for the checks that assert a
-- signed-in user is refused. It has to be a DIFFERENT id from the admin: `test_id('1')`
-- now legitimately passes those checks, and using it made the refusal test fail —
-- correctly, because the premise (this user should be refused) was no longer true.
insert into auth.users (id, email, email_confirmed_at) values
    (test_id('2'), 'guru.hardening@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
    (test_id('2'), 'Guru Ujian Keselamatan', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.user_roles (user_id, role_code) values
    (test_id('2'), 'TEACHER')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code, status)
values (test_id('700'), test_id('900'), 1, '1 Al-Junaidi', '1J', 'ACTIVE')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, gender, status)
values (test_id('401'), 'H-001', 'Murid Ujian Keselamatan', 'MALE', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.student_enrollments
    (id, student_id, class_id, academic_year_id, enrolled_at, status)
values (test_id('501'), test_id('401'), test_id('700'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

-- ---------------------------------------------------------------------------
-- F01 — record_class_attendance must refuse an anonymous caller
-- ---------------------------------------------------------------------------
-- The original defect: the permission check lived inside `if p_recorded_by is
-- null`, so supplying the parameter skipped it. The bypass below is exactly the
-- audit's reproduction — no logged-in user, a synthetic actor supplied.
do $$
declare
    v_blocked boolean := false;
begin
    set local role anon;
    begin
        perform public.record_class_attendance(
            '00000000-0000-4000-a000-000000000001'::uuid,
            '2026-03-01'::date,
            '[{"student_id":"00000000-0000-4000-a000-000000000002","status":"PRESENT"}]'::jsonb,
            '00000000-0000-4000-a000-000000000003'::uuid  -- the impersonated actor
        );
    exception when others then
        v_blocked := true;
    end;
    reset role;
    set local role authenticated;

    if not v_blocked then
        raise exception
            'FAIL F01: an anonymous caller recorded attendance by supplying p_recorded_by'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS F01: anonymous attendance recording is refused';
end
$$;

-- The mirror image: the parameter must also not let a SIGNED-IN user attribute
-- work to somebody else. Refusing anonymous callers alone would still leave a
-- logged-in teacher able to write records under another person's name.
do $$
declare
    v_blocked boolean := false;
begin
    perform test_as(test_id('1'));
    begin
        perform public.record_class_attendance(
            '00000000-0000-4000-a000-000000000001'::uuid,
            '2026-03-01'::date,
            '[{"student_id":"00000000-0000-4000-a000-000000000002","status":"PRESENT"}]'::jsonb,
            test_id('2')  -- a different user
        );
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F01: a teacher attributed attendance to another user via p_recorded_by'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS F01: attendance cannot be attributed to another user';
end
$$;

-- ---------------------------------------------------------------------------
-- F01, THE OTHER HALF: an ADMIN must STILL be able to record attendance.
--
-- This test exists because its absence hid a bug in the FIRST version of the F01
-- fix. That version gated the class-scope check on `has_permission('admin.access')`
-- — a permission that does not exist (ADMIN holds 39, and that is not one of them)
-- — so the exemption never fired and EVERY administrator was refused. The suite
-- passed, because it only proved a teacher is refused, which the broken version
-- also did.
--
-- The lesson is general and worth more than the finding: proving the defect is
-- closed says nothing about whether the legitimate path still works. A guard test
-- that never exercises the allowed case can certify a fix that breaks the product.
-- ---------------------------------------------------------------------------
do $$
declare
    v_blocked boolean := false;
begin
    perform test_as(test_id('1'));  -- ADMIN, holding no assignment for this class
    begin
        perform public.record_class_attendance(
            test_id('700'),
            '2026-03-09'::date,
            jsonb_build_array(
                jsonb_build_object('student_id', test_id('401'), 'status', 'PRESENT')
            )
        );
    exception when insufficient_privilege then
        v_blocked := true;
    end;

    if v_blocked then
        raise exception
            'FAIL F01: an ADMIN was refused attendance for a class they do not teach'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS F01: an admin can record attendance for any class';
end
$$;

-- ---------------------------------------------------------------------------
-- F02 — build_report_snapshot must not be reachable by any API role
-- ---------------------------------------------------------------------------
-- Revoked from anon, authenticated and public. A signed-in user must not be able
-- to reach it either: it assembles the snapshot with the owner's rights and
-- performs no checks of its own, so anyone who reaches it reads any pupil's
-- report. The safe path is `publish_report_card`, which checks first.
do $$
declare
    v_blocked boolean := false;
begin
    set local role anon;
    begin
        perform public.build_report_snapshot(
            '00000000-0000-4000-a000-000000000002'::uuid,
            '00000000-0000-4000-a000-000000000004'::uuid
        );
    exception when others then
        v_blocked := true;
    end;
    reset role;
    set local role authenticated;

    if not v_blocked then
        raise exception
            'FAIL F02: an anonymous caller read a report snapshot'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS F02: anonymous report snapshot reading is refused';
end
$$;

do $$
declare
    v_blocked boolean := false;
begin
    perform test_as(test_id('1'));
    begin
        perform public.build_report_snapshot(
            '00000000-0000-4000-a000-000000000002'::uuid,
            '00000000-0000-4000-a000-000000000004'::uuid
        );
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F02: a plain teacher reached the internal snapshot builder'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS F02: the snapshot builder is not reachable by a teacher';
end
$$;

-- ---------------------------------------------------------------------------
-- F03 — the finance helpers must not be reachable from the API
-- ---------------------------------------------------------------------------
-- `charge_balance` leaked a family's balance to anyone holding a charge id, and
-- `refresh_charge_status` performed an UPDATE as the owner. Neither checks the
-- caller, and both were granted to `authenticated` as well as anon — so both
-- roles are tested.
-- Diagnostic: report the actual privilege state before asserting, so a failure
-- says WHICH role still has access rather than only that something does.
do $$
declare
    v_fn text;
begin
    foreach v_fn in array array['charge_balance','charge_paid_amount','refresh_charge_status']
    loop
        raise notice 'PRIV % anon=% auth=% public=%',
            v_fn,
            has_function_privilege('anon', 'public.' || v_fn || '(uuid)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.' || v_fn || '(uuid)', 'EXECUTE'),
            has_function_privilege('public', 'public.' || v_fn || '(uuid)', 'EXECUTE');
    end loop;
end
$$;

do $$
declare
    v_fn text;
    v_blocked boolean;
begin
    foreach v_fn in array array['charge_balance', 'charge_paid_amount', 'refresh_charge_status']
    loop
        -- anonymous
        v_blocked := false;
        set local role anon;
        begin
            execute format('select public.%I(%L::uuid)', v_fn, '00000000-0000-4000-a000-000000000005');
        exception when others then
            v_blocked := true;
        end;
        reset role;
        set local role authenticated;

        if not v_blocked then
            raise exception 'FAIL F03: anonymous caller reached %', v_fn
                using errcode = 'raise_exception';
        end if;

        -- signed in
        v_blocked := false;
        -- The unprivileged account, NOT the admin: see the fixture note above.
        perform test_as(test_id('2'));
        begin
            execute format('select public.%I(%L::uuid)', v_fn, '00000000-0000-4000-a000-000000000005');
        exception when others then
            v_blocked := true;
        end;

        if not v_blocked then
            raise exception 'FAIL F03: a signed-in teacher reached %', v_fn
                using errcode = 'raise_exception';
        end if;
    end loop;

    raise notice 'PASS F03: the internal finance helpers are unreachable from the API';
end
$$;

-- ---------------------------------------------------------------------------
-- The general rule — every permission a function tests must EXIST.
--
-- Added after a permission that does not exist caused a real, invisible failure:
-- `record_class_attendance` tested one to exempt administrators from the class
-- scope, so the exemption never fired and every admin was refused. `has_permission`
-- returning false is indistinguishable from a legitimate "no", which is what made
-- it quiet — and `has_role`-style helpers have the same shape of risk.
--
-- A catalogue scan is the only check that covers functions nobody has written yet.
-- ---------------------------------------------------------------------------
do $$
declare
    v_missing text;
begin
    select string_agg(distinct d.perm, ', ') into v_missing
    from (
        select m[1] as perm
          from pg_proc p
          cross join lateral regexp_matches(
              pg_get_functiondef(p.oid), 'has_permission\(''([a-z_.]+)''\)', 'g'
          ) as m
         where p.prosecdef
    ) d
    where not exists (select 1 from public.permissions pe where pe.code = d.perm);

    if v_missing is not null then
        raise exception
            'These functions test permissions that do not exist: %', v_missing
            using errcode = 'insufficient_privilege';
    end if;
    raise notice 'PASS: every permission tested by a function exists';
end
$$;

-- ---------------------------------------------------------------------------
-- The general rule — no definer function is callable without a login
-- ---------------------------------------------------------------------------
-- Checked against the catalogue rather than a list, so a function added later
-- cannot quietly reintroduce the exposure. `has_permission` is exempt: RLS
-- policies invoke it on behalf of the querying role, and revoking it would deny
-- every policy.
do $$
declare
    v_leak text;
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
            'FAIL: these security definer functions are still callable without a login: %', v_leak
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: no definer function is callable without a JWT';
end
$$;

rollback;
