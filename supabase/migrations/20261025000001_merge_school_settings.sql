-- AUDIT F27 — a settings save must not silently discard another screen's change.
--
-- WHAT WENT WRONG. `school_profile.settings` is one jsonb column holding every
-- screen's configuration. Each screen read the whole object, changed its own key,
-- and wrote the whole object back. Two screens writing different keys therefore
-- raced: the second save wrote a copy of the object it had read BEFORE the first
-- save, so the first screen's change disappeared. Nothing errored. The setting was
-- simply gone, and the next person to open that screen saw the old value.
--
-- This is the same class of bug as a lost update in any read-modify-write, and it
-- is worst on settings because nobody re-reads them: an office changes the grading
-- scale and a week later a report card uses the old one.
--
-- The merge is done as ONE statement in the database, so two concurrent saves
-- cannot interleave and both changes survive.

create or replace function public.merge_school_settings(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Only an active user may change the school's settings, and the database is
    -- what enforces it. `settings.manage` is what the policies on this table
    -- already require; the check is repeated here because a `security definer`
    -- function runs with the definer's rights and would otherwise skip them.
    if not public.is_active_user() or not public.has_permission('settings.manage') then
        raise exception 'Not allowed to change the school settings'
            using errcode = 'insufficient_privilege';
    end if;

    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'The settings to merge must be an object'
            using errcode = 'invalid_parameter_value';
    end if;

    -- `||` merges at the TOP level only, which is what a keyed settings object
    -- wants: updating `branding` replaces the whole `branding` key rather than
    -- merging into it. That is deliberate — a nested merge would make it
    -- impossible to REMOVE a key, since there is no way to distinguish "absent"
    -- from "set to null".
    update public.school_profile
       set settings = coalesce(settings, '{}'::jsonb) || p_patch,
           updated_at = now()
     where id is not null;
end;
$$;

revoke all on function public.merge_school_settings(jsonb) from public, anon;
grant execute on function public.merge_school_settings(jsonb) to authenticated;

-- Guard: the merge must be a single update over the whole object. If someone
-- rewrites this to read-then-write, the lost update comes back, and it comes back
-- silently — so the shape is pinned.
do $guard$
declare
    v_src text;
begin
    select p.prosrc into v_src
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'merge_school_settings';

    if v_src is null then
        raise exception 'F27: merge_school_settings was not created';
    end if;

    if v_src !~ '\|\| p_patch' then
        raise exception 'F27: merge_school_settings no longer merges the patch';
    end if;

    if v_src !~ 'has_permission' then
        raise exception 'F27: merge_school_settings does not check the permission';
    end if;

    -- A separate select followed by an update is the read-modify-write that loses
    -- the other screen's change.
    if v_src ~ 'select\s+settings\s+into' then
        raise exception 'F27: merge_school_settings reads settings first — that is the lost update';
    end if;

    if has_function_privilege('anon', 'public.merge_school_settings(jsonb)', 'execute') then
        raise exception 'F27: anon can execute merge_school_settings';
    end if;
end;
$guard$;
