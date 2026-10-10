-- =============================================================================
-- Local test harness: minimal Supabase environment shim
-- =============================================================================
-- Purpose: reproduce enough of a Supabase project locally to run the Phase 1
-- migration and its tests WITHOUT touching the remote project.
--
-- This file is NOT a migration. It is applied only by the local test runner to
-- stand up:
--   * the auth schema with a minimal auth.users table
--   * auth.uid() and auth.role() as Supabase defines them
--   * the anon / authenticated / service_role / authenticator roles
--
-- On a real Supabase project these already exist, which is why the migration
-- itself does not create them.

create schema if not exists auth;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

-- --- roles Supabase always has --------------------------------------------
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
        create role supabase_auth_admin nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        create role authenticator noinherit login password 'postgres';
    end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- --- auth.users (minimal but structurally faithful) -----------------------
create table if not exists auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text unique,
    encrypted_password  text,
    raw_user_meta_data  jsonb default '{}'::jsonb,
    raw_app_meta_data   jsonb default '{}'::jsonb,
    email_confirmed_at  timestamptz,
    banned_until        timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- --- auth.uid() / auth.role() --------------------------------------------
-- Supabase reads the JWT claims from a request-scoped GUC. Tests set
-- request.jwt.claims to act as a given user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(
        coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        ),
        ''
    )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
    select coalesce(
        current_setting('request.jwt.claim.role', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
    select coalesce(
        current_setting('request.jwt.claim.email', true),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
    );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Make auth.uid() resolvable from the public schema functions, which pin
-- search_path = '' and therefore reference it as auth.uid() explicitly.
grant usage on schema extensions to anon, authenticated, service_role;
