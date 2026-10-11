-- AUDIT F27 — the roles screen wrote permissions through a server that is not deployed.
--
-- WHAT WAS WRONG. The screen read and saved role permissions via an Express endpoint.
-- The switches therefore showed the code's built-in defaults, and saving changed
-- nothing. An office that turns a permission ON, sees it stick, and then finds the
-- teacher still cannot do the thing has been told something false about who can see
-- what — and the screen's own state agreed with them.
--
-- WHY A FUNCTION RATHER THAN TABLE WRITES. `role_permissions` already has a write
-- policy requiring `permissions.manage`. The one rule that cannot live in a policy
-- is "you may not take this away from ADMIN": doing so could lock EVERY admin out of
-- the screen that would restore it, including whoever just did it. That needs to be
-- enforced where a caller cannot route around it, so it is here.

create or replace function public.set_role_permissions(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_change jsonb;
    v_role text;
    v_perm text;
    v_enabled boolean;
begin
    -- `settings.manage` is the permission the policies on `role_permissions` already
    -- require. There is no separate `permissions.manage`; inventing one would have
    -- left this function callable by nobody, which is how it first failed.
    if not public.is_active_user() or not public.has_permission('settings.manage') then
        raise exception 'Not allowed to change role permissions'
            using errcode = 'insufficient_privilege';
    end if;
    if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
        raise exception 'The changes must be an array'
            using errcode = 'invalid_parameter_value';
    end if;

    for v_change in select * from jsonb_array_elements(p_changes) loop
        v_role := v_change->>'role_code';
        v_perm := v_change->>'permission_code';
        v_enabled := coalesce((v_change->>'enabled')::boolean, false);

        if v_role is null or v_perm is null then
            raise exception 'Each change needs a role and a permission'
                using errcode = 'invalid_parameter_value';
        end if;

        -- The rule that would otherwise let the office lock itself out. Removing a
        -- permission from ADMIN is refused; adding one is fine.
        if v_role = 'ADMIN' and not v_enabled then
            raise exception 'A permission cannot be taken away from ADMIN'
                using errcode = 'check_violation';
        end if;

        if not exists (select 1 from public.roles r where r.code = v_role) then
            raise exception 'No such role: %', v_role
                using errcode = 'invalid_parameter_value';
        end if;
        if not exists (select 1 from public.permissions p where p.code = v_perm) then
            raise exception 'No such permission: %', v_perm
                using errcode = 'invalid_parameter_value';
        end if;

        if v_enabled then
            insert into public.role_permissions (role_code, permission_code)
            values (v_role, v_perm)
            on conflict (role_code, permission_code) do nothing;
        else
            delete from public.role_permissions
             where role_code = v_role and permission_code = v_perm;
        end if;
    end loop;
end;
$$;

-- A single change, for a screen that saves one switch at a time.
create or replace function public.set_role_permission(
    p_role_code text,
    p_permission_code text,
    p_enabled boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
    select public.set_role_permissions(
        jsonb_build_array(jsonb_build_object(
            'role_code', p_role_code,
            'permission_code', p_permission_code,
            'enabled', p_enabled
        ))
    );
$$;

revoke all on function public.set_role_permissions(jsonb) from public, anon;
revoke all on function public.set_role_permission(text, text, boolean) from public, anon;
grant execute on function public.set_role_permissions(jsonb) to authenticated;
grant execute on function public.set_role_permission(text, text, boolean) to authenticated;

-- Guard: the ADMIN lock-out rule must survive any rewrite of this function, because
-- losing it is not a visible failure — it happens the day someone removes the wrong
-- switch, and by then nobody can put it back.
do $guard$
declare
    v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'set_role_permissions';
    if v_src is null then
        raise exception 'F27: set_role_permissions was not created';
    end if;
    if v_src !~ 'has_permission' then
        raise exception 'F27: set_role_permissions does not check the permission';
    end if;
    if v_src !~ '''ADMIN''' then
        raise exception 'F27: set_role_permissions no longer protects ADMIN';
    end if;
    if v_src !~ 'delete from public.role_permissions' then
        raise exception 'F27: set_role_permissions cannot remove a grant';
    end if;

    if has_function_privilege('anon', 'public.set_role_permissions(jsonb)', 'execute')
       or has_function_privilege('anon', 'public.set_role_permission(text, text, boolean)', 'execute') then
        raise exception 'F27: anon can change role permissions';
    end if;
end;
$guard$;
