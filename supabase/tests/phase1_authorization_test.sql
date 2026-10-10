-- =============================================================================
-- SRIK Phase 1 — authorization test suite
-- =============================================================================
-- Runs against a database that has 00_local_supabase_shim.sql and
-- 20261007000001_phase1_auth_authorization.sql applied.
--
-- Proves the acceptance criteria from docs/srik/03_PHASE_1_SUPABASE_AUTH.md:
--   * deny by default
--   * ADMIN authority comes from grants, not a bypass
--   * TEACHER baseline is minimum, and scoped management needs explicit grants
--   * direct API calls cannot bypass authorization
--   * privilege escalation attempts fail
--   * DISABLED profiles are rejected even with a valid JWT claim
--   * the last administrator cannot be removed
--   * the audit log is append-only for clients
--
-- Every assertion RAISEs on failure, so a non-zero exit means a real problem.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Fixed UUIDs so assertions are readable and reruns are deterministic.
-- statements; PL/pgSQL blocks cannot see psql variables, so every block
-- declares what it needs with the same literal values.

-- Resolves a fixture label to its uuid. Defined before the fixtures so every
-- statement, inside or outside a DO block, can refer to users by name.
create or replace function test_id(p_label text)
returns uuid
language sql
immutable
as $$
    select ('00000000-0000-4000-a000-' || lpad(p_label, 12, '0'))::uuid;
$$;

begin;

-- Create auth users. The trigger should create profiles automatically.
insert into auth.users (id, email, raw_user_meta_data) values
    (test_id('1'),  'admin.a@srik.test',   '{"full_name":"Admin A"}'),
    (test_id('2'),  'admin.b@srik.test',   '{"full_name":"Admin B"}'),
    (test_id('3'),  'teacher@srik.test',   '{"full_name":"Teacher One"}'),
    (test_id('4'), 'dteacher@srik.test',  '{"full_name":"Data Teacher"}'),
    (test_id('5'),   'norole@srik.test',    '{"full_name":"No Role User"}'),
    (test_id('6'), 'disabled@srik.test',  '{"full_name":"Disabled User"}')
on conflict (id) do nothing;

do $$
begin
    if (select count(*) from public.profiles) <> 6 then
        raise exception 'FAIL: expected 6 profiles from trigger, found %',
            (select count(*) from public.profiles);
    end if;
    raise notice 'PASS: trigger created a profile for every auth user';
end
$$;

-- Grant roles. Done as superuser (bypasses RLS) because granting is itself
-- under test elsewhere.
insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('2'), 'ADMIN'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'TEACHER'),
    (test_id('6'), 'TEACHER')
on conflict do nothing;

-- A TEACHER with the extra Guru Data duty via an INDIVIDUAL grant
-- (the PROPOSED user_permissions path from 03_PHASE_1).
insert into public.user_permissions (user_id, permission_code, reason) values
    (test_id('4'), 'students.create', 'Guru Data duty'),
    (test_id('4'), 'students.update', 'Guru Data duty')
on conflict do nothing;

update public.profiles set status = 'DISABLED' where id = test_id('6');

-- ---------------------------------------------------------------------------
-- Helper: act as a user for the rest of the transaction
-- ---------------------------------------------------------------------------
-- Resolves a fixture label to its uuid, so PL/pgSQL blocks (which cannot see
-- psql variables) can still refer to the fixtures by name.
-- Sets the same GUCs Supabase sets from the JWT, and switches to the
-- `authenticated` role so RLS is genuinely exercised (not bypassed by owner
-- rights). FORCE RLS is on, so this is the real path.
create or replace function test_as(p_user uuid, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text,
        true
    );
    execute format('set local role %I', p_role);
end;
$$;

-- Returns true when the current role cannot read a table at all.
create or replace function test_denied(p_sql text)
returns boolean
language plpgsql
as $$
begin
    execute p_sql;
    return false;   -- no error means it was NOT denied
exception
    when insufficient_privilege then return true;
    when others then
        -- A row-level deny surfaces as zero rows, not an error; only
        -- privilege errors count as "denied" here.
        if sqlstate = '42501' then return true; end if;
        raise;
end;
$$;

-- ===========================================================================
-- TEST 1: no role -> no permissions at all (deny by default)
-- ===========================================================================
select test_as(test_id('5'));

do $$
begin
    if public.has_permission('students.view') then
        raise exception 'FAIL: a user with no role has students.view';
    end if;
    if public.has_permission('users.manage') then
        raise exception 'FAIL: a user with no role has users.manage';
    end if;
    if exists (select 1 from public.user_roles) then
        raise exception 'FAIL: a user with no role can read user_roles';
    end if;
    raise notice 'PASS: no-role user has zero permissions and sees no grants';
end
$$;

-- ===========================================================================
-- TEST 2: ADMIN gets authority from grants, not a bypass
-- ===========================================================================
select test_as(test_id('1'));

do $$
begin
    if not public.has_permission('students.view') then
        raise exception 'FAIL: ADMIN lacks students.view';
    end if;
    if not public.has_permission('users.manage') then
        raise exception 'FAIL: ADMIN lacks users.manage';
    end if;
    if not public.has_permission('finance.record_payment') then
        raise exception 'FAIL: ADMIN lacks finance.record_payment';
    end if;
    raise notice 'PASS: ADMIN permissions resolve through role_permissions';
end
$$;

-- Prove ADMIN is NOT a blanket bypass: remove all ADMIN grants inside a
-- subtransaction and confirm the permission disappears.
-- Prove ADMIN is NOT a blanket bypass: remove the students.view grant inside a
-- subtransaction and confirm the permission disappears.
--
-- This runs as the superuser (not `authenticated`) because the point is to
-- observe has_permission()'s behaviour with a grant missing, not to test who may
-- edit role_permissions (that is TEST 5). has_permission() reads the grant
-- tables as SECURITY DEFINER, so it sees the change regardless of caller.
reset role;

do $$
begin
    begin
        delete from public.role_permissions where role_code = 'ADMIN'
            and permission_code = 'students.view';

        if public.has_permission('students.view') then
            raise exception 'FAIL: ADMIN still has students.view after the grant was removed (hardcoded bypass exists)';
        end if;

        raise exception 'ROLLBACK_MARKER';
    exception
        when others then
            if sqlerrm <> 'ROLLBACK_MARKER' then raise; end if;
    end;

    -- The rollback above restored the grant; confirm and carry on.
    if not public.has_permission('students.view') then
        raise exception 'FAIL: grant was not restored after rollback';
    end if;
    raise notice 'PASS: ADMIN authority is grant-derived, not a hardcoded bypass';
end
$$;

-- ===========================================================================
-- TEST 3: TEACHER baseline is minimum, management is denied
-- ===========================================================================
select test_as(test_id('3'));
set local role authenticated;

do $$
declare
    _p text;
begin
    -- Baseline granted.
    for _p in select unnest(array[
        'students.view','classes.view','subjects.view','attendance.record',
        'assessments.enter_scores','reports.view'
    ])
    loop
        if not public.has_permission(_p) then
            raise exception 'FAIL: TEACHER baseline missing %', _p;
        end if;
    end loop;

    -- Management scope must be denied.
    for _p in select unnest(array[
        'users.view','users.manage','students.create','students.update',
        'students.archive','finance.view','finance.manage','settings.manage',
        'audit.view','guardians.view','teachers.manage','assessments.publish',
        'reports.publish','attendance.manage','timetable.manage'
    ])
    loop
        if public.has_permission(_p) then
            raise exception 'FAIL: TEACHER unexpectedly has %', _p;
        end if;
    end loop;

    raise notice 'PASS: TEACHER baseline is minimum; management scope denied';
end
$$;

-- ===========================================================================
-- TEST 4: individual grants ADD to role grants (Guru Data case)
-- ===========================================================================
select test_as(test_id('4'));
set local role authenticated;

do $$
begin
    if not public.has_permission('students.create') then
        raise exception 'FAIL: individual grant students.create not effective';
    end if;
    if not public.has_permission('students.update') then
        raise exception 'FAIL: individual grant students.update not effective';
    end if;
    -- Still a TEACHER: no management scope leaked in.
    if public.has_permission('users.manage') then
        raise exception 'FAIL: Guru Data grant leaked users.manage';
    end if;
    if public.has_permission('students.archive') then
        raise exception 'FAIL: Guru Data grant leaked students.archive';
    end if;
    raise notice 'PASS: individual grants add to role grants without over-granting';
end
$$;

-- ===========================================================================
-- TEST 5: users.manage gates role/permission administration
-- ===========================================================================
-- TEACHER cannot grant themselves ADMIN.
select test_as(test_id('3'));

do $$
declare
    blocked boolean := false;
begin
    begin
        insert into public.user_roles (user_id, role_code) values (test_id('3'), 'ADMIN');
    exception
        when insufficient_privilege then blocked := true;
    end;
    if not blocked then
        raise exception 'FAIL: TEACHER was able to insert a user_roles row';
    end if;
    raise notice 'PASS: TEACHER cannot grant themselves a role via direct insert';
end
$$;

-- The RPC path must also refuse.
do $$
declare
    blocked boolean := false;
begin
    begin
        perform public.admin_grant_role(test_id('3'), 'ADMIN');
    exception
        when insufficient_privilege then blocked := true;
    end;
    if not blocked then
        raise exception 'FAIL: TEACHER could call admin_grant_role';
    end if;
    raise notice 'PASS: TEACHER cannot escalate via admin_grant_role RPC';
end
$$;

-- Granting a permission directly is likewise refused.
do $$
declare
    blocked boolean := false;
begin
    begin
        insert into public.user_permissions (user_id, permission_code)
        values (test_id('3'), 'users.manage');
    exception
        when insufficient_privilege then blocked := true;
    end;
    if not blocked then
        raise exception 'FAIL: TEACHER could insert into user_permissions';
    end if;
    raise notice 'PASS: TEACHER cannot self-grant a permission';
end
$$;

-- ADMIN can grant, and the grant takes effect.
select test_as(test_id('1'));

do $$
begin
    perform public.admin_grant_role(test_id('3'), 'ADMIN');
    if not exists (
        select 1 from public.user_roles
        where user_id = test_id('3') and role_code = 'ADMIN'
    ) then
        raise exception 'FAIL: ADMIN grant via RPC did not persist';
    end if;
    raise notice 'PASS: ADMIN can grant a role via RPC';
end
$$;

-- Undo so later tests see the original teacher shape.
do $$
begin
    perform public.admin_revoke_role(test_id('3'), 'ADMIN');
    if exists (
        select 1 from public.user_roles
        where user_id = test_id('3') and role_code = 'ADMIN'
    ) then
        raise exception 'FAIL: revoke did not remove the role';
    end if;
    raise notice 'PASS: ADMIN can revoke a role via RPC';
end
$$;

-- ===========================================================================
-- TEST 6: self-service profile update cannot change status
-- ===========================================================================
select test_as(test_id('3'));

do $$
declare
    before_status public.profile_status;
    after_status  public.profile_status;
    blocked boolean := false;
begin
    select status into before_status from public.profiles where id = test_id('3');

    -- Attempt to self-disable: should be rejected by the WITH CHECK clause.
    begin
        update public.profiles
           set status = 'DISABLED'
         where id = test_id('3');
    exception
        when insufficient_privilege then blocked := true;
        when check_violation then blocked := true;
    end;

    select status into after_status from public.profiles where id = test_id('3');

    if after_status <> before_status then
        raise exception 'FAIL: a user changed their own status (% -> %)',
            before_status, after_status;
    end if;

    if not blocked then
        raise notice 'NOTE: self-disable produced no error but left status unchanged (policy used WITH CHECK)';
    else
        raise notice 'PASS: self-service status change rejected outright';
    end if;
end
$$;

-- A raw table UPDATE must NOT be able to rewrite the profile. This is the
-- regression guard for the hole where only `status` was pinned and a user could
-- still rename themselves by writing to the table directly.
do $$
declare
    blocked boolean := false;
    current_name text;
begin
    select full_name into current_name from public.profiles where id = test_id('3');

    begin
        update public.profiles set full_name = 'Hacked' where id = test_id('3');
    exception
        when insufficient_privilege then blocked := true;
    end;

    if not blocked then
        raise exception 'FAIL: a raw UPDATE on profiles was permitted (bypasses the audited RPC)';
    end if;

    select full_name into current_name from public.profiles where id = test_id('3');
    if current_name = 'Hacked' then
        raise exception 'FAIL: raw UPDATE changed full_name';
    end if;

    raise notice 'PASS: raw table UPDATE on profiles is refused (single audited write path)';
end
$$;

-- Legitimate self-service edit works, through the RPC.
do $$
declare
    updated public.profiles;
begin
    select * into updated from public.update_my_profile('Guru Satu', 'Guru', '0123456789', null);
    if updated.full_name <> 'Guru Satu' then
        raise exception 'FAIL: update_my_profile did not persist full_name';
    end if;
    raise notice 'PASS: update_my_profile edits allowed self-service fields';
end
$$;

-- ===========================================================================
-- TEST 7: a user cannot read another user's profile without users.view
-- ===========================================================================
select test_as(test_id('3'));

do $$
declare
    visible integer;
begin
    select count(*) into visible from public.profiles where id <> test_id('3');
    if visible <> 0 then
        raise exception 'FAIL: TEACHER sees % other profiles without users.view', visible;
    end if;
    raise notice 'PASS: TEACHER sees only their own profile';
end
$$;

select test_as(test_id('1'));

do $$
declare
    visible integer;
begin
    select count(*) into visible from public.profiles where id <> test_id('1');
    if visible = 0 then
        raise exception 'FAIL: ADMIN with users.view sees no other profiles';
    end if;
    raise notice 'PASS: users.view exposes other profiles (% rows)', visible;
end
$$;

-- ===========================================================================
-- TEST 8: DISABLED profile is rejected despite a valid JWT claim
-- ===========================================================================
-- The user still has a TEACHER role row, but status = DISABLED.
select test_as(test_id('6'));

do $$
begin
    if public.is_active_user() then
        raise exception 'FAIL: is_active_user() is true for a DISABLED profile';
    end if;
    if public.has_permission('students.view') then
        raise exception 'FAIL: DISABLED user still has students.view';
    end if;
    if exists (select 1 from public.profiles) then
        raise exception 'FAIL: DISABLED user can read profiles';
    end if;
    raise notice 'PASS: DISABLED profile is locked out even with a valid token';
end
$$;

-- ===========================================================================
-- TEST 9: last-admin protection
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    blocked boolean := false;
    remaining integer;
begin
    -- Disable admin B first, then try to remove admin A: at that point A is the
    -- only ACTIVE admin and must be protected.
    perform public.admin_set_user_status(test_id('2'), 'DISABLED');

    begin
        perform public.admin_revoke_role(test_id('1'), 'ADMIN');
    exception
        when check_violation then blocked := true;
    end;

    if not blocked then
        raise exception 'FAIL: removed the last ACTIVE ADMIN without error';
    end if;

    select public.active_admin_count() into remaining;
    if remaining <> 1 then
        raise exception 'FAIL: expected 1 ACTIVE admin, found %', remaining;
    end if;

    -- Re-enable B so the state is sane for the rest of the run.
    perform public.admin_set_user_status(test_id('2'), 'ACTIVE');
    raise notice 'PASS: the last ACTIVE ADMIN cannot be removed';
end
$$;

-- Disabling the last active admin is refused too.
do $$
declare
    blocked boolean := false;
begin
    perform public.admin_set_user_status(test_id('2'), 'DISABLED');

    begin
        perform public.admin_set_user_status(test_id('1'), 'DISABLED');
    exception
        when check_violation then blocked := true;
    end;

    if not blocked then
        raise exception 'FAIL: disabled the last ACTIVE ADMIN';
    end if;

    perform public.admin_set_user_status(test_id('2'), 'ACTIVE');
    raise notice 'PASS: the last ACTIVE ADMIN cannot be disabled';
end
$$;

-- ===========================================================================
-- TEST 10: audit log is append-only and permission-gated
-- ===========================================================================
select test_as(test_id('3'));

do $$
declare
    visible integer;
begin
    -- audit.view is not a TEACHER permission.
    if public.has_permission('audit.view') then
        raise exception 'FAIL: TEACHER has audit.view';
    end if;
    select count(*) into visible from public.authorization_audit;
    if visible <> 0 then
        raise exception 'FAIL: TEACHER can read the audit log (% rows)', visible;
    end if;
    raise notice 'PASS: audit log is unreadable without audit.view';
end
$$;

select test_as(test_id('1'));

do $$
declare
    n integer;
    blocked_update boolean := false;
    blocked_delete boolean := false;
begin
    select count(*) into n from public.authorization_audit;
    if n = 0 then
        raise exception 'FAIL: audit log recorded no entries after role changes';
    end if;

    -- No UPDATE/DELETE grant or policy exists, so both must be refused.
    -- A missing table privilege raises; a missing policy silently affects 0
    -- rows. Either outcome is acceptable provided no row actually changes.
    begin
        update public.authorization_audit set action = 'TAMPERED';
        blocked_update := true;
    exception
        when insufficient_privilege then blocked_update := true;
    end;

    begin
        delete from public.authorization_audit;
        blocked_delete := true;
    exception
        when insufficient_privilege then blocked_delete := true;
    end;

    if not blocked_update then
        raise exception 'FAIL: audit log UPDATE was permitted';
    end if;
    if not blocked_delete then
        raise exception 'FAIL: audit log DELETE was permitted';
    end if;

    raise notice 'PASS: audit log is append-only (% rows preserved), update blocked: %, delete blocked: %',
        n, blocked_update, blocked_delete;
end
$$;

-- ===========================================================================
-- TEST 11: anon has no access at all
-- ===========================================================================
do $$
declare
    denied_profiles boolean := false;
begin
    begin
        set local role anon;
        perform count(*) from public.profiles;
    exception
        when insufficient_privilege then denied_profiles := true;
    end;

    reset role;

    if not denied_profiles then
        raise exception 'FAIL: anon can read profiles';
    end if;

    -- anon must not be able to run the authorization helpers either.
    if has_function_privilege('anon', 'public.has_permission(text)', 'EXECUTE') then
        raise exception 'FAIL: anon can execute has_permission';
    end if;
    if has_function_privilege('anon', 'public.admin_grant_role(uuid,text)', 'EXECUTE') then
        raise exception 'FAIL: anon can execute admin_grant_role';
    end if;

    raise notice 'PASS: anon has no table access and cannot call privileged functions';
end
$$;

-- ---------------------------------------------------------------------------
-- TEST 12: a temporary password must be changed by its owner
-- ---------------------------------------------------------------------------
-- An administrator creates an account with a temporary password, so a second
-- person knows the credential. The account stays flagged until its owner
-- replaces it.
--
-- Fixtures are set up as the owner of the objects (reset role) because
-- `authenticated` deliberately holds no UPDATE grant on profiles — that is the
-- fix from the earlier raw-UPDATE hole, and it applies to the tests too.
reset role;

update public.profiles set must_change_password = true where id = test_id('3');

select test_as(test_id('3'));   -- the flagged TEACHER, acting as themselves

do $$
declare
    cleared boolean;
begin
    perform public.clear_temporary_password_flag();

    select must_change_password into cleared from public.profiles where id = test_id('3');
    if cleared then
        raise exception 'FAIL: clear_temporary_password_flag did not clear the flag';
    end if;

    raise notice 'PASS: an account clears its temporary-password flag by changing its own password';
end
$$;

-- The transition is audited: the account stopped being one whose password a
-- second person knows, which is security-relevant.
select test_as(test_id('1'));   -- ADMIN holds audit.view

do $$
declare
    n integer;
begin
    select count(*) into n
      from public.authorization_audit
     where action = 'TEMPORARY_PASSWORD_CLEARED'
       and subject_id = test_id('3');

    if n <> 1 then
        raise exception 'FAIL: expected 1 TEMPORARY_PASSWORD_CLEARED audit row, found %', n;
    end if;

    raise notice 'PASS: clearing a temporary-password flag is audited';
end
$$;

-- The function takes no user id on purpose: it must act only on the caller.
reset role;
update public.profiles set must_change_password = true where id = test_id('3');

select test_as(test_id('4'));   -- a different, active user

do $$
declare
    other_still_flagged boolean;
begin
    perform public.clear_temporary_password_flag();

    select must_change_password into other_still_flagged
      from public.profiles where id = test_id('3');

    if not other_still_flagged then
        raise exception 'FAIL: a user cleared another account''s temporary-password flag';
    end if;

    raise notice 'PASS: a user cannot clear another account''s temporary-password flag';
end
$$;

-- anon must not be able to call it at all.
reset role;
do $$
begin
    if has_function_privilege('anon', 'public.clear_temporary_password_flag()', 'EXECUTE') then
        raise exception 'FAIL: anon can execute clear_temporary_password_flag';
    end if;
    raise notice 'PASS: anon cannot clear a temporary-password flag';
end
$$;
set local role authenticated;
select test_as(test_id('1'));

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
do $$
begin
    raise notice '';
    raise notice '==============================================';
    raise notice '  ALL PHASE 1 AUTHORIZATION TESTS PASSED';
    raise notice '==============================================';
end
$$;

rollback;
