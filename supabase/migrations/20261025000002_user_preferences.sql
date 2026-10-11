-- AUDIT F27 — a person's own settings have nowhere to live.
--
-- WHAT WAS WRONG. Three screens — the office's notification settings, a parent's
-- notification settings, and the digest form — read and wrote notification
-- preferences through an Express endpoint that is not deployed. So the switches
-- moved, nothing was saved, and they were back where they started on the next
-- visit. Nobody was told.
--
-- WHY A NEW TABLE RATHER THAN A COLUMN ON `profiles`. A preference is about the
-- PERSON, not their account record. Keeping it on `profiles` would mean every read
-- of a person pulls their notification choices, every update of those choices
-- touches the row that holds their name and status, and the office's own policies
-- on `profiles` would govern them. A separate table also lets the shape change —
-- preferences are the kind of thing that grows a key every term.
--
-- DENY BY DEFAULT. RLS is forced, and the ONLY policy lets a signed-in person
-- reach their own row. There is no policy that lets anyone read another person's
-- preferences, so an admin cannot either — which is correct: whether a teacher
-- wants an email digest is not the office's business, and no screen needs it.

create table if not exists public.user_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    -- One jsonb object, merged rather than replaced, for the same reason
    -- `school_profile.settings` is: two screens writing different keys must not
    -- erase each other.
    preferences jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.user_preferences is
    'Per-person application settings. Readable and writable only by that person.';
comment on column public.user_preferences.preferences is
    'Merged key by key via merge_my_preferences(). Never written whole by a screen.';

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

-- The only policy. `auth.uid()` is the session's own user, so this cannot be
-- widened by a bug in the app: the database decides, and it decides "your own row".
drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
    for all
    to authenticated
    using (public.is_active_user() and user_id = (select auth.uid()))
    with check (public.is_active_user() and user_id = (select auth.uid()));

grant select, insert, update on public.user_preferences to authenticated;

-- Reads one's own preferences, or an empty object when nothing is saved yet.
create or replace function public.my_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select p.preferences from public.user_preferences p
          where p.user_id = (select auth.uid())),
        '{}'::jsonb
    );
$$;

revoke all on function public.my_preferences() from public, anon;
grant execute on function public.my_preferences() to authenticated;

-- Merges keys into one's own preferences.
--
-- One statement, so two screens saving different keys cannot interleave — the same
-- lost update as the school settings, and the same fix.
create or replace function public.merge_my_preferences(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if not public.is_active_user() then
        raise exception 'Not allowed to change preferences'
            using errcode = 'insufficient_privilege';
    end if;
    if v_actor is null then
        raise exception 'Not signed in'
            using errcode = 'insufficient_privilege';
    end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'The preferences to merge must be an object'
            using errcode = 'invalid_parameter_value';
    end if;

    -- The row is created on first save, and merged afterwards. `on conflict` keeps
    -- it one statement, which is what stops the interleave.
    insert into public.user_preferences (user_id, preferences)
    values (v_actor, p_patch)
    on conflict (user_id) do update
       set preferences = public.user_preferences.preferences || p_patch,
           updated_at = now();
end;
$$;

revoke all on function public.merge_my_preferences(jsonb) from public, anon;
grant execute on function public.merge_my_preferences(jsonb) to authenticated;

-- Guard: the shape that loses data must not come back, and the row must never be
-- reachable by anyone but its owner.
do $guard$
declare
    v_src text;
    v_forced boolean;
    v_policies integer;
    v_qual text;
begin
    select p.prosrc into v_src
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'merge_my_preferences';

    if v_src is null then
        raise exception 'F27: merge_my_preferences was not created';
    end if;
    if v_src ~ 'select\s+preferences\s+into' then
        raise exception 'F27: merge_my_preferences reads first — that is the lost update';
    end if;
    if v_src !~ '\|\| p_patch' then
        raise exception 'F27: merge_my_preferences does not merge the patch';
    end if;

    select c.relrowsecurity and c.relforcerowsecurity into v_forced
      from pg_class c where c.oid = 'public.user_preferences'::regclass;
    if not v_forced then
        raise exception 'F27: user_preferences does not have RLS forced';
    end if;

    select count(*), max(coalesce(qual, with_check)) into v_policies, v_qual
      from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences';

    if v_policies <> 1 then
        raise exception 'F27: expected exactly one policy on user_preferences, found %', v_policies;
    end if;
    -- The using clause must pin the row to the caller. Without this, the single
    -- policy could be `true` and every person's preferences would be readable.
    if v_qual !~ 'auth\.uid\(\)' then
        raise exception 'F27: the policy on user_preferences does not restrict to the caller';
    end if;

    if has_function_privilege('anon', 'public.merge_my_preferences(jsonb)', 'execute')
       or has_function_privilege('anon', 'public.my_preferences()', 'execute') then
        raise exception 'F27: anon can reach the preferences functions';
    end if;
end;
$guard$;
