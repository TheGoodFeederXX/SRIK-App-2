-- AUDIT F11 — the authorization trail must record only what really happened.
--
-- THE DEFECT. The table's INSERT policy was `is_active_user()` with no WITH CHECK. Any
-- signed-in user could write a row naming any actor and any action. Confirmed on production
-- as a teacher: `INSERT 0 1` for a row claiming an admin performed an action they never did.
--
-- FOUR CHECKS, and the third is the one that matters most. Blocking forgery is easy — revoke
-- everything. The real requirement is that forgery is impossible AND the legitimate trail
-- still records the truth, because an audit nobody can write to is the same as no audit.

begin;

-- A plain session setting, not a temp table: `authenticated` cannot read a temp table, and
-- the checks below run AS that role.
do $mk$
begin
    perform set_config('srik.f11_teacher', gen_random_uuid()::text, false);
end;
$mk$;

do $setup$
declare
    v_admin uuid; v_teacher uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;
    if v_admin is null then
        raise exception 'F11a: the suite has no admin — it cannot test the real path';
    end if;

    v_teacher := current_setting('srik.f11_teacher')::uuid;
    insert into auth.users (id, email, email_confirmed_at)
    values (v_teacher, 'guru.f11t@srialkhairiah.my', now());
    update public.profiles set full_name = 'Guru F11', status = 'ACTIVE' where id = v_teacher;
    insert into public.user_roles (user_id, role_code) values (v_teacher, 'TEACHER')
    on conflict do nothing;
end;
$setup$;

-- F11a: a teacher cannot write an audit row directly.
do $c1$
declare v_teacher uuid; v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    v_teacher := current_setting('srik.f11_teacher')::uuid;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_teacher), true);
    begin
        insert into public.authorization_audit (actor_id, action)
        values (v_teacher, 'FAKE_TEACHER_ACTION');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    -- The flag, checked AFTER the handler. Raising inside it would be caught by the same
    -- handler and the check would pass having asserted nothing.
    if not v_refused then
        raise exception 'F11a: a teacher wrote an audit row directly';
    end if;
    if v_err !~ 'permission denied' then
        raise exception 'F11a: refused, but not by a missing grant: %', v_err;
    end if;
    raise notice 'PASS: [F11a] a teacher cannot write an audit row directly';
end;
$c1$;

-- F11b: and cannot name someone else as the actor either — the same write, the forgery the
-- audit actually found.
do $c2$
declare v_admin uuid; v_refused boolean := false;
begin
    perform set_config('request.jwt.claims', '', true);
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f11_teacher')::uuid), true);
    begin
        insert into public.authorization_audit (actor_id, action, detail)
        values (v_admin, 'FAKE_ADMIN_ACTION', jsonb_build_object('forged', true));
    exception when others then
        v_refused := true;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F11b: a teacher forged an audit row naming an admin';
    end if;
    raise notice 'PASS: [F11b] a teacher cannot forge an audit row naming an admin';
end;
$c2$;

-- F11c: THE REAL PATH STILL WORKS, and records the TRUE actor. This is the half that a
-- careless fix breaks: revoke everything and the trail goes silent.
do $c3$
declare v_admin uuid; v_n int; v_actor_ok boolean;
begin
    perform set_config('request.jwt.claims', '', true);
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;

    -- A real authorization change, made by the admin, through the real trigger.
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    delete from public.user_roles where user_id = current_setting('srik.f11_teacher')::uuid;
    insert into public.user_roles (user_id, role_code)
    values (current_setting('srik.f11_teacher')::uuid, 'TEACHER');
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    select count(*), bool_and(actor_id = v_admin)
      into v_n, v_actor_ok
      from public.authorization_audit
     where subject_id = current_setting('srik.f11_teacher')::uuid;

    if v_n = 0 then
        raise exception 'F11c: a real role change produced NO audit event — the trail is dead';
    end if;
    if not v_actor_ok then
        raise exception 'F11c: the audit recorded the wrong actor for a real change';
    end if;
    raise notice 'PASS: [F11c] a real authorization change is still audited with the true actor';
end;
$c3$;

-- F11d: an audit row cannot be edited or deleted afterwards either. Append-only means
-- append-only, and the forgery fix must not have been a fix for INSERT alone.
do $c4$
declare v_admin uuid; v_ins_refused boolean := false; v_del_refused boolean := false;
begin
    perform set_config('request.jwt.claims', '', true);
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    begin
        delete from public.authorization_audit where subject_id = current_setting('srik.f11_teacher')::uuid;
    exception when others then
        v_del_refused := true;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_del_refused then
        raise exception 'F11d: an admin deleted an audit row';
    end if;
    raise notice 'PASS: [F11d] even an admin cannot delete an audit row';
end;
$c4$;

rollback;
