-- ===========================================================================
-- A local stand-in for Supabase Storage, for testing only.
-- ===========================================================================
-- The real project has a `storage` schema owned by Supabase, with columns this
-- migration relies on. A local PostgreSQL cluster has none of that, so this
-- file creates the smallest honest approximation: the two tables, with the
-- columns the migration and its policies actually use.
--
-- It is NOT a reimplementation of Storage. It has no upload API, no signed
-- URLs, and no file bytes. Its only job is to let `storage.buckets` and
-- `storage.objects` exist so the bucket definition and the row-level policies
-- can be created and tested. Anything that depends on Storage's own
-- implementation must be tested against the real thing.
--
-- Applied ONLY by the local test runner. It is not a migration and is never
-- run against the school's project.

create schema if not exists storage;

create table if not exists storage.buckets (
    id                 text primary key,
    name               text not null,
    owner              uuid,
    public             boolean default false,
    avif_autodetection boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

create table if not exists storage.objects (
    id               uuid primary key default extensions.gen_random_uuid(),
    bucket_id        text references storage.buckets(id),
    name             text,
    owner            uuid,
    created_at       timestamptz default now(),
    updated_at       timestamptz default now(),
    last_accessed_at timestamptz default now(),
    metadata         jsonb
);

-- Storage's own tables have RLS enabled in a real project, and these policies
-- are what the migration adds to them. Enabling it here means a policy that
-- does nothing would be caught.
alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
