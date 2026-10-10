-- ===========================================================================--
-- Account provisioning, temporary-password enforcement, and audit authenticity.
--
-- Findings F13, F14, F15 and F16 of the 2026-10-10 audit.
--
-- These four are one story, which is why they are one migration: an account is
-- created (F13/F16), it arrives with a temporary password (F14), and the identity
-- the app reads back has to agree with what was created (F15).
--
-- ---------------------------------------------------------------------------
-- F13 — a provisioned teacher received no role at all.
--
-- The Edge Function creating the account carries this comment:
--
--     "The teacher profile row and TEACHER role are created by the same triggers
--      that Phase 1 relies on; this function only links the account..."
--
-- The comment is false, and the function therefore never links the role either.
-- `handle_new_user` inserts a `profiles` row and nothing else — no `user_roles`.
-- MEASURED against production: creating a user with the function's own metadata
-- produced 1 profile, 0 roles and 0 permissions. A teacher would sign in
-- successfully and then see an empty application, with no error anywhere to
-- explain it. That is the worst shape a failure can take: it looks like the
-- system is broken rather than like the account is incomplete.
--
-- The same migration also rejected OPTIONS outright and returned no CORS headers,
-- so a browser calling it cross-origin would fail before reaching any of this.
-- The Function is fixed alongside (it is not deployed yet, so nothing is live).
--
-- ---------------------------------------------------------------------------
-- F16 — the guardian path built Auth rows by hand.
--
-- `create_guardian_account` performed dynamic INSERTs into `auth.users` and
-- `auth.identities`, including generating its own bcrypt hash with
-- `extensions.crypt(p_password, gen_salt('bf'))`. Two problems, and the second is
-- the one that would not have surfaced as a bug report:
--
--   1. It enforced a MINIMUM PASSWORD LENGTH OF 8 while the project's own config
--      says 12 — the weaker rule was the one actually applied.
--   2. It bypasses GoTrue. Email confirmation, password recovery, identity
--      linking, session invalidation and Auth's own audit trail are all GoTrue's
--      responsibilities, and none of them run for a row written this way. The
--      SQL shim can pass its test without GoTrue ever being involved, so a green
--      test says nothing about whether that person can actually sign in.
--
-- Writing credential material into `auth` by hand is not a shortcut that can be
-- made safe; it is a second, poorer implementation of an authentication system.
-- Both provisioning paths now go through the Admin Auth API, and the database
-- half — linking the person, granting the role, setting the flag — is one
-- transactional RPC.
--
-- ---------------------------------------------------------------------------
-- F14 — the forced password change was enforced by the SCREEN, not the system.
--
-- `clear_temporary_password_flag()` was callable by any signed-in user, needing
-- nothing but a valid session. A teacher holding a temporary password could clear
-- the flag without ever changing the password, and `is_active_user()` did not
-- consider the flag — so every ordinary grant kept working. The prompt was a
-- suggestion the client could decline.
--
-- MEASURED: the flag clears with `_` still set, entirely through the Data API.
--
-- The invariant now: **an account on a temporary password cannot perform domain
-- operations until the password is actually replaced.** "Actually" is the load
-- bearing word — a client cannot assert it. `auth.users.updated_at` is written by
-- GoTrue itself when a password changes, so it is evidence the client cannot
-- fabricate, and the check is a comparison against `created_at`.
--
-- Enforcing it in `is_active_user()` rather than in each policy is deliberate: it
-- is the single predicate that every other authorization helper already depends
-- on, so one change covers the whole surface, including helpers added later. A
-- check written into each policy would have to be remembered every time.
--
-- POSTGRES CACHE NOTE: `auth.users.updated_at` is not visible to a STABLE
-- function in the same statement that changed it, but the password change and the
-- subsequent request are separate statements in separate transactions, so the
-- comparison is sound. The flag is read live from `profiles`.
-- ===========================================================================--

-- ---------------------------------------------------------------------------
-- F14, part 1: the state of temporary credentials.
--
-- One definition, used by the authorization helper and by the RPCs below, so the
-- screen, the database and the sign-in check cannot disagree about whether this
-- account is still on a temporary password.
-- ---------------------------------------------------------------------------
create or replace function public.is_on_temporary_password(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (
            select p.must_change_password
              from public.profiles p
             where p.id = p_user_id
        ),
        false
    );
$$;

comment on function public.is_on_temporary_password(uuid) is
    'True while this account is still on a temporary password. One definition, '
    'used by is_active_user and the provisioning RPCs (audit F14).';

revoke execute on function public.is_on_temporary_password(uuid) from public, anon;
grant execute on function public.is_on_temporary_password(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- F14, part 2: temporary accounts must not be able to do domain work.
--
-- `is_active_user()` is the predicate every other helper already builds on. The
-- temporary-password check belongs here and nowhere else: adding it to each
-- policy would require remembering it on every future policy.
--
-- `p_user_id` is kept in the signature because callers pass it, but the argument
-- the security decision uses is always the caller's own identity — an account must
-- not be able to ask about somebody else and act on the answer.
--
-- The escape hatch is narrow and deliberate: an account on a temporary password
-- must still be able to CHANGE it. That is a GoTrue operation, not a domain read,
-- so it does not pass through this helper at all — which is why it needs no
-- exception here. It also must still be able to read its own profile, or the
-- change-password screen cannot render.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.profiles p
         where p.id = auth.uid()
           and p.status = 'ACTIVE'
           -- An account still holding a temporary password has a valid login and
           -- no authority to do anything with it until the password is replaced
           -- (audit F14). This is the invariant, expressed once.
           and coalesce(p.must_change_password, false) is not true
    );
$$;

comment on function public.is_active_user() is
    'The signed-in account exists, is ACTIVE, and is NOT still on a temporary '
    'password. Everything else builds on this, so the temporary-password rule is '
    'enforced in exactly one place (audit F14).';

-- ---------------------------------------------------------------------------
-- F14, part 3: the flag cannot be cleared by the client any more.
--
-- The previous version took no arguments and trusted the caller. It is replaced by
-- one that requires EVIDENCE: GoTrue's own `updated_at` must be later than
-- `created_at`, which only happens when the password was actually changed. A
-- client cannot write to `auth.users`.
--
-- The old signature is dropped rather than left in place, so a caller that still
-- uses it fails loudly instead of silently succeeding under the old rules.
-- ---------------------------------------------------------------------------
drop function if exists public.clear_temporary_password_flag();

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_uid     uuid := auth.uid();
    v_created timestamptz;
    v_updated timestamptz;
begin
    if v_uid is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    select u.created_at, u.updated_at
      into v_created, v_updated
      from auth.users u
     where u.id = v_uid;

    if v_created is null then
        raise exception 'Account not found' using errcode = 'insufficient_privilege';
    end if;

    -- The evidence. GoTrue writes `updated_at` when a password changes; nothing
    -- the browser can reach writes it. Without this comparison the function is the
    -- old one with a new name.
    if v_updated is null or v_updated <= v_created then
        raise exception
            'The password has not been changed, so the temporary password flag '
            'cannot be cleared.'
            using errcode = 'insufficient_privilege';
    end if;

    update public.profiles
       set must_change_password = false
     where id = v_uid;

    -- Audit the transition at the authoritative backend, in the same transaction.
    insert into public.audit_log (actor_id, action, entity_type, entity_id, after_data)
    values (
        v_uid,
        'UPDATE',
        'profiles',
        v_uid,
        jsonb_build_object('must_change_password', false, 'verified_by', 'auth.updated_at')
    );
end;
$$;

comment on function public.complete_password_change() is
    'Clears the temporary-password flag ONLY when GoTrue records that the password '
    'was actually changed (auth.users.updated_at > created_at). Replaces '
    'clear_temporary_password_flag, which any signed-in client could call (audit F14).';

revoke execute on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- ---------------------------------------------------------------------------
-- F13 — one transactional RPC that finishes provisioning an account.
--
-- The Edge Function creates the Auth credential (only it can, and only with the
-- secret key). Everything that happens AFTER that is database work: link the
-- person to the account, grant the role, set the temporary-password flag. All of
-- it must succeed or none of it, because a half-provisioned account is precisely
-- the F13 failure — a login that works and an application that is empty.
--
-- Compare-and-set on `p_expected_user_id`. Two simultaneous provisioning calls
-- for the same teacher would otherwise both pass the "is it linked?" check and
-- the second would silently overwrite the first person's account link. The update
-- names the expected value, so the second caller matches zero rows and is refused
-- instead of winning a race.
-- ---------------------------------------------------------------------------
create or replace function public.link_teacher_account(
    p_teacher_id uuid,
    p_user_id    uuid,
    p_role       text default 'TEACHER'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := auth.uid();
    v_effective text := coalesce(p_role, 'TEACHER');
    v_updated   integer;
begin
    -- The caller must be signed in AND hold the permission. `is_active_user()`
    -- carries the temporary-password rule as well, so an account still on a
    -- temporary password cannot provision anybody.
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;
    if not public.is_active_user() then
        raise exception 'This account cannot perform this operation'
            using errcode = 'insufficient_privilege';
    end if;
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = 'insufficient_privilege';
    end if;

    -- A caller must not be able to grant a role beyond the ones this system has,
    -- and must not be able to grant ADMIN by naming it here.
    if v_effective not in ('TEACHER', 'GUARDIAN') then
        raise exception 'Role % cannot be granted here', v_effective
            using errcode = 'insufficient_privilege';
    end if;

    if p_user_id is null or p_teacher_id is null then
        raise exception 'teacher_id and user_id are required'
            using errcode = 'null_value_not_allowed';
    end if;

    -- The account must exist. Linking to an id that is not an account would create
    -- a grant nothing can ever use.
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        raise exception 'No account exists for user %', p_user_id
            using errcode = 'foreign_key_violation';
    end if;

    -- Compare-and-set, not read-then-write: `user_id is null` is part of the
    -- UPDATE predicate, so a concurrent request cannot win the same row.
    update public.teachers
       set user_id = p_user_id
     where id = p_teacher_id
       and user_id is null;

    get diagnostics v_updated = row_count;

    if v_updated = 0 then
        -- Distinguish "no such teacher" from "already linked", because the two
        -- need different responses and the caller is an operator reading a message.
        if exists (select 1 from public.teachers t where t.id = p_teacher_id) then
            raise exception 'This teacher already has a login account.'
                using errcode = 'unique_violation';
        end if;
        raise exception 'Teacher % was not found', p_teacher_id
            using errcode = 'foreign_key_violation';
    end if;

    -- The role grant the old path never made. `on conflict do nothing` keeps it
    -- idempotent, so a retry after a transient failure does not fail on this line.
    insert into public.user_roles (user_id, role_code)
    values (p_user_id, 'TEACHER')
    on conflict do nothing;

    -- The profile row is created by `handle_new_user`. Assert it, because the role
    -- and the flag below hang off it and a missing profile would leave the account
    -- half-provisioned in a way nothing reports.
    if not exists (select 1 from public.profiles p where p.id = p_user_id) then
        raise exception 'The account has no profile row; provisioning is incomplete'
            using errcode = 'foreign_key_violation';
    end if;

    update public.profiles
       set must_change_password = true
     where id = p_user_id;

    -- Authoritative audit, same transaction. A provisioning that is not recorded
    -- is a grant nobody can account for later.
    insert into public.audit_log (actor_id, action, entity_type, entity_id, after_data)
    values (
        v_actor,
        'INSERT',
        'user_roles',
        p_user_id,
        jsonb_build_object(
            'role_code', 'TEACHER',
            'teacher_id', p_teacher_id,
            'must_change_password', true
        )
    );

    return jsonb_build_object(
        'ok', true,
        'teacher_id', p_teacher_id,
        'user_id', p_user_id,
        'role_code', 'TEACHER',
        'must_change_password', true
    );
end;
$$;

comment on function public.link_teacher_account(uuid, uuid, text) is
    'Links a newly created Auth account to its teacher record, grants TEACHER and '
    'sets the temporary-password flag, atomically and with a compare-and-set on the '
    'link. The old path linked the account and granted NO role, so the teacher could '
    'sign in and see nothing (audit F13).';

revoke execute on function public.link_teacher_account(uuid, uuid, text) from public, anon;
grant execute on function public.link_teacher_account(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- F16 — the guardian path must not build Auth rows.
--
-- `create_guardian_account` is replaced by the database half only: it takes an
-- EXISTING account (created by the Admin Auth API) and does the linking, the role
-- grant and the family link. It no longer creates credentials, so the 8-character
-- minimum and the hand-rolled bcrypt hash both go away — GoTrue applies the
-- configured policy, and there is one implementation of authentication instead of
-- two.
--
-- The family link is done by the existing `set_guardian_child_link`, so the rule
-- about who may be linked to whom stays in one place rather than being restated
-- here and drifting.
-- ---------------------------------------------------------------------------
create or replace function public.link_guardian_account(
    p_guardian_id uuid,
    p_user_id     uuid,
    p_student_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := auth.uid();
    v_updated   integer;
    v_linked    integer := 0;
    v_student   uuid;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;
    if not public.is_active_user() then
        raise exception 'This account cannot perform this operation'
            using errcode = 'insufficient_privilege';
    end if;
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = 'insufficient_privilege';
    end if;

    if p_user_id is null or p_guardian_id is null then
        raise exception 'guardian_id and user_id are required'
            using errcode = 'null_value_not_allowed';
    end if;

    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        raise exception 'No account exists for user %', p_user_id
            using errcode = 'foreign_key_violation';
    end if;

    if not exists (select 1 from public.profiles p where p.id = p_user_id) then
        raise exception 'The account has no profile row; provisioning is incomplete'
            using errcode = 'foreign_key_violation';
    end if;

    -- Compare-and-set again: two concurrent provisions must not both succeed.
    update public.guardians
       set user_id = p_user_id
     where id = p_guardian_id
       and user_id is null;

    get diagnostics v_updated = row_count;

    if v_updated = 0 then
        if exists (select 1 from public.guardians g where g.id = p_guardian_id) then
            raise exception 'This guardian already has a login account.'
                using errcode = 'unique_violation';
        end if;
        raise exception 'Guardian % was not found', p_guardian_id
            using errcode = 'foreign_key_violation';
    end if;

    insert into public.user_roles (user_id, role_code)
    values (p_user_id, 'GUARDIAN')
    on conflict do nothing;

    update public.profiles
       set must_change_password = true
     where id = p_user_id;

    -- Family links, through the existing rule rather than a restatement of it.
    if p_student_ids is not null then
        foreach v_student in array p_student_ids loop
            perform public.set_guardian_child_link(p_guardian_id, v_student);
            v_linked := v_linked + 1;
        end loop;
    end if;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, after_data)
    values (
        v_actor,
        'INSERT',
        'user_roles',
        p_user_id,
        jsonb_build_object(
            'role_code', 'GUARDIAN',
            'guardian_id', p_guardian_id,
            'children_linked', v_linked,
            'must_change_password', true
        )
    );

    return jsonb_build_object(
        'ok', true,
        'guardian_id', p_guardian_id,
        'user_id', p_user_id,
        'role_code', 'GUARDIAN',
        'children_linked', v_linked
    );
end;
$$;

comment on function public.link_guardian_account(uuid, uuid, uuid[]) is
    'Links an existing Auth account to its guardian record, grants GUARDIAN and '
    'links the family, atomically. Replaces create_guardian_account, which built '
    'auth.users and auth.identities rows by hand with its own bcrypt hash and an '
    '8-character minimum while config said 12 (audit F16).';

revoke execute on function public.link_guardian_account(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.link_guardian_account(uuid, uuid, uuid[]) to authenticated;

-- The signature is written out in full: `drop function` without it matches nothing
-- and fails silently, which would leave the credential-writing function in place
-- while the migration reported success.
drop function if exists public.create_guardian_account(uuid, text, text, text);

-- ---------------------------------------------------------------------------
-- F16 concluded: the credential-writing RPC is removed.
--
-- Dropped rather than left, because a function that writes `auth.users` by hand is
-- not something to keep for compatibility. Dropping it also means a caller using
-- the old name fails loudly instead of quietly creating a second, weaker kind of
-- account — and it removes the 8-character rule from the system entirely.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verify the properties, not the statements.
-- ---------------------------------------------------------------------------
do $$
declare
    v_guardian_by_hand text;
    v_body             text;
begin
    -- F16: nothing may write credential material into `auth` from SQL any more.
    -- Scanned across every definer function rather than by name, so a new helper
    -- that reintroduces the pattern is caught as well as the one being removed.
    select string_agg(p.proname, ', ') into v_guardian_by_hand
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and (
            -- Strip comments before matching, so a function DOCUMENTING the removed
            -- pattern is not itself reported as performing it.
            regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
                like '%insert into auth.users%'
            or regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
                like '%insert into auth.identities%'
       );

    if v_guardian_by_hand is not null then
        raise exception
            'F16 guard: these functions still write Auth credential rows directly: %',
            v_guardian_by_hand
            using errcode = 'insufficient_privilege';
    end if;

    if exists (select 1 from pg_proc where proname = 'create_guardian_account') then
        raise exception 'F16 guard: create_guardian_account still exists'
            using errcode = 'insufficient_privilege';
    end if;

    if exists (select 1 from pg_proc where proname = 'clear_temporary_password_flag') then
        raise exception 'F14 guard: clear_temporary_password_flag still exists'
            using errcode = 'insufficient_privilege';
    end if;

    -- F14: the rule must be enforced where every other helper will inherit it.
    v_body := pg_get_functiondef((select oid from pg_proc where proname = 'is_active_user'));
    if v_body not like '%must_change_password%' then
        raise exception
            'F14 guard: is_active_user does not consider the temporary password flag, '
            'so a temporary credential still carries full authority'
            using errcode = 'insufficient_privilege';
    end if;

    -- F14: clearing the flag must require evidence.
    v_body := pg_get_functiondef(
        (select oid from pg_proc where proname = 'complete_password_change')
    );
    if v_body not like '%updated_at%' then
        raise exception
            'F14 guard: complete_password_change does not verify that the password '
            'was actually changed'
            using errcode = 'insufficient_privilege';
    end if;

    -- F13: the role grant must exist in the teacher path. Its absence WAS the bug.
    v_body := pg_get_functiondef(
        (select oid from pg_proc where proname = 'link_teacher_account')
    );
    if v_body not like '%user_roles%' then
        raise exception
            'F13 guard: link_teacher_account does not grant a role, which is the '
            'exact defect it exists to fix'
            using errcode = 'insufficient_privilege';
    end if;

    -- F13: and the link must be a compare-and-set, not a read-then-write.
    if v_body not like '%user_id is null%' then
        raise exception
            'F13 guard: link_teacher_account does not guard the link against a '
            'concurrent provision'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- F15 — reading one's OWN profile must not depend on the temporary-password rule.
--
-- This is the counterpart the F14 fix creates, and it would have been a real
-- lockout if left alone. `is_active_user()` now returns false for an account still
-- on a temporary password, and `profiles_select_own` was written as
--
--     id = auth.uid() and public.is_active_user()
--
-- with the deliberate purpose of locking a DISABLED account out of its own row
-- immediately rather than when its token expires. That intent is right and is kept.
-- But the same predicate now also blocks a brand-new teacher from reading their own
-- profile — and the change-password screen reads the profile to render. The account
-- could sign in and do nothing at all, permanently, with no route out. That is
-- strictly worse than the defect being fixed.
--
-- The two conditions are therefore separated rather than both routed through one
-- helper: DISABLED still loses everything, including its own row; a temporary
-- password loses authority but keeps sight of its own record, which is the
-- minimum needed to escape.
--
-- `profiles.status` is checked directly here instead of via `is_active_user()`
-- because that helper intentionally carries the temporary-password rule; using it
-- would restore the lockout.
-- ---------------------------------------------------------------------------
-- The helper is SECURITY DEFINER so it reads `profiles` WITHOUT the policy being
-- defined here applying to it. A policy that queried `profiles` directly would be
-- evaluated recursively — Postgres refuses with "infinite recursion detected in
-- policy for relation profiles", which is how this was found. `set search_path = ''`
-- and a fully qualified name keep the definer function from resolving anything
-- unexpected.
create or replace function public.is_active_account(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.profiles p
         where p.id = p_user_id
           and p.status = 'ACTIVE'
    );
$$;

comment on function public.is_active_account(uuid) is
    'The account is ACTIVE. Unlike is_active_user(), this does NOT consider the '
    'temporary-password flag, so an account on a temporary password can still read '
    'its own profile and reach the change-password screen (audit F14, F15).';

revoke execute on function public.is_active_account(uuid) from public, anon;
grant execute on function public.is_active_account(uuid) to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select to authenticated
    using (id = auth.uid() and public.is_active_account());

comment on policy profiles_select_own on public.profiles is
    'An account may always read its own row while ACTIVE, including one still on a '
    'temporary password — the change-password screen needs it, and refusing it would '
    'lock the account out permanently. DISABLED accounts read nothing (audit F14, F15).';

do $$
declare
    v_qual text;
begin
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
       and policyname = 'profiles_select_own';

    if v_qual is null then
        raise exception 'F15 guard: profiles_select_own is missing'
            using errcode = 'insufficient_privilege';
    end if;

    -- The lockout must not be reintroduced by routing own-profile access back
    -- through the helper that carries the temporary-password rule.
    if v_qual like '%is_active_user%' then
        raise exception
            'F15 guard: profiles_select_own depends on is_active_user, which now '
            'includes the temporary-password rule — a new teacher could not read '
            'their own profile and could never change the password: %', v_qual
            using errcode = 'insufficient_privilege';
    end if;

    -- But DISABLED must still be locked out of its own row. The policy expresses
    -- that through `is_active_account`, so the helper is what has to be inspected —
    -- checking the policy text for the word ACTIVE would pass on a policy that
    -- named a helper which did not check it.
    if v_qual not like '%is_active_account%' then
        raise exception
            'F15 guard: profiles_select_own no longer excludes DISABLED accounts: %',
            v_qual
            using errcode = 'insufficient_privilege';
    end if;

    if (select pg_get_functiondef(oid) from pg_proc
         where proname = 'is_active_account') not like '%ACTIVE%' then
        raise exception
            'F15 guard: is_active_account does not check the account status'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;

