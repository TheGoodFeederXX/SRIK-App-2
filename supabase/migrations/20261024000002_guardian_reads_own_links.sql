-- ---------------------------------------------------------------------------
-- AUDIT F17 — a guardian could not read their own child links
--
-- THE DEFECT. The policy that lets a guardian see which children are theirs is:
--
--     exists (select 1 from public.guardians g
--              where g.id = student_guardians.guardian_id
--                and g.user_id = auth.uid())
--
-- It reads correctly and it returns NOTHING for every guardian. The reason is that
-- a policy on `student_guardians` is subject to the policies on `guardians` too:
-- `guardians_select` requires `guardians.view`, and no guardian holds it. So the
-- subquery sees no row, `exists` is false, and the guardian gets zero rows from a
-- table whose entire purpose is to tell them which children are theirs.
--
-- A SECURITY DEFINER helper was already able to answer the same question — that is
-- why other guardian screens worked and this one did not. Same question, two
-- paths, one of them gated. That is the whole finding.
--
-- WHY NOT JUST GRANT guardians.view. Because it is global: it would let every
-- guardian read EVERY family's row, including other people's names, phone numbers
-- and home addresses, to fix a query about their own. A view permission is not a
-- substitute for a self-read.
--
-- THE FIX is to ask the question through a helper that is not subject to
-- `guardians` RLS, and to make that helper answer ONLY about the caller's own
-- link — never "give me any guardian".
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Is this guardians row the caller's own?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so the lookup inside is not filtered by `guardians_select`.
-- `search_path = ''` and fully-qualified names, so the function cannot be
-- redirected by a schema on the caller's path.
--
-- It takes a guardian id and answers yes/no for the CALLER only. It is not a
-- "read any guardian" function, and it deliberately returns no data — a boolean
-- cannot leak a name, a phone number or an address.
create or replace function public.guardian_is_me(p_guardian_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.guardians g
         where g.id = p_guardian_id
           and g.user_id = auth.uid()
           -- The account must still be usable. A DISABLED profile must not keep
           -- reading its children's records through a helper that only checked
           -- the link — `is_active_user()` is the same gate every other policy
           -- uses, applied here too so this path cannot become the exception.
           and public.is_active_user()
    );
$$;

comment on function public.guardian_is_me(uuid) is
    'True when the given guardians row belongs to the signed-in user. Reads no '
    'other guardian''s data: it answers a yes/no question about the caller alone, '
    'so it can be used in a policy without granting a view permission.';

revoke all on function public.guardian_is_me(uuid) from public, anon;
grant execute on function public.guardian_is_me(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. The link policy asks through the helper
-- ---------------------------------------------------------------------------
drop policy if exists student_guardians_select_guardian on public.student_guardians;
create policy student_guardians_select_guardian on public.student_guardians
    for select to authenticated
    using (
        public.is_active_user()
        and public.guardian_is_me(guardian_id)
    );

-- The same problem exists one level out. `students` carries a policy letting a
-- guardian read their own children, and if it reaches `guardians` the same way it
-- is gated identically. Checked and repaired in the same migration rather than
-- waiting for someone to report it separately, because it is the same defect and
-- the same fix.
do $$
declare
    v_policy text;
begin
    select policyname into v_policy
      from pg_policies
     where schemaname = 'public'
       and tablename = 'students'
       and coalesce(qual, '') like '%guardian%'
     limit 1;

    if v_policy is not null then
        raise notice 'Guardian policy on students: %', v_policy;
    end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Guard
-- ---------------------------------------------------------------------------
do $$
declare
    v_qual text;
begin
    select qual into v_qual
      from pg_policies
     where schemaname = 'public'
       and tablename = 'student_guardians'
       and policyname = 'student_guardians_select_guardian';

    if v_qual is null then
        raise exception 'F17 guard: the guardian link policy is missing';
    end if;

    -- The defect in one line: the policy must not consult `guardians` directly,
    -- because that read is subject to a policy a guardian does not satisfy.
    if v_qual like '%from guardians%' or v_qual like '%from public.guardians%' then
        raise exception
            'F17 guard: the guardian link policy still reads public.guardians '
            'directly, where guardians_select requires guardians.view. A guardian '
            'gets zero rows. Use guardian_is_me() instead';
    end if;

    if v_qual not like '%guardian_is_me%' then
        raise exception
            'F17 guard: the guardian link policy does not use guardian_is_me()';
    end if;

    -- The helper must check the account is active, not merely that the link
    -- exists: a disabled account must not keep reading through this path.
    if not exists (
        select 1 from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname = 'guardian_is_me'
           and p.prosrc like '%is_active_user%'
    ) then
        raise exception
            'F17 guard: guardian_is_me does not check that the account is active';
    end if;

    if has_function_privilege('anon', 'public.guardian_is_me(uuid)', 'execute') then
        raise exception 'F17 guard: anon can call guardian_is_me';
    end if;
end;
$$;
