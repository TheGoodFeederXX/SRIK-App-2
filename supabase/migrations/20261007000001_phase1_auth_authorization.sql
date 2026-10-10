-- =============================================================================
-- SRIK Phase 1 — Supabase Auth, profiles and authorization foundation
-- =============================================================================
-- Reference: docs/srik/03_PHASE_1_SUPABASE_AUTH.md
--
-- This migration creates the authorization foundation that every later phase
-- depends on. It is intentionally narrow: no domain tables (students, classes,
-- timetable, finance) are created here. Phase 2+ add those.
--
-- Design rules taken from docs/srik/AGENTS.md:
--   * Deny by default. No permissive CRUD policies "to complete a checklist".
--   * The database is the authoritative authorization layer; the JWT is only a
--     hint about identity, never the source of permissions.
--   * Effective permissions are the UNION of role grants and individual grants.
--   * Every table exposed through the Data API enables RLS with explicit grants.
--   * Privileged functions are SECURITY DEFINER with a safe search_path,
--     qualified object names and minimum EXECUTE grants.
--   * Disabled profiles are rejected even while their JWT is still valid.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto is used here for
-- crypt()/gen_salt() in the password-adjacent helpers. Both already exist on
-- the project, but declaring them keeps a fresh database reproducible.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------
-- Roles are deliberately limited to ADMIN and TEACHER. Guru Data / Jadual /
-- Peperiksaan are NOT roles — they are extra permissions granted to a TEACHER
-- (see 01_DECISIONS.md "Tanggungjawab khas").
do $$
begin
    if not exists (select 1 from pg_type where typname = 'app_role') then
        create type public.app_role as enum ('ADMIN', 'TEACHER');
    end if;
    if not exists (select 1 from pg_type where typname = 'profile_status') then
        create type public.profile_status as enum ('ACTIVE', 'DISABLED', 'ARCHIVED');
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles — one row per auth.users row
-- ---------------------------------------------------------------------------
-- Split deliberately: `profiles` holds self-editable fields (display_name,
-- avatar), while role/status/permission data lives in separate tables guarded
-- by stricter policies. Merging them would let a user self-escalate by
-- updating their own row, because RLS row checks do not protect individual
-- columns.
create table if not exists public.profiles (
    id            uuid primary key references auth.users(id) on delete cascade,
    full_name     text        not null default '',
    display_name  text,
    phone         text,
    avatar_storage_key text,
    status        public.profile_status not null default 'ACTIVE',
    -- Set when an administrator deactivates the account, so an audit trail
    -- survives even after the auth user is removed.
    disabled_at   timestamptz,
    disabled_by   uuid references auth.users(id) on delete set null,
    last_seen_at  timestamptz,
    -- TRUE when an administrator created the account with a temporary password.
    -- The password is therefore known to someone other than its owner, so it
    -- must be replaced before the account is usable for real work. Cleared by
    -- update_my_profile() when the user sets their own password.
    must_change_password boolean not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Backfill for databases created before this column existed: `create table if
-- not exists` silently skips an existing table, so the column must be added
-- explicitly for the migration to be safe to re-run on an older database.
alter table public.profiles
    add column if not exists must_change_password boolean not null default false;

comment on table public.profiles is
    'SRIK user profile. One row per auth.users row. Holds self-editable fields '
    'only; role, status and permission data live in separate guarded tables.';
comment on column public.profiles.status is
    'ACTIVE users may sign in. DISABLED is enforced in RLS even when the JWT is '
    'still valid (see is_active_user()).';

-- ---------------------------------------------------------------------------
-- 3. roles, permissions and the two grant paths
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
    code        text primary key,
    name        text not null,
    description text,
    -- System roles cannot be deleted; removing ADMIN/TEACHER would orphan the
    -- authorization model.
    is_system   boolean not null default false,
    created_at  timestamptz not null default now()
);

-- Single registry of permission names. Using one table (rather than free-form
-- text on grants) prevents `students.manage` in one place and granular
-- `students.create` in another, which 03_PHASE_1 explicitly warns against.
create table if not exists public.permissions (
    code        text primary key,
    description text,
    -- Grouping is for the admin UI, not for authorization decisions.
    category    text not null,
    created_at  timestamptz not null default now()
);

create table if not exists public.role_permissions (
    role_code       text not null references public.roles(code)       on delete cascade,
    permission_code text not null references public.permissions(code) on delete cascade,
    granted_at      timestamptz not null default now(),
    primary key (role_code, permission_code)
);

-- PROPOSED addition from 03_PHASE_1: per-user extra grants, so a TEACHER can
-- hold Guru Data duties without inventing a new role. V1 supports ADDITIVE
-- grants only — there is no deny-override, because a deny layer interacting
-- with role grants is a common source of "why can this user see that?" bugs.
-- Effective permission = role grants UNION individual grants.
create table if not exists public.user_permissions (
    user_id         uuid not null references auth.users(id) on delete cascade,
    permission_code text not null references public.permissions(code) on delete cascade,
    granted_by      uuid references auth.users(id) on delete set null,
    granted_at      timestamptz not null default now(),
    reason          text,
    primary key (user_id, permission_code)
);

create table if not exists public.user_roles (
    user_id    uuid not null references auth.users(id) on delete cascade,
    role_code  text not null references public.roles(code)  on delete restrict,
    granted_by uuid references auth.users(id) on delete set null,
    granted_at timestamptz not null default now(),
    primary key (user_id, role_code)
);

comment on table public.user_permissions is
    'Additive per-user permission grants. UNIONed with role grants; there is no '
    'deny override in v1. Granting requires users.manage.';

-- Indexes for the permission lookup path (called on every RLS check).
create index if not exists idx_user_roles_user        on public.user_roles(user_id);
create index if not exists idx_user_permissions_user  on public.user_permissions(user_id);
create index if not exists idx_role_permissions_role  on public.role_permissions(role_code);
create index if not exists idx_profiles_status        on public.profiles(status);

-- ---------------------------------------------------------------------------
-- 4. updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
    before update on public.profiles
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Authorization helpers
-- ---------------------------------------------------------------------------
-- All helpers are STABLE (same result within a statement) and SECURITY DEFINER
-- so they can read the grant tables regardless of the caller's own RLS. Each
-- pins search_path and uses fully-qualified names.

-- Is the caller a real, enabled account? A DISABLED or missing profile is
-- treated as unauthenticated, which is what makes disabling take effect
-- immediately instead of waiting for the JWT to expire.
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
    );
$$;

comment on function public.is_active_user() is
    'True only when auth.uid() has an ACTIVE profile. DISABLED profiles fail '
    'here so they are locked out even while holding a valid JWT.';

-- Effective permission check: role grants UNION individual grants.
-- ADMIN receives its permissions through role_permissions like everyone else
-- (03_PHASE_1: "ADMIN menerima permissions melalui table, bukan bypass semua
-- policy"), so there is no special-case bypass in this function.
create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_active_user()
       and (
            exists (
                select 1
                from public.user_roles ur
                join public.role_permissions rp on rp.role_code = ur.role_code
                where ur.user_id = auth.uid()
                  and rp.permission_code = has_permission.permission_code
            )
            or exists (
                select 1
                from public.user_permissions up
                where up.user_id = auth.uid()
                  and up.permission_code = has_permission.permission_code
            )
       );
$$;

comment on function public.has_permission(text) is
    'Effective permission = role grants UNION individual grants, and only for '
    'an ACTIVE profile. This is the single authorization entry point for RLS.';

-- Does the caller hold any of the supplied roles?
create or replace function public.has_role(role_codes public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_active_user()
       and exists (
            select 1
            from public.user_roles ur
            where ur.user_id = auth.uid()
              and ur.role_code = any (select unnest(role_codes)::text)
       );
$$;

-- Count of ACTIVE ADMINs. Used to block removing the last administrator, which
-- would otherwise make the system permanently unadministrable.
create or replace function public.active_admin_count()
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
      and p.status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------------------
-- 6. Last-admin protection
-- ---------------------------------------------------------------------------
-- Enforced as a trigger rather than in application code, because the same
-- operation is reachable from the Data API, from RPC and from an admin script.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    remaining  integer;
    old_json   jsonb := to_jsonb(old);
    old_role   text  := old_json ->> 'role_code';
    old_user   uuid  := nullif(old_json ->> 'user_id', '')::uuid;
    new_role   text  := case when tg_op = 'UPDATE' then to_jsonb(new) ->> 'role_code' end;
begin
    -- Only meaningful when an ADMIN grant is disappearing.
    if old_role = 'ADMIN'
       and (tg_op = 'DELETE' or new_role <> 'ADMIN') then

        -- Count ACTIVE ADMINS excluding the row being removed.
        select count(*)::integer into remaining
        from public.user_roles ur
        join public.profiles p on p.id = ur.user_id
        where ur.role_code = 'ADMIN'
          and p.status = 'ACTIVE'
          and ur.user_id <> old_user;

        if remaining = 0 then
            raise exception
                'Refusing to remove the last ACTIVE ADMIN (user %). Promote or '
                'enable another administrator first.', old_user
                using errcode = 'check_violation';
        end if;
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_last_admin on public.user_roles;
create trigger trg_protect_last_admin
    before update or delete on public.user_roles
    for each row execute function public.protect_last_admin();

-- ---------------------------------------------------------------------------
-- 7. Audit log for role/grant changes
-- ---------------------------------------------------------------------------
-- 03_PHASE_1 requires auditing role/grant mutations and user activation.
-- Append-only for clients: no UPDATE or DELETE policy is created, so the table
-- is insert-only through the Data API.
create table if not exists public.authorization_audit (
    id          bigint generated always as identity primary key,
    actor_id    uuid references auth.users(id) on delete set null,
    action      text not null,
    subject_id  uuid,
    role_code   text,
    permission_code text,
    detail      jsonb,
    created_at  timestamptz not null default now()
);

comment on table public.authorization_audit is
    'Append-only audit of role and permission changes. Has no UPDATE or DELETE '
    'policy by design; clients cannot rewrite history.';

create index if not exists idx_authz_audit_created on public.authorization_audit(created_at desc);
create index if not exists idx_authz_audit_subject on public.authorization_audit(subject_id);

-- One trigger function serves both tables, but PL/pgSQL types NEW and OLD as
-- the trigger's table row type, so a field that exists only on the OTHER table
-- (e.g. permission_code on a user_roles trigger) is a compile error at runtime.
-- Convert to jsonb first, then read the field defensively.
create or replace function public.audit_authorization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor      uuid := auth.uid();
    is_roles   boolean := (tg_table_name = 'user_roles');
    row_json   jsonb   := to_jsonb(coalesce(new, old));
    subject    uuid    := nullif(row_json ->> 'user_id', '')::uuid;
    role_c     text    := case when is_roles then row_json ->> 'role_code' end;
    perm_c     text    := case when is_roles then null else row_json ->> 'permission_code' end;
    act        text;
begin
    if tg_op = 'INSERT' then
        act := case when is_roles then 'ROLE_GRANTED' else 'PERMISSION_GRANTED' end;
    elsif tg_op = 'DELETE' then
        act := case when is_roles then 'ROLE_REVOKED' else 'PERMISSION_REVOKED' end;
    else
        return null;
    end if;

    insert into public.authorization_audit
        (actor_id, action, subject_id, role_code, permission_code, detail)
    values (
        actor,
        act,
        subject,
        role_c,
        perm_c,
        jsonb_build_object('op', lower(tg_op), 'table', tg_table_name)
    );

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_user_roles on public.user_roles;
create trigger trg_audit_user_roles
    after insert or delete on public.user_roles
    for each row execute function public.audit_authorization_change();

drop trigger if exists trg_audit_user_permissions on public.user_permissions;
create trigger trg_audit_user_permissions
    after insert or delete on public.user_permissions
    for each row execute function public.audit_authorization_change();

-- ---------------------------------------------------------------------------
-- 8. Profile creation on signup
-- ---------------------------------------------------------------------------
-- Runs as SECURITY DEFINER so it can write profiles regardless of the new
-- user's own RLS context. Deliberately grants NO role: a new account can do
-- nothing until an administrator assigns a role, which keeps deny-by-default
-- true for signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, full_name, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 9. Self-service profile edits (narrow, column-safe)
-- ---------------------------------------------------------------------------
-- A user may change only their own display fields. Role, status and permission
-- columns are not on this table, so no column-level escalation is possible.
-- Status changes are NOT permitted here; they go through admin RPC.
create or replace function public.update_my_profile(
    p_full_name text default null,
    p_display_name text default null,
    p_phone text default null,
    p_avatar_storage_key text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    result public.profiles;
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    update public.profiles p
       set full_name          = coalesce(p_full_name, p.full_name),
           display_name       = coalesce(p_display_name, p.display_name),
           phone              = coalesce(p_phone, p.phone),
           avatar_storage_key = coalesce(p_avatar_storage_key, p.avatar_storage_key),
           last_seen_at       = now()
     where p.id = auth.uid()
    returning * into result;

    if result.id is null then
        raise exception 'Profile not found' using errcode = 'no_data_found';
    end if;

    return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9b. Clearing the temporary-password flag
-- ---------------------------------------------------------------------------
-- When an administrator creates an account they set a temporary password, so
-- somebody other than the owner knows it. The account stays flagged until the
-- owner replaces it.
--
-- Note the division of labour: the PASSWORD itself is changed by Supabase Auth
-- (GoTrue), which owns the credential, so no function here accepts a password
-- and no password is ever stored in the application schema. This function only
-- records that the change happened, and it refuses to clear the flag unless the
-- caller can prove they own the account.
--
-- The proof is deliberately weak-but-sufficient: only the authenticated owner
-- can call it (auth.uid()), and it cannot be used to clear another user's flag.
-- An administrator resetting a password can set the flag again at any time.
create or replace function public.clear_temporary_password_flag()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Not authenticated' using errcode = '28000';
    end if;

    update public.profiles p
       set must_change_password = false,
           updated_at = now()
     where p.id = auth.uid();

    if not found then
        raise exception 'Profile not found' using errcode = 'no_data_found';
    end if;

    -- Recorded because this is a security-relevant transition: the account
    -- stopped being one whose credential a second person knows.
    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'TEMPORARY_PASSWORD_CLEARED', auth.uid(),
            jsonb_build_object('at', now()));
end;
$$;

revoke all on function public.clear_temporary_password_flag() from public;
revoke all on function public.clear_temporary_password_flag() from anon;
grant execute on function public.clear_temporary_password_flag() to authenticated;

comment on function public.clear_temporary_password_flag() is
    'Called by the account owner after setting their own password. Clears '
    'profiles.must_change_password and writes an audit entry. Never accepts a '
    'password: the credential is owned by Supabase Auth.';

-- ---------------------------------------------------------------------------
-- 10. Row Level Security — deny by default
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.roles                enable row level security;
alter table public.permissions          enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.user_roles           enable row level security;
alter table public.user_permissions     enable row level security;
alter table public.authorization_audit  enable row level security;

-- FORCE so the table owner is also subject to policies; without it a
-- SECURITY INVOKER path running as owner would bypass them silently.
alter table public.profiles             force row level security;
alter table public.roles                force row level security;
alter table public.permissions          force row level security;
alter table public.role_permissions     force row level security;
alter table public.user_roles           force row level security;
alter table public.user_permissions     force row level security;
alter table public.authorization_audit  force row level security;

-- --- profiles -------------------------------------------------------------
-- Read own profile; read all profiles only with users.view.
-- Both paths require is_active_user() so a DISABLED account is locked out of
-- its own row too: disabling must take effect immediately, not when the JWT
-- happens to expire.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select to authenticated
    using (id = auth.uid() and public.is_active_user());

drop policy if exists profiles_select_with_permission on public.profiles;
create policy profiles_select_with_permission on public.profiles
    for select to authenticated
    using (public.has_permission('users.view'));

-- Self-service profile edits go through update_my_profile() ONLY.
--
-- There is deliberately NO direct UPDATE policy for ordinary users. An earlier
-- version pinned only `status` in WITH CHECK, which still let a user rewrite
-- `full_name`/`phone` with a raw table UPDATE, bypassing the audited RPC.
-- RLS row checks cannot restrict which COLUMNS a statement touches, so the
-- write path is closed at the column-grant level instead (see section 11),
-- while users.manage keeps a full UPDATE policy below.
--
-- One audited write path is the only way to guarantee every self-service edit
-- goes through one validated function.
drop policy if exists profiles_update_own on public.profiles;

-- Administrators do NOT get a blanket UPDATE policy on profiles either.
-- Status changes go through admin_set_user_status(), which validates the
-- last-admin rule and writes the audit entry. A direct table UPDATE would skip
-- both. The `for all` policy that used to live here is removed for the same
-- reason it was ineffective: `authenticated` holds no UPDATE grant on this
-- table, so the policy could never fire and only misled readers.

-- NOTE: no INSERT policy on profiles. Rows are created by the
-- on_auth_user_created trigger, not by clients.

-- --- roles / permissions / role_permissions (read-only to clients) ---------
-- These are configuration tables. Clients may read them when the UI needs the
-- list; only users.manage may change them. There is no DELETE policy on roles
-- or permissions, so a client cannot delete the authorization model.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
    for select to authenticated
    using (public.is_active_user());

drop policy if exists roles_manage on public.roles;
create policy roles_manage on public.roles
    for all to authenticated
    using (public.has_permission('users.manage'))
    with check (public.has_permission('users.manage'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
    for select to authenticated
    using (public.is_active_user());

drop policy if exists permissions_manage on public.permissions;
create policy permissions_manage on public.permissions
    for all to authenticated
    using (public.has_permission('users.manage'))
    with check (public.has_permission('users.manage'));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
    for select to authenticated
    using (public.is_active_user());

drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions
    for all to authenticated
    using (public.has_permission('users.manage'))
    with check (public.has_permission('users.manage'));

-- --- user_roles ------------------------------------------------------------
-- A user may see their own role rows (needed to render their own UI).
-- Guarded by is_active_user() so a DISABLED account reads nothing.
drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own on public.user_roles
    for select to authenticated
    using (user_id = auth.uid() and public.is_active_user());

drop policy if exists user_roles_select_with_permission on public.user_roles;
create policy user_roles_select_with_permission on public.user_roles
    for select to authenticated
    using (public.has_permission('users.view'));

-- Only users.manage may grant or revoke roles. Deliberately no self-service
-- path: a user cannot grant themselves a role.
drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
    for insert to authenticated
    with check (public.has_permission('users.manage'));

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles
    for delete to authenticated
    using (public.has_permission('users.manage'));

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles
    for update to authenticated
    using (public.has_permission('users.manage'))
    with check (public.has_permission('users.manage'));

-- --- user_permissions ------------------------------------------------------
-- A user may read their own extra grants; managing them requires users.manage.
-- There is intentionally no self-grant path.
drop policy if exists user_permissions_select_own on public.user_permissions;
create policy user_permissions_select_own on public.user_permissions
    for select to authenticated
    using (user_id = auth.uid() and public.is_active_user());

drop policy if exists user_permissions_select_with_permission on public.user_permissions;
create policy user_permissions_select_with_permission on public.user_permissions
    for select to authenticated
    using (public.has_permission('users.view'));

drop policy if exists user_permissions_insert on public.user_permissions;
create policy user_permissions_insert on public.user_permissions
    for insert to authenticated
    with check (public.has_permission('users.manage'));

drop policy if exists user_permissions_delete on public.user_permissions;
create policy user_permissions_delete on public.user_permissions
    for delete to authenticated
    using (public.has_permission('users.manage'));

-- --- authorization_audit ---------------------------------------------------
-- Read requires audit.view. INSERT is allowed for authenticated users because
-- the audit triggers run as SECURITY DEFINER and write here; there is NO
-- update or delete policy, so history is append-only through the Data API.
drop policy if exists authz_audit_select on public.authorization_audit;
create policy authz_audit_select on public.authorization_audit
    for select to authenticated
    using (public.has_permission('audit.view'));

drop policy if exists authz_audit_insert on public.authorization_audit;
create policy authz_audit_insert on public.authorization_audit
    for insert to authenticated
    with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- 11. Explicit grants
-- ---------------------------------------------------------------------------
-- RLS controls which ROWS are visible; GRANTs control whether the table is
-- reachable at all. Both are required. `anon` gets nothing: SRIK has no
-- public/anonymous surface.
revoke all on public.profiles            from anon;
revoke all on public.roles               from anon;
revoke all on public.permissions         from anon;
revoke all on public.role_permissions    from anon;
revoke all on public.user_roles          from anon;
revoke all on public.user_permissions    from anon;
revoke all on public.authorization_audit from anon;

grant select                 on public.profiles           to authenticated;
-- REVOKE is required, not just omission: an earlier revision of this migration
-- granted UPDATE, and `grant select` alone does not take it back. Re-running
-- this file on a database that already had the old grant must still end up
-- locked down, which is the whole point of making the migration idempotent.
revoke update                on public.profiles           from authenticated;

-- NO UPDATE grant on profiles for `authenticated`.
--
-- update_my_profile() is SECURITY DEFINER, so it writes as the table owner and
-- does not need the caller to hold UPDATE. Withholding the grant is what
-- actually closes the hole: a column-level grant would still permit a raw
-- UPDATE that bypasses the RPC's validation and audit. Administrators reach
-- profiles through the RPCs in section 13, not through a direct table write.
grant select                 on public.roles              to authenticated;
grant select                 on public.permissions        to authenticated;
grant select                 on public.role_permissions   to authenticated;
grant select, insert, update, delete on public.user_roles        to authenticated;
grant select, insert, delete on public.user_permissions  to authenticated;
grant select, insert         on public.authorization_audit to authenticated;

-- Sequence used by the audit table's identity column.
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Function EXECUTE grants
-- ---------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC by default. Revoking that and granting
-- only where intended is what stops an unauthenticated caller from invoking a
-- privileged function.
revoke all on function public.has_permission(text)       from public;
revoke all on function public.has_role(public.app_role[]) from public;
revoke all on function public.is_active_user()           from public;
revoke all on function public.active_admin_count()       from public;
revoke all on function public.update_my_profile(text, text, text, text) from public;

grant execute on function public.has_permission(text)       to authenticated;
grant execute on function public.has_role(public.app_role[]) to authenticated;
grant execute on function public.is_active_user()           to authenticated;
grant execute on function public.active_admin_count()       to authenticated;
grant execute on function public.update_my_profile(text, text, text, text) to authenticated;

-- Trigger-only functions must not be callable directly by clients.
revoke all on function public.handle_new_user()                from public, anon, authenticated;
revoke all on function public.audit_authorization_change()     from public, anon, authenticated;
revoke all on function public.protect_last_admin()             from public, anon, authenticated;
revoke all on function public.touch_updated_at()               from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Admin RPC: grant/revoke role and permission-safe user administration
-- ---------------------------------------------------------------------------
-- Multi-row business operations belong in atomic RPC (AGENTS.md). These check
-- authorization inside the function as well as via RLS, so they stay safe even
-- if a policy is later loosened by mistake.
create or replace function public.admin_set_user_status(
    p_user_id uuid,
    p_status public.profile_status
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    result public.profiles;
begin
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = '42501';
    end if;

    -- Refuse to disable the last active administrator.
    if p_status <> 'ACTIVE' then
        if exists (
            select 1 from public.user_roles ur
            where ur.user_id = p_user_id and ur.role_code = 'ADMIN'
        ) and public.active_admin_count() <= 1 then
            raise exception 'Refusing to disable the last ACTIVE ADMIN'
                using errcode = 'check_violation';
        end if;
    end if;

    update public.profiles p
       set status      = p_status,
           disabled_at = case when p_status = 'ACTIVE' then null else now() end,
           disabled_by = case when p_status = 'ACTIVE' then null else auth.uid() end
     where p.id = p_user_id
    returning * into result;

    if result.id is null then
        raise exception 'Profile not found: %', p_user_id using errcode = 'no_data_found';
    end if;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'USER_STATUS_CHANGED', p_user_id,
            jsonb_build_object('status', p_status));

    return result;
end;
$$;

create or replace function public.admin_grant_role(
    p_user_id uuid,
    p_role_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = '42501';
    end if;

    if not exists (select 1 from public.roles r where r.code = p_role_code) then
        raise exception 'Unknown role: %', p_role_code using errcode = 'foreign_key_violation';
    end if;

    insert into public.user_roles (user_id, role_code, granted_by)
    values (p_user_id, p_role_code, auth.uid())
    on conflict (user_id, role_code) do nothing;
end;
$$;

create or replace function public.admin_revoke_role(
    p_user_id uuid,
    p_role_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = '42501';
    end if;

    delete from public.user_roles
     where user_id = p_user_id
       and role_code = p_role_code;
    -- Last-admin protection is enforced by trg_protect_last_admin.
end;
$$;

create or replace function public.admin_grant_permission(
    p_user_id uuid,
    p_permission_code text,
    p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = '42501';
    end if;

    if not exists (select 1 from public.permissions p where p.code = p_permission_code) then
        raise exception 'Unknown permission: %', p_permission_code
            using errcode = 'foreign_key_violation';
    end if;

    insert into public.user_permissions (user_id, permission_code, granted_by, reason)
    values (p_user_id, p_permission_code, auth.uid(), p_reason)
    on conflict (user_id, permission_code) do nothing;
end;
$$;

create or replace function public.admin_revoke_permission(
    p_user_id uuid,
    p_permission_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('users.manage') then
        raise exception 'Insufficient permission: users.manage required'
            using errcode = '42501';
    end if;

    delete from public.user_permissions
     where user_id = p_user_id
       and permission_code = p_permission_code;
end;
$$;

revoke all on function public.admin_set_user_status(uuid, public.profile_status) from public;
revoke all on function public.admin_grant_role(uuid, text)           from public;
revoke all on function public.admin_revoke_role(uuid, text)          from public;
revoke all on function public.admin_grant_permission(uuid, text, text) from public;
revoke all on function public.admin_revoke_permission(uuid, text)    from public;

grant execute on function public.admin_set_user_status(uuid, public.profile_status) to authenticated;
grant execute on function public.admin_grant_role(uuid, text)           to authenticated;
grant execute on function public.admin_revoke_role(uuid, text)          to authenticated;
grant execute on function public.admin_grant_permission(uuid, text, text) to authenticated;
grant execute on function public.admin_revoke_permission(uuid, text)    to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Seed the permission registry, roles and grants
-- ---------------------------------------------------------------------------
-- Registry from 03_PHASE_1 "Permission contract". Names are PROPOSED but used
-- consistently — no mixed granularity.
insert into public.permissions (code, category, description) values
    ('users.view',                    'users',      'View user accounts and profiles'),
    ('users.manage',                  'users',      'Create, disable and administer users, roles and permissions'),
    ('students.view',                 'students',   'View student records in scope'),
    ('students.create',               'students',   'Register new students'),
    ('students.update',               'students',   'Edit student records in scope'),
    ('students.archive',              'students',   'Archive students (never hard-delete)'),
    ('teachers.view',                 'teachers',   'View teacher records'),
    ('teachers.manage',               'teachers',   'Manage teacher records and assignments'),
    ('guardians.view',                'guardians',  'View guardian records'),
    ('guardians.manage',              'guardians',  'Manage guardian records and student links'),
    ('academic_years.view',           'academic',   'View academic years and terms'),
    ('academic_years.manage',         'academic',   'Manage academic years and terms'),
    ('classes.view',                  'academic',   'View classes and enrolments'),
    ('classes.manage',                'academic',   'Manage classes and enrolments'),
    ('subjects.view',                 'academic',   'View subjects'),
    ('subjects.manage',               'academic',   'Manage subjects and class subjects'),
    ('teaching_assignments.view',     'academic',   'View teaching assignments'),
    ('teaching_assignments.manage',   'academic',   'Manage teaching assignments'),
    ('timetable.view',                'timetable',  'View timetables'),
    ('timetable.manage',              'timetable',  'Manage and publish timetables'),
    ('attendance.view',               'attendance', 'View attendance records'),
    ('attendance.record',             'attendance', 'Record daily attendance for assigned classes'),
    ('attendance.manage',             'attendance', 'Correct and manage attendance records'),
    ('assessments.view',              'assessments','View assessments and results'),
    ('assessments.create',            'assessments','Create assessments'),
    ('assessments.enter_scores',      'assessments','Enter assessment scores for assigned subjects'),
    ('assessments.publish',           'assessments','Finalise and publish assessments'),
    ('reports.view',                  'reports',    'View report cards'),
    ('reports.generate',              'reports',    'Generate report card snapshots'),
    ('reports.publish',               'reports',    'Publish report cards'),
    ('finance.view',                  'finance',    'View charges, payments and balances'),
    ('finance.manage',                'finance',    'Manage fee types, charges and allocations'),
    ('finance.record_payment',        'finance',    'Record and allocate payments'),
    ('documents.view',                'documents',  'View documents'),
    ('documents.manage',              'documents',  'Upload and manage documents'),
    ('announcements.view',            'announcements','View announcements'),
    ('announcements.manage',          'announcements','Create and publish announcements'),
    ('settings.manage',               'settings',   'Manage SchoolProfile and application settings'),
    ('audit.view',                    'audit',      'View the audit log')
on conflict (code) do nothing;

insert into public.roles (code, name, description, is_system) values
    ('ADMIN',   'Pentadbir',  'School administrator. Receives permissions through role grants, not a policy bypass.', true),
    ('TEACHER', 'Guru',       'Teacher. Baseline read access plus the duties explicitly granted.',                   true)
on conflict (code) do nothing;

-- ADMIN receives every permission through role_permissions (no bypass).
insert into public.role_permissions (role_code, permission_code)
select 'ADMIN', p.code from public.permissions p
on conflict do nothing;

-- TEACHER baseline: the minimum needed to do the job, plus the scoped duties
-- described in 03_PHASE_1 ("guru biasa melihat rekod akademik yang diperlukan
-- untuk kelas ditugaskan, merekod attendance kelas dibenarkan, dan mengisi
-- markah subjek/kelas yang diajar").
insert into public.role_permissions (role_code, permission_code) values
    ('TEACHER', 'students.view'),
    ('TEACHER', 'classes.view'),
    ('TEACHER', 'subjects.view'),
    ('TEACHER', 'academic_years.view'),
    ('TEACHER', 'teaching_assignments.view'),
    ('TEACHER', 'timetable.view'),
    ('TEACHER', 'attendance.view'),
    ('TEACHER', 'attendance.record'),
    ('TEACHER', 'assessments.view'),
    ('TEACHER', 'assessments.enter_scores'),
    ('TEACHER', 'reports.view'),
    ('TEACHER', 'announcements.view'),
    ('TEACHER', 'documents.view')
on conflict do nothing;

-- TEACHER deliberately does NOT receive: users.*, *_manage, finance.*,
-- guardians.*, settings.manage, audit.view. Those are management-scope and are
-- granted explicitly (role change or an individual grant) per 03_PHASE_1.
