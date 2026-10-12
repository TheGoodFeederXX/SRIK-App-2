-- AUDIT F05 — a DISABLED guardian account still resolved its child links. (P1)
--
-- THE FINDING, CONFIRMED ON PRODUCTION, and one of the four the audit called out with evidence
-- rather than reasoning. `current_guardian_child_ids` matched the guardian row by user id and
-- nothing else:
--
--     select coalesce(array_agg(sg.student_id), '{}'::uuid[])
--       from public.student_guardians sg
--       join public.guardians g on g.id = sg.guardian_id
--      where g.user_id = auth.uid();
--
-- I reproduced it: a guardian whose profile is DISABLED still got `1` child back from
-- `current_guardian_child_ids()`. The student rows themselves were withheld — but only
-- because `students_select_guardian` happens to wrap the call in `is_active_user()`. Every
-- policy and every RPC that reads this helper WITHOUT that wrapper is exposed, and there is no
-- way to know from here which of them is one.
--
-- WHY THE FIX GOES HERE AND NOT IN EACH POLICY. The audit's own recommendation is to centralise
-- the active-account check in the guardian helper. A per-policy fix has to be repeated
-- correctly in every caller, and the one that is forgotten is the hole. A disabled account
-- should not resolve to a child ANYWHERE, so the helper returns nothing at all.
--
-- `guardians` has no status column of its own — the account state lives on `profiles` — so the
-- profile is the only place to ask. This mirrors what `is_active_user()` already enforces
-- everywhere else, and it makes the helper safe to call from any policy.

create or replace function public.current_guardian_child_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
    -- A disabled (or archived) account is not a guardian of anybody. Checking here, once,
    -- means no caller can forget it.
    select coalesce(array_agg(sg.student_id), '{}'::uuid[])
      from public.student_guardians sg
      join public.guardians g on g.id = sg.guardian_id
      join public.profiles  p on p.id = g.user_id
     where g.user_id = (select auth.uid())
       and p.status = 'ACTIVE';
$$;

-- It is a SECURITY DEFINER helper that reads the caller's own links, so it must stay callable by
-- authenticated users — but never by anon, and never by PUBLIC at large.
revoke all on function public.current_guardian_child_ids() from public, anon;
grant execute on function public.current_guardian_child_ids() to authenticated;

do $guard$
declare v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'current_guardian_child_ids';
    if v_src is null then
        raise exception 'F05: current_guardian_child_ids is missing';
    end if;
    if v_src !~ 'p\.status = ''ACTIVE''' then
        raise exception 'F05: a disabled guardian would still resolve their children';
    end if;
    if v_src !~ 'auth\.uid\(\)' then
        raise exception 'F05: the helper no longer ties to the caller';
    end if;
    if has_function_privilege('anon', 'public.current_guardian_child_ids()', 'execute') then
        raise exception 'F05: anon must not be able to call this helper';
    end if;
end;
$guard$;
