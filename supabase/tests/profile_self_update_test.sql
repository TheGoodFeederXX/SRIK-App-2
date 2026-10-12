-- AUDIT F27 — nobody could edit their own profile.
--
-- The screen posted to an undeployed server, and even pointed at the right table it would
-- have failed: `profiles` had only `profiles_manage | ALL | has_permission('users.manage')`
-- for writes, and `authenticated` held no UPDATE grant at all. A teacher or guardian could
-- not change their own name or phone number; only an admin could.

\set ON_ERROR_STOP on

begin;

-- The suite OWNS its admin. The test database has no admin profile seeded, so borrowing
-- one left F27ps5 with a null caller and a permission it never had.
create temp table pf as select
    gen_random_uuid() as teacher_user,
    gen_random_uuid() as other_user,
    gen_random_uuid() as admin_user;

do $setup$
declare v_teacher uuid; v_other uuid; v_admin uuid;
begin
    -- Setup runs as the owner with NO claims. `auth.uid()` reads the JWT claim, not the
    -- role, so a claim left behind by an earlier suite made the policy apply here and the
    -- setup itself was refused.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'postgres', true);
    select teacher_user, other_user, admin_user into v_teacher, v_other, v_admin from pf;
    insert into auth.users (id, email, email_confirmed_at) values
        (v_teacher, 'guru.psu@srialkhairiah.my', now()),
        (v_other, 'lain.psu@srialkhairiah.my', now()),
        (v_admin, 'admin.psu@srialkhairiah.my', now());
    update public.profiles set full_name = 'Guru PSU', status = 'ACTIVE' where id = v_teacher;
    update public.profiles set full_name = 'Orang Lain', status = 'ACTIVE' where id = v_other;
    update public.profiles set full_name = 'Admin PSU', status = 'ACTIVE' where id = v_admin;
    insert into public.user_roles (user_id, role_code) values (v_teacher, 'TEACHER')
    on conflict do nothing;
    -- The admin gets the role that carries users.manage, which is what the trigger checks.
    insert into public.user_roles (user_id, role_code) values (v_admin, 'ADMIN')
    on conflict do nothing;
end;
$setup$;

-- F27ps1: a teacher CAN change their own name. This is the whole point.
do $c1$
declare v_user uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    select teacher_user into v_user from pf;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    update public.profiles set full_name = 'Guru PSU Baharu' where id = v_user;

    perform set_config('role', 'postgres', true);
    if not exists (select 1 from public.profiles where id = v_user and full_name = 'Guru PSU Baharu') then
        raise exception 'F27ps1: the name change did not persist';
    end if;
    raise notice 'PASS: [F27ps1] a teacher can change their own name';
end;
$c1$;

-- F27ps2: but NOT their own status. A user who could would re-enable a disabled account.
do $c2$
declare v_user uuid; v_refused boolean;
begin
    perform set_config('request.jwt.claims', '', true);
    select teacher_user into v_user from pf;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    -- A flag, not an exception inside the handler: raising the failure from within the
    -- exception block would be caught by the same block, which is how this check first
    -- reported a pass it had not earned.
    v_refused := false;
    begin
        update public.profiles set status = 'DISABLED' where id = v_user;
    exception when others then
        v_refused := true;
    end;
    perform set_config('role', 'postgres', true);

    if not v_refused then
        raise exception 'F27ps2: a user changed their own account status';
    end if;
    if (select status from public.profiles where id = v_user) <> 'ACTIVE' then
        raise exception 'F27ps2: the status changed despite the refusal';
    end if;

    raise notice 'PASS: [F27ps2] a user cannot change their own account status';
end;
$c2$;

-- F27ps3: and not their own password-change requirement. A forced reset must be forced.
do $c3$
declare v_user uuid; v_before boolean; v_refused boolean;
begin
    select teacher_user into v_user from pf;
    -- The SETUP must run with no claims: `auth.uid()` reads the claim, not the role, so a
    -- leftover claim from the previous check still made the trigger fire here.
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set must_change_password = true where id = v_user;
    select must_change_password into v_before from public.profiles where id = v_user;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);
    v_refused := false;
    begin
        update public.profiles set must_change_password = false where id = v_user;
    exception when others then
        v_refused := true;
    end;
    perform set_config('role', 'postgres', true);

    if not v_refused then
        raise exception 'F27ps3: a user cleared their own password-change requirement';
    end if;
    if (select must_change_password from public.profiles where id = v_user) is distinct from v_before then
        raise exception 'F27ps3: the flag changed despite the refusal';
    end if;
    raise notice 'PASS: [F27ps3] a user cannot clear their own password-change requirement';
end;
$c3$;

-- F27ps4: and not ANOTHER person's row at all.
do $c4$
declare v_user uuid; v_other uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    select teacher_user, other_user into v_user, v_other from pf;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    update public.profiles set full_name = 'DICURI' where id = v_other;

    perform set_config('role', 'postgres', true);
    if exists (select 1 from public.profiles where id = v_other and full_name = 'DICURI') then
        raise exception 'F27ps4: a teacher changed another person''s profile';
    end if;
    raise notice 'PASS: [F27ps4] a teacher cannot change another person''s profile';
end;
$c4$;

-- F27ps5: an admin keeps full control — the office must still be able to disable someone.
do $c5$
declare v_admin uuid; v_other uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    select other_user, admin_user into v_other, v_admin from pf;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    update public.profiles set status = 'DISABLED' where id = v_other;
    perform set_config('role', 'postgres', true);

    if (select status from public.profiles where id = v_other) <> 'DISABLED' then
        raise exception 'F27ps5: an admin can no longer disable an account';
    end if;
    raise notice 'PASS: [F27ps5] an admin can still disable an account';
end;
$c5$;

rollback;
