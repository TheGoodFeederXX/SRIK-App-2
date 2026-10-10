-- Guard test for audit finding F38 — the database has a traceable migration history.
--
-- THE FINDING. Production had 36 domain tables, 84 policies and dozens of functions
-- with no record of what had been applied. `supabase_migrations.schema_migrations`
-- did not exist, so the only way to decide whether production matched the
-- repository was to read every object by hand. A leftover TEST helper,
-- `public.test_id(text)`, was sitting in the live database — evidence that
-- something had been applied outside the migration path and never cleaned up.
--
-- WHAT THESE CHECKS ARE FOR. A registry that exists but is empty, or that lists a
-- version the repository does not have, is worse than no registry: it answers the
-- question confidently and wrongly. So these checks assert the registry is present,
-- readable by the tooling, matches the migration files in the repository, and is
-- closed to the API roles.
begin;

-- NO FIXTURES, AND NO `test_id` HELPER.
--
-- Every other suite defines `test_id` to build fixture ids. This one must not: the
-- check below asserts that production carries no such helper, and creating one here
-- would make the suite fail on its own scaffolding. The first version of this file
-- did exactly that, and the failure read as a real finding.
--
-- Nothing here needs fixtures. F38 is a question about the schema's own bookkeeping.

-- ===========================================================================
-- F38a: the registry exists and is not empty.
-- ===========================================================================
do $$
declare
    v_count integer;
begin
    if to_regclass('supabase_migrations.schema_migrations') is null then
        raise exception
            'FAIL F38: there is no migration registry, so there is no way to tell '
            'whether this database matches the repository'
            using errcode = 'raise_exception';
    end if;

    select count(*) into v_count from supabase_migrations.schema_migrations;
    if v_count = 0 then
        raise exception
            'FAIL F38: the migration registry exists but records nothing, which '
            'looks the same as having no history while being harder to notice'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the migration registry exists and records % migrations', v_count;
end
$$;

-- ===========================================================================
-- F38b: it records the LAST migration, not just some of them.
--
-- A registry that stopped a few migrations short would agree with production about
-- everything it mentions and hide the rest.
-- ===========================================================================
do $$
declare
    v_newest text;
begin
    select max(version) into v_newest from supabase_migrations.schema_migrations;
    if v_newest <> '20261022000002' then
        raise exception
            'FAIL F38: the newest recorded migration is %, but the repository''s last '
            'one is 20261022000002 — production and the repository have drifted',
            v_newest
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the registry ends at the repository''s newest migration';
end
$$;

-- ===========================================================================
-- F38c: no two entries share a version, so "applied" is unambiguous.
-- ===========================================================================
do $$
declare
    v_dupes integer;
begin
    select count(*) into v_dupes from (
        select version from supabase_migrations.schema_migrations
         group by version having count(*) > 1
    ) d;

    if v_dupes > 0 then
        raise exception 'FAIL F38: % migration version(s) are recorded twice', v_dupes
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: every migration is recorded exactly once';
end
$$;

-- ===========================================================================
-- F38d: the leftover test helper is gone.
--
-- `test_id` was in production and in no migration. It is also a name that a test
-- suite creates, so its presence is a strong signal that something was applied by
-- hand and left behind.
-- ===========================================================================
do $$
begin
    if exists (
        select 1 from pg_proc
         where proname = 'test_id' and pronamespace = 'public'::regnamespace
    ) then
        raise exception
            'FAIL F38: the test helper public.test_id is still in the database, so '
            'the schema still carries objects that no migration describes'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: no leftover test helper remains in the database';
end
$$;

-- ===========================================================================
-- F38e: the API roles cannot read or write the registry.
--
-- A client that could INSERT here could claim a migration had been applied. A
-- client that could read it would learn the shape of the schema from outside the
-- policies that protect everything else.
-- ===========================================================================
do $$
begin
    if has_table_privilege('anon', 'supabase_migrations.schema_migrations', 'select')
       or has_table_privilege('anon', 'supabase_migrations.schema_migrations', 'insert') then
        raise exception 'FAIL F38: an anonymous caller can reach the migration registry'
            using errcode = 'raise_exception';
    end if;

    if has_table_privilege('authenticated', 'supabase_migrations.schema_migrations', 'select')
       or has_table_privilege('authenticated', 'supabase_migrations.schema_migrations', 'insert')
       or has_table_privilege('authenticated', 'supabase_migrations.schema_migrations', 'update')
       or has_table_privilege('authenticated', 'supabase_migrations.schema_migrations', 'delete') then
        raise exception
            'FAIL F38: a signed-in user can reach the migration registry — a client '
            'that can write here could claim a migration was applied'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the migration registry is closed to the API roles';
end
$$;

-- ===========================================================================
-- F38f: the registry is a RECORD, not a copy of the repository.
--
-- It must agree with the files, and the way to check that is to compare it against
-- what the migration files actually are. The suite applies every migration, so if a
-- file were added without a registry entry the counts would diverge.
-- ===========================================================================
do $$
declare
    v_registry integer;
begin
    select count(*) into v_registry from supabase_migrations.schema_migrations;

    if v_registry <> 17 then
        raise exception
            'FAIL F38: the registry lists % migrations but the repository has 17. A '
            'registry that does not match the files cannot detect drift.',
            v_registry
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the registry lists exactly the repository''s 17 migrations';
end
$$;

rollback;
