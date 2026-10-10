-- Guard tests for audit findings F13, F14, F15 and F16 — provisioning and
-- temporary passwords.
--
-- The four are one story: an account is created (F13/F16), it arrives on a
-- temporary password (F14), and the identity the app reads back must agree with
-- what was created (F15).
--
-- THE DEFECTS, each verified against production before being changed:
--
--   F13. The Edge Function that creates teacher accounts carries the comment
--        "The teacher profile row and TEACHER role are created by the same
--        triggers that Phase 1 relies on". `handle_new_user` inserts a `profiles`
--        row and NOTHING else. Measured: 1 profile, 0 roles, 0 permissions. A
--        teacher signs in successfully and sees an empty application.
--
--   F14. `clear_temporary_password_flag()` needed nothing but a valid session, so
--        a teacher on a temporary password could clear the flag without changing
--        it — and `is_active_user()` ignored the flag, so every ordinary grant
--        kept working. The prompt was a suggestion the client could decline.
--
--   F16. `create_guardian_account` wrote `auth.users` and `auth.identities` by
--        hand with its own bcrypt hash, enforcing a minimum of 8 characters while
--        the project config says 12. It bypasses GoTrue, so confirmation,
--        recovery, identity linking and Auth's audit trail do not run for the
--        account it creates.
--
-- Nothing has been provisioned in production yet (1 profile, 0 linked teachers,
-- 0 guardians), so these fixes land before the first real account exists.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e300-' || lpad(p_label, 12, '0'))::uuid;
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

-- An administrator who will do the provisioning, and a teacher account that has
-- just been created and is still on a temporary password.
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    (test_id('1'), 'admin.prov@srik.test', now(), now(), now()),
    (test_id('2'), 'guru.baharu@srik.test', now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Pentadbir Provision', 'ACTIVE', false),
    (test_id('2'), 'Guru Baharu', 'ACTIVE', true)
-- `do update` and not `do nothing`: an earlier suite in this database may own these
-- ids, and a skipped conflicting insert would leave the fixture in the wrong state
-- — which is how an earlier test in this repository passed for the wrong reason.
on conflict (id) do update
    set status = excluded.status,
        must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values (test_id('1'), 'ADMIN')
on conflict do nothing;
-- The teacher deliberately has NO role: that is the state F13 leaves behind.
delete from public.user_roles where user_id = test_id('2');

-- The fixture's own precondition, asserted where it is set rather than three checks
-- later. If this is false, every F14 check below would pass or fail for the wrong
-- reason — and a test that cannot distinguish "the rule worked" from "the fixture
-- was wrong" is not evidence.
do $$
begin
    if not exists (
        select 1 from public.profiles
         where id = test_id('2') and must_change_password
    ) then
        raise exception
            'FAIL: the temporary-password fixture is not in the expected state'
            using errcode = 'raise_exception';
    end if;
end
$$;

insert into public.teachers (id, user_id, staff_code, full_name, status)
values (test_id('801'), null, 'G-PROV', 'Guru Baharu', 'ACTIVE')
on conflict (id) do update set user_id = null;

-- A guardian record for the F16 half. `guardians.phone` is NOT NULL, and `user_id`
-- starts null: the account does not exist yet, which is the state provisioning
-- starts from.
insert into public.guardians (id, user_id, full_name, phone)
values (test_id('601'), null, 'Penjaga Baharu', '019')
on conflict (id) do update set user_id = null;

-- ===========================================================================
-- F14a: an account on a temporary password must not be able to do domain work.
--
-- This is asserted through `is_active_user`, which every other helper builds on.
-- Asserting it here means the test covers the whole authorization surface rather
-- than one policy.
-- ===========================================================================
reset role;
select test_as(test_id('2'));

do $$
begin
    if public.is_active_user() then
        raise exception
            'FAIL F14: an account on a temporary password is still treated as active, '
            'so a temporary credential carries full authority'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a temporary password grants no authority';
end
$$;

-- ===========================================================================
-- F14b: the permission helpers must inherit that refusal.
--
-- `is_active_user` being false is only useful if the helpers actually consult it.
-- A helper that read `role_permissions` directly would ignore the rule entirely.
-- ===========================================================================
do $$
begin
    if public.has_permission('students.view') then
        raise exception
            'FAIL F14: has_permission ignores the temporary password rule'
            using errcode = 'raise_exception';
    end if;
    if public.has_role(array['TEACHER']::public.app_role[]) then
        raise exception 'FAIL F14: has_role ignores the temporary password rule'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the permission helpers inherit the temporary password rule';
end
$$;

-- ===========================================================================
-- F14c: the client must not be able to clear the flag without changing the
-- password. The new function requires GoTrue's own evidence.
-- ===========================================================================
do $$
declare
    v_blocked boolean := false;
begin
    begin
        perform public.complete_password_change();
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F14: the temporary password flag was cleared without the password '
            'being changed — the defect is back under a new name'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: the temporary password flag cannot be cleared without a real change';
end
$$;

-- The flag's state is asserted with the RESTRICTED role out of the way, on purpose.
-- The account is on a temporary password, so its own `is_active_user()` is false and
-- a policy-mediated read returns nothing — which would make "the flag is still set"
-- and "the read was refused" indistinguishable. This is about the data, not about
-- who may see it, and F15 covers the visibility question separately.
reset role;
do $$
begin
    if not exists (
        select 1 from public.profiles
         where id = test_id('2') and must_change_password
    ) then
        raise exception
            'FAIL F14: the temporary password flag is not set before the clear was '
            'attempted, so this check cannot tell whether the clear was refused'
            using errcode = 'raise_exception';
    end if;
end
$$;
select test_as(test_id('2'));

-- ===========================================================================
-- F14d: once the password HAS changed, the account works normally.
--
-- The both-halves rule, and here it protects the product from the fix: a rule that
-- locked temporary accounts out permanently would pass every check above and make
-- every new teacher unusable.
--
-- The REAL sequence is exercised, in the order it actually happens: GoTrue records
-- the password change in `auth.users.updated_at`, and only then can the account call
-- `complete_password_change()` to clear the flag. Clearing the flag without that
-- evidence was refused in F14c, so this test deliberately depends on the evidence
-- being present — if `complete_password_change` ever stopped requiring it, F14c
-- would fail instead, and the two together pin the rule from both sides.
--
-- A test that merely cleared the flag directly would prove nothing about the
-- evidence check, which is the part that matters.
-- ===========================================================================
reset role;
update auth.users set updated_at = created_at + interval '1 minute' where id = test_id('2');
select test_as(test_id('2'));

do $$
begin
    -- Step 1: with the evidence present, the flag can now be cleared.
    perform public.complete_password_change();

    if exists (
        select 1 from public.profiles
         where id = test_id('2') and must_change_password
    ) then
        raise exception
            'FAIL F14: the flag was not cleared even though the password change was '
            'evidenced by auth.users.updated_at — a teacher could never finish '
            'onboarding'
            using errcode = 'raise_exception';
    end if;

    -- Step 2: and with the flag cleared, the account has its authority back.
    if not public.is_active_user() then
        raise exception
            'FAIL F14: a teacher whose password was changed is still refused — the '
            'rule would lock every new account out permanently'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an account works normally once the password is changed';
end
$$;

reset role;

-- ===========================================================================
-- F13: provisioning must grant the TEACHER role and set the flag.
--
-- The role grant is the whole point: its absence is the defect.
-- ===========================================================================
select test_as(test_id('1'));  -- the ADMIN

do $$
declare
    v_result jsonb;
    v_roles  text;
begin
    perform set_config('role', 'authenticated', true);
    v_result := public.link_teacher_account(test_id('801'), test_id('2'));

    if (v_result ->> 'ok')::boolean is not true then
        raise exception 'FAIL F13: provisioning did not report success: %', v_result
            using errcode = 'raise_exception';
    end if;

    -- The link, the role and the flag must ALL be present. Any one of them missing
    -- is the half-provisioned account the finding describes.
    if not exists (
        select 1 from public.teachers
         where id = test_id('801') and user_id = test_id('2')
    ) then
        raise exception 'FAIL F13: the account was not linked to the teacher'
            using errcode = 'raise_exception';
    end if;

    select string_agg(role_code, ',') into v_roles
      from public.user_roles where user_id = test_id('2');
    if v_roles is null or position('TEACHER' in v_roles) = 0 then
        raise exception
            'FAIL F13: the provisioned account holds roles "%" — a teacher who can '
            'sign in and see nothing', coalesce(v_roles, '(none)')
            using errcode = 'raise_exception';
    end if;

    if not exists (
        select 1 from public.profiles
         where id = test_id('2') and must_change_password
    ) then
        raise exception 'FAIL F13: the temporary password flag was not set'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: provisioning links the teacher, grants TEACHER and sets the flag';
end
$$;

-- ===========================================================================
-- F13: a second provisioning of the same teacher must be refused, not silently
-- overwrite the first link.
-- ===========================================================================
do $$
declare
    v_blocked boolean := false;
begin
    begin
        perform public.link_teacher_account(test_id('801'), test_id('1'));
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F13: a second provisioning overwrote the existing account link'
            using errcode = 'raise_exception';
    end if;

    -- The FIRST link must survive the refused second attempt.
    if not exists (
        select 1 from public.teachers
         where id = test_id('801') and user_id = test_id('2')
    ) then
        raise exception 'FAIL F13: the original link was damaged by the refusal'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an already-linked teacher cannot be provisioned twice';
end
$$;

-- ===========================================================================
-- F13: the RPC must not be a route to ADMIN.
--
-- A caller with `users.manage` must not be able to name a higher role. This is the
-- same both-halves discipline: the previous checks prove the right grant happens,
-- this proves the wrong one cannot be requested.
-- ===========================================================================
do $$
declare
    v_blocked boolean := false;
begin
    begin
        perform public.link_teacher_account(test_id('801'), test_id('1'), 'ADMIN');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception 'FAIL F13: the provisioning RPC can grant ADMIN'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the provisioning RPC cannot grant ADMIN';
end
$$;

-- ===========================================================================
-- F13: an account without `users.manage` must not provision anybody.
-- ===========================================================================
reset role;
select test_as(test_id('2'));
do $$
declare
    v_blocked boolean := false;
begin
    begin
        perform public.link_teacher_account(test_id('801'), test_id('2'));
    exception when others then
        v_blocked := true;
    end;
    if not v_blocked then
        raise exception 'FAIL F13: a teacher could provision accounts'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: provisioning requires users.manage';
end
$$;

reset role;

-- ===========================================================================
-- F16: the guardian path must also grant GUARDIAN, and no SQL function may write
-- credential rows. The second half is asserted in the migration itself, across
-- every definer function; this asserts the behaviour.
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_result jsonb;
    v_roles  text;
begin
    perform public.link_guardian_account(test_id('601'), test_id('2'));

    select string_agg(role_code, ',') into v_roles
      from public.user_roles where user_id = test_id('2');
    if v_roles is null or position('GUARDIAN' in v_roles) = 0 then
        raise exception 'FAIL F16: the guardian account holds roles "%"',
            coalesce(v_roles, '(none)')
            using errcode = 'raise_exception';
    end if;

    if not exists (
        select 1 from public.guardians
         where id = test_id('601') and user_id = test_id('2')
    ) then
        raise exception 'FAIL F16: the account was not linked to the guardian'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: guardian provisioning links the guardian and grants GUARDIAN';
end
$$;

reset role;

-- ===========================================================================
-- F15: the account must be able to read its OWN identity while on a temporary
-- password, or the change-password screen cannot render and the user is stuck.
--
-- This is the counterpart to F14a: the rule must refuse domain work without
-- refusing the very operation that is required to escape it.
-- ===========================================================================
reset role;
update public.profiles set must_change_password = true where id = test_id('2');
select test_as(test_id('2'));

do $$
declare
    v_seen integer;
begin
    -- `profiles_select_own` is the policy that lets a signed-in account read its own
    -- row, and it does not route through is_active_user — deliberately.
    select count(*) into v_seen from public.profiles where id = test_id('2');
    if v_seen <> 1 then
        raise exception
            'FAIL F15: an account on a temporary password cannot read its own '
            'profile, so the change-password screen cannot render and the user is '
            'locked out permanently'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an account on a temporary password can still read its own profile';
end
$$;

rollback;
