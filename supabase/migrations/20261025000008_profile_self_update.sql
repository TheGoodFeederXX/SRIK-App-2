-- AUDIT F27 — nobody could edit their own profile.
--
-- TWO SEPARATE FAULTS, found one behind the other.
--
-- FIRST, THE SCREEN CALLED A SERVER THAT IS NOT DEPLOYED. `updateProfile` posted to
-- `/users/me/profile`. It threw on every save, the caller caught it, and the person saw
-- "Error updating profile" — or, on the paths that ignore the error, a success message for
-- a change that was never stored.
--
-- SECOND, AND WHY REWIRING ALONE WAS NOT ENOUGH: `profiles` has NO update policy for a
-- person editing themselves. The only write rule is:
--
--     profiles_manage | ALL | has_permission('users.manage')
--
-- So a teacher or a guardian could not change their own name or phone number even if the
-- screen had called the right place. Only an admin could. A staff member's own contact
-- details are theirs to keep current, and the school's directory is wrong until they can.
--
-- THE RULE IS DELIBERATELY NARROW. A person may change FOUR columns on THEIR OWN row:
-- full_name, display_name, phone and avatar_storage_key. Nothing else. In particular
-- `status` and `must_change_password` are NOT included — a user who could set their own
-- status could re-enable a disabled account, and one who could clear the password-change
-- flag could skip a forced reset. Roles are not touched here either; they live in
-- `user_roles`, which this policy does not reach.

-- A POLICY THE REPOSITORY NEVER CREATED. Phase 1 states, in a comment, "NO UPDATE grant on
-- profiles for authenticated", and creates no staff write policy. Production has both
-- anyway — someone added them by hand.
--
-- That is schema DRIFT: the live database cannot be rebuilt from this repository, and a
-- fresh environment would behave differently from production in a way nothing announces.
-- This migration is where they become reproducible.
drop policy if exists profiles_manage on public.profiles;
create policy profiles_manage on public.profiles
    for all
    to authenticated
    using (public.has_permission('users.manage'))
    with check (public.has_permission('users.manage'));

comment on policy profiles_manage on public.profiles is
    'The office may read and write any profile. Restored here because production had it '
    'and no migration created it — the repository could not rebuild the live database.';

drop policy if exists profiles_update_own on public.profiles;
-- AND THE TABLE GRANT WAS MISSING TOO. `authenticated` holds SELECT on `profiles` but no
-- UPDATE whatsoever, so even a policy would have been unreachable: Postgres checks the
-- grant before it consults row rules. Granting it here is what makes the policy above do
-- anything at all — and the COLUMN list is the point. A person may write their name,
-- display name, phone and picture. They cannot write `status`, `must_change_password`,
-- `disabled_at` or `disabled_by`, because those are not in the list; the trigger below is
-- the second line of defence rather than the only one.
-- Column-level is not enough on its own. `authenticated` holds only SELECT at the table
-- level, and a column grant does not create the table privilege — Postgres checks the
-- table privilege first and refuses before it ever looks at the column list, which is why
-- this needs BOTH statements. The column grant is what then narrows the personal path.
grant update on public.profiles to authenticated;
grant update (full_name, display_name, phone, avatar_storage_key)
    on public.profiles to authenticated;

-- AND THE OFFICE MUST NOT LOSE ITS OWN POWER. Granting only those four columns to
-- `authenticated` would ALSO stop an admin from disabling an account — which is a job the
-- school must be able to do.
--
-- MY FIRST ATTEMPT AT THIS WAS WRONG, and the test caught it. I created a second role
-- holding the wider grant and gave it to `authenticated`. That cannot work: Supabase
-- creates `authenticated` as NOINHERIT, so a role granted to it is never actually used —
-- membership exists on paper and confers nothing. The office grant was dead the moment it
-- was written, and only a test that actually tried to disable someone found it.
--
-- So the column grant is given to `authenticated` DIRECTLY. Every signed-in user therefore
-- holds the columns, and the TRIGGER below is what separates them: it refuses a change to
-- status, must_change_password, disabled_at or disabled_by unless the caller holds
-- `users.manage`. The grant decides what is reachable; the policy and trigger decide WHO.
-- That is the only arrangement that works with a NOINHERIT role.
grant update (full_name, display_name, phone, avatar_storage_key,
              status, disabled_at, disabled_by)
    on public.profiles to authenticated;

create policy profiles_update_own on public.profiles
    for update
    to authenticated
    using (id = (select auth.uid()) and public.is_active_account())
    with check (id = (select auth.uid()) and public.is_active_account());

comment on policy profiles_update_own on public.profiles is
    'A person may update their OWN profile row. Column-level restrictions are enforced by '
    'a trigger, because a policy cannot name columns: status and must_change_password must '
    'never be self-editable.';

-- A policy cannot restrict WHICH columns are written, so a trigger does. Without it, this
-- policy would let any signed-in user set their own status to ACTIVE and undo a disable.
create or replace function public.enforce_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Only constrain a person editing THEMSELVES. Staff with users.manage keep full
    -- control, and a superuser or a service task is not affected.
    if (select auth.uid()) is distinct from new.id then
        return new;
    end if;
    if public.has_permission('users.manage') then
        return new;
    end if;

    if new.status is distinct from old.status then
        raise exception 'You cannot change your own account status'
            using errcode = 'insufficient_privilege';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
        raise exception 'You cannot change your own password-change requirement'
            using errcode = 'insufficient_privilege';
    end if;
    if new.disabled_at is distinct from old.disabled_at
       or new.disabled_by is distinct from old.disabled_by then
        raise exception 'You cannot change your own disabled state'
            using errcode = 'insufficient_privilege';
    end if;
    if new.id is distinct from old.id then
        raise exception 'A profile cannot be moved to another person'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end;
$$;

drop trigger if exists profiles_enforce_self_update on public.profiles;
create trigger profiles_enforce_self_update
    before update on public.profiles
    for each row
    execute function public.enforce_profile_self_update();

-- Guard: the policy must exist, and the trigger must still refuse the escalation that
-- matters — a user re-enabling their own disabled account.
do $guard$
declare
    v_count int;
    v_src text;
begin
    select count(*) into v_count from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
       and policyname = 'profiles_update_own' and cmd = 'UPDATE';
    if v_count <> 1 then
        raise exception 'F27: profiles_update_own was not created — nobody can edit their own profile';
    end if;

    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_profile_self_update';
    if v_src is null then
        raise exception 'F27: enforce_profile_self_update was not created';
    end if;
    if v_src !~ 'must_change_password' then
        raise exception 'F27: a user could clear their own password-change requirement';
    end if;
    if v_src !~ 'new\.status' then
        raise exception 'F27: a user could change their own account status';
    end if;

    -- The office must keep the ability to disable an account. `authenticated` carries the
    -- column because it is NOINHERIT, so a granted role would confer nothing; the trigger
    -- is what restricts it to staff who hold users.manage.
    if not has_column_privilege('authenticated', 'public.profiles', 'status', 'update') then
        raise exception 'F27: the office can no longer disable an account';
    end if;
    -- And the trigger must be the thing that gates it.
    if v_src !~ 'has_permission' then
        raise exception 'F27: the trigger does not check the staff permission';
    end if;

    if not exists (
        select 1 from pg_trigger
         where tgrelid = 'public.profiles'::regclass
           and tgname = 'profiles_enforce_self_update'
           and not tgisinternal
    ) then
        raise exception 'F27: the self-update trigger is not attached to profiles';
    end if;
end;
$guard$;
