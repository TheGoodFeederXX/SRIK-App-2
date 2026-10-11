-- AUDIT F27 — the roles screen was a switch panel for a permission system that is
-- not this one.
--
-- WHAT WAS WRONG. The screen carried its own catalogue: roles called Admin, Teacher,
-- Student and Parent, and permissions called "manage-users", "mark-attendance". The
-- database has THREE roles (ADMIN, TEACHER, GUARDIAN) and 42 permission codes like
-- `assessments.enter_scores`. Every switch the screen showed described something the
-- database had never heard of, so saving could never have worked even with a live
-- server: there was nothing to save it TO.
--
-- These checks are about the ONE rule that would be unrecoverable if it broke.

\set ON_ERROR_STOP on

begin;

create temp table admin_id as
select p.id from public.profiles p join public.user_roles ur on ur.user_id = p.id
 where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

-- F27r1: a permission can be granted and taken away again.
do $r1$
declare
    v_admin uuid;
begin
    select id into v_admin from admin_id;
    if v_admin is null then
        raise exception 'F27r1: no active admin';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    perform public.set_role_permissions(
        '[{"role_code":"TEACHER","permission_code":"assessments.publish","enabled":true}]'::jsonb);
    if not exists (select 1 from public.role_permissions
                    where role_code='TEACHER' and permission_code='assessments.publish') then
        raise exception 'F27r1: the grant was not stored';
    end if;

    perform public.set_role_permissions(
        '[{"role_code":"TEACHER","permission_code":"assessments.publish","enabled":false}]'::jsonb);
    if exists (select 1 from public.role_permissions
                where role_code='TEACHER' and permission_code='assessments.publish') then
        raise exception 'F27r1: turning a permission OFF did not remove the grant';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27r1] a permission can be granted and taken away again';
end;
$r1$;

-- F27r2: THE RULE THAT MATTERS. A permission cannot be taken away from ADMIN.
--
-- Losing this is unrecoverable: the office could remove `settings.manage` from ADMIN
-- and lock every admin out of the screen that would put it back — including whoever
-- just did it. Nothing would look broken until nobody could fix it.
do $r2$
declare
    v_admin uuid;
begin
    select id into v_admin from admin_id;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    begin
        perform public.set_role_permissions(
            '[{"role_code":"ADMIN","permission_code":"settings.manage","enabled":false}]'::jsonb);
        perform set_config('role', 'postgres', true);
        raise exception 'F27r2: a permission was taken away from ADMIN';
    exception
        when check_violation then
            perform set_config('role', 'postgres', true);
            -- And the grant must still be there, not merely refused after removal.
            if not exists (select 1 from public.role_permissions
                            where role_code='ADMIN' and permission_code='settings.manage') then
                raise exception 'F27r2: the refusal was too late — the grant is gone';
            end if;
            raise notice 'PASS: [F27r2] ADMIN cannot be stripped of a permission';
    end;
end;
$r2$;

-- F27r3: a role or permission that does not exist is refused, not silently ignored.
-- A screen sending an invented code must fail loudly.
do $r3$
declare
    v_admin uuid;
    v_raised boolean := false;
begin
    select id into v_admin from admin_id;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    begin
        perform public.set_role_permissions(
            '[{"role_code":"STUDENT","permission_code":"manage-users","enabled":true}]'::jsonb);
    exception
        when invalid_parameter_value then v_raised := true;
    end;

    perform set_config('role', 'postgres', true);

    if not v_raised then
        raise exception 'F27r3: an invented role and permission were accepted';
    end if;
    if exists (select 1 from public.role_permissions where role_code = 'STUDENT') then
        raise exception 'F27r3: a row was written for a role that does not exist';
    end if;

    raise notice 'PASS: [F27r3] an invented role or permission is refused';
end;
$r3$;

-- F27r4: an anonymous caller cannot change permissions.
do $r4$
begin
    if has_function_privilege('anon', 'public.set_role_permissions(jsonb)', 'execute')
       or has_function_privilege('anon', 'public.set_role_permission(text, text, boolean)', 'execute') then
        raise exception 'F27r4: anon can change role permissions';
    end if;
    raise notice 'PASS: [F27r4] anon cannot change role permissions';
end;
$r4$;

rollback;
