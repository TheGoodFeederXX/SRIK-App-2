-- ===========================================================================--
-- The last-administrator protection could be bypassed two ways.
--
-- Finding F12 of the 2026-10-10 audit.
--
-- THE DEFECT, proven against production before being changed. `protect_last_admin`
-- counted the remaining administrators as:
--
--     ... and ur.user_id <> old_user
--
-- which excludes the row being removed and asks whether anybody ELSE is an admin.
-- On a DELETE that is right. On an UPDATE it is wrong: the row does not disappear,
-- it MOVES. Updating `user_id` on the last ADMIN grant satisfied the check — the
-- row still existed, so `remaining` stayed 1 — while leaving the original
-- administrator with no role at all.
--
-- MEASURED, not reasoned. With exactly one active admin, moving the grant returned
-- `active_admin_count = 1` before AND after, while the original administrator's
-- ADMIN row count went to 0. The school would find out the next time somebody
-- needed to administer anything — and by then the only account that could repair
-- it is the one that was locked out.
--
-- A SECOND ROUTE, on a table the trigger did not watch. The count requires
-- `p.status = 'ACTIVE'`, so DISABLING the last administrator removes them from the
-- count without touching `user_roles` at all. The trigger lived on `user_roles`, so
-- nothing noticed. Both routes are closed here.
--
-- THE INVARIANT, stated once because it is what both guards implement:
-- **an ACTIVE administrator must exist at all times.** The trigger's own error
-- message already says "Promote or enable another administrator first"; this makes
-- the UPDATE path and the disable path honour what the DELETE path already did.
--
-- WHY THE CHECK IS NOW ON `profiles` AS WELL. A trigger can only protect the table
-- it is attached to. `protect_last_admin` was attached to `user_roles` and could
-- not see a change to `profiles.status`, which is the second route. The new trigger
-- goes where the change happens rather than trying to widen the old one.
-- ===========================================================================--

-- ---------------------------------------------------------------------------
-- One definition of "how many administrators are left, ignoring this user".
--
-- Shared by both triggers, for the same reason as the other helpers in this
-- schema: a rule copied into two places is a rule that will disagree with itself
-- after the next change.
-- ---------------------------------------------------------------------------
create or replace function public.remaining_active_admins(p_exclude_user uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)::integer
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
     where ur.role_code = 'ADMIN'
       and p.status = 'ACTIVE'
       and (p_exclude_user is null or ur.user_id <> p_exclude_user);
$$;

comment on function public.remaining_active_admins(uuid) is
    'Count of ACTIVE administrators, optionally excluding one user. The single '
    'definition shared by both last-admin triggers, so the user_roles and profiles '
    'guards cannot disagree (audit F12).';

-- Automatic EXECUTE to PUBLIC on a new function — the same trap that reopened the
-- F01/F02/F03 exposure. Revoked here rather than left to a later review.
revoke execute on function public.remaining_active_admins(uuid) from public, anon;
grant execute on function public.remaining_active_admins(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Route 1: the grant moves or disappears (user_roles).
--
-- TWO CORRECTIONS to the original logic, and the first is the finding itself:
--
--   1. The row's user is excluded ONLY when the grant is genuinely going away. On
--      an UPDATE that keeps ADMIN, or moves it TO somebody, the count must be taken
--      with the move already applied — otherwise the check reads a state that will
--      not exist.
--   2. `new_role = 'ADMIN'` counts the arriving grant. The original tested only
--      whether an ADMIN was leaving, so a move looked like a removal with a
--      replacement that had not been counted yet.
--
-- The rule expressed plainly: after this change, is there still at least one ACTIVE
-- administrator? That is the property, and it is checked for every operation
-- rather than for the two operations the original thought of.
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_role text := case when tg_op <> 'INSERT' then to_jsonb(old) ->> 'role_code' end;
    new_role text := case when tg_op <> 'DELETE' then to_jsonb(new) ->> 'role_code' end;
    old_user uuid := case when tg_op <> 'INSERT'
                          then nullif(to_jsonb(old) ->> 'user_id', '')::uuid end;
    new_user uuid := case when tg_op <> 'DELETE'
                          then nullif(to_jsonb(new) ->> 'user_id', '')::uuid end;
    -- The user whose ADMIN status is being taken away, if any. Only that user may
    -- be excluded from the count; excluding anybody else would undercount.
    losing_user uuid;
    surviving   integer;
begin
    -- Nothing to protect unless an ADMIN grant is being lost. A grant that arrives,
    -- or one that stays where it is, cannot reduce the number of administrators.
    if old_role = 'ADMIN'
       and (new_role is distinct from 'ADMIN' or old_user is distinct from new_user)
    then
        losing_user := old_user;
    else
        return coalesce(new, old);
    end if;

    -- Count the state that WILL exist: apply the user_id move first, so an
    -- arriving grant is counted and a departing one is not.
    if new_role = 'ADMIN' and new_user is not null then
        -- The grant is moving to somebody. That somebody is an administrator after
        -- this statement, so it is counted — and the moving user is excluded.
        select count(*)::integer into surviving
          from public.user_roles ur
          join public.profiles p on p.id = ur.user_id
         where ur.role_code = 'ADMIN'
           and p.status = 'ACTIVE'
           and ur.user_id <> losing_user;
        -- Plus the new holder if they are ACTIVE (the row above already counts them
        -- when their row exists; this covers the first grant to a new user).
        if not exists (
            select 1 from public.user_roles ur
             where ur.role_code = 'ADMIN' and ur.user_id = new_user
        ) and exists (
            select 1 from public.profiles p
             where p.id = new_user and p.status = 'ACTIVE'
        ) then
            surviving := surviving + 1;
        end if;
    else
        surviving := public.remaining_active_admins(losing_user);
    end if;

    if surviving = 0 then
        raise exception
            'Refusing to remove or move the last ACTIVE ADMIN (user %). Promote or '
            'enable another administrator first.', losing_user
            using errcode = 'check_violation';
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_last_admin on public.user_roles;
create trigger trg_protect_last_admin
    before insert or update or delete on public.user_roles
    for each row execute function public.protect_last_admin();

comment on function public.protect_last_admin() is
    'An ACTIVE administrator must exist at all times. The original excluded the '
    'changed row unconditionally, so MOVING the last ADMIN grant to another user '
    'passed while leaving the original administrator with no role (audit F12).';

-- ---------------------------------------------------------------------------
-- Route 2: the administrator is DISABLED (profiles.status).
--
-- `remaining_active_admins` joins `profiles` and requires status = 'ACTIVE', so
-- disabling an account removes it from the count — but the trigger was on
-- `user_roles` and never saw it. This is the same unadministrable outcome reached
-- without touching the protected table at all.
--
-- The trigger is on the table where the change happens. Widening the old trigger
-- was not possible: a trigger sees only its own table's rows.
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_admin_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    surviving integer;
begin
    -- Only a change that REMOVES this account from the active set matters. Going
    -- ACTIVE -> ACTIVE, or DISABLED -> DISABLED, cannot reduce the count.
    if old.status = 'ACTIVE' and new.status <> 'ACTIVE' then
        -- Does this account currently hold ADMIN?
        if exists (
            select 1 from public.user_roles ur
             where ur.user_id = new.id and ur.role_code = 'ADMIN'
        ) then
            surviving := public.remaining_active_admins(new.id);
            if surviving = 0 then
                raise exception
                    'Refusing to disable the last ACTIVE ADMIN (user %). Promote or '
                    'enable another administrator first.', new.id
                    using errcode = 'check_violation';
            end if;
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_protect_last_admin_on_disable on public.profiles;
create trigger trg_protect_last_admin_on_disable
    before update on public.profiles
    for each row execute function public.protect_last_admin_on_disable();

comment on function public.protect_last_admin_on_disable() is
    'Refuses to disable the last ACTIVE administrator. The count already required '
    'status = ACTIVE, so disabling bypassed the user_roles trigger entirely — the '
    'same unadministrable state by a second route (audit F12).';

-- ---------------------------------------------------------------------------
-- Verify the property, not the statements.
-- ---------------------------------------------------------------------------
do $$
declare
    v_has_role_trigger boolean;
    v_has_disable_trigger boolean;
    v_body text;
    v_disable_body text;
begin
    select exists (
        select 1 from pg_trigger t
         where t.tgrelid = 'public.user_roles'::regclass
           and t.tgname = 'trg_protect_last_admin'
           and not t.tgisinternal
    ) into v_has_role_trigger;
    if not v_has_role_trigger then
        raise exception 'F12 guard: the user_roles last-admin trigger is missing'
            using errcode = 'insufficient_privilege';
    end if;

    select exists (
        select 1 from pg_trigger t
         where t.tgrelid = 'public.profiles'::regclass
           and t.tgname = 'trg_protect_last_admin_on_disable'
           and not t.tgisinternal
    ) into v_has_disable_trigger;
    if not v_has_disable_trigger then
        raise exception 'F12 guard: the profiles disable trigger is missing'
            using errcode = 'insufficient_privilege';
    end if;

    -- The trigger must consider the NEW user on a move, or the bypass returns. The
    -- presence of `new_user` in the body is the marker that the UPDATE path is
    -- handled rather than only the DELETE path.
    v_body := pg_get_functiondef(
        (select oid from pg_proc where proname = 'protect_last_admin')
    );
    if v_body not like '%new_user%' then
        raise exception 'F12 guard: protect_last_admin ignores the arriving grant'
            using errcode = 'insufficient_privilege';
    end if;

    v_disable_body := pg_get_functiondef(
        (select oid from pg_proc where proname = 'protect_last_admin_on_disable')
    );
    if v_disable_body not like '%remaining_active_admins%' then
        raise exception 'F12 guard: the disable trigger does not count administrators'
            using errcode = 'insufficient_privilege';
    end if;

    -- Neither new function may be anonymous-callable.
    if has_function_privilege('anon',
            'public.remaining_active_admins(uuid)', 'EXECUTE') then
        raise exception 'F12 guard: remaining_active_admins is callable without a login'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
