-- F38 — a migration registry, so the live database has a traceable history.
--
-- THE FINDING. Production had 36 domain tables, 84 policies and dozens of
-- functions, and NO record of when any of it was applied:
--
--   supabase_migrations.schema_migrations   did not exist
--   `list_migrations` returned nothing
--   a TEST helper, `public.test_id(text)`, was sitting in the live database
--
-- So there was no way to answer "is production at the same revision as the
-- repository?" except by reading every object by hand. That is drift by
-- construction: any difference between the two is invisible until someone looks.
--
-- WHAT THIS DOES — and deliberately does NOT do.
--
-- It does NOT replay the migrations. Replaying them against a populated database
-- would re-run grants and policies whose effects depend on order, and the audit is
-- explicit that this must not be done blindly, "especially the ones that widen
-- guardian access". Production is treated as a TARGET to be described, not a
-- database to be rebuilt.
--
-- Instead it:
--   1. creates the registry the Supabase tooling expects, and
--   2. records exactly the migrations in THIS repository, in order, as applied,
--      because that is the state production was reconciled to — each one was
--      applied by hand and verified during this work.
--
-- The registry is a statement of what has been applied and verified. It is what
-- makes the NEXT change traceable, and what lets `supabase migration list` answer
-- the question that previously had no answer.
--
-- Idempotent: re-running changes nothing that is already recorded.
begin;

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
    version     text primary key,
    name        text,
    statements  text[],
    applied_at  timestamptz not null default now()
);

comment on table supabase_migrations.schema_migrations is
    'Which migrations have been applied to this database, in version order. '
    'Read by `supabase migration list`. Added for audit F38: without it there was '
    'no way to tell whether production matched the repository.';

-- The registry is for the operators and the tooling. It is not part of the
-- application, and no API role should see or write it: a client that could insert
-- a row here could claim a migration had been applied.
revoke all on schema supabase_migrations from public, anon, authenticated;
grant usage on schema supabase_migrations to service_role;
revoke all on table supabase_migrations.schema_migrations from public, anon, authenticated;
grant select on table supabase_migrations.schema_migrations to service_role;

-- ---------------------------------------------------------------------------
-- The migrations in the repository, in the order they were applied.
--
-- The list is written out rather than derived from the directory: this table is a
-- RECORD OF FACT. Reading the directory here would make it a copy of the
-- repository, which would agree with the repository even when production does not
-- — the opposite of the point.
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name) values
    ('20261007000001', 'phase1_auth_authorization'),
    ('20261008000001', 'phase2_academic_core'),
    ('20261009000001', 'service_role_grants'),
    ('20261010000001', 'phase3_timetable_attendance'),
    ('20261011000001', 'phase4_assessments_reports'),
    ('20261012000001', 'phase5_finance'),
    ('20261013000001', 'phase5b_guardian_access'),
    ('20261014000001', 'phase5c_guardian_onboarding'),
    ('20261015000001', 'phase6_operations_release'),
    ('20261016000001', 'phase6_storage_buckets'),
    ('20261017000001', 'security_hardening_rpc_anon'),
    ('20261018000001', 'access_scope_policies'),
    ('20261019000001', 'document_scope_policy'),
    ('20261020000001', 'last_admin_guard'),
    ('20261021000001', 'provisioning_and_temporary_password'),
    ('20261022000001', 'finance_integrity'),
    ('20261022000002', 'record_payment_lock')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- The leftover test helper.
--
-- `public.test_id(text)` was applied to production at some point — it exists in
-- the live database and in no migration. It is safe to drop, and the check below
-- establishes that rather than asserting it: a helper that something depends on
-- must not be removed on the strength of a naming convention.
--
-- Verified before removal: no function, policy or trigger in `public` references
-- it. Its prefix ('…-4000-a000-…') also does not appear in any table, so it never
-- seeded real data.
-- ---------------------------------------------------------------------------
do $$
declare
    v_refs integer;
begin
    select count(*) into v_refs
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname <> 'test_id'
       and pg_get_functiondef(p.oid) like '%test_id(%';

    if v_refs > 0 then
        raise exception
            'Refusing to drop public.test_id: % function(s) still call it. It looked '
            'like a leftover test helper, but production depends on it — so the '
            'assumption is wrong and the drop is not safe.',
            v_refs
            using errcode = 'dependent_objects_still_exist';
    end if;

    select count(*) into v_refs from pg_policies
     where (qual like '%test_id%' or with_check like '%test_id%');
    if v_refs > 0 then
        raise exception
            'Refusing to drop public.test_id: % policy/policies reference it',
            v_refs
            using errcode = 'dependent_objects_still_exist';
    end if;
end
$$;

drop function if exists public.test_id(text);

-- ---------------------------------------------------------------------------
-- The registry must not be empty, and must name the newest migration.
--
-- A registry that silently recorded nothing would look identical to a database
-- that had never been described — which is the state this migration exists to end.
-- ---------------------------------------------------------------------------
do $$
declare
    v_count integer;
    v_newest text;
begin
    select count(*), max(version) into v_count, v_newest
      from supabase_migrations.schema_migrations;

    if v_count < 17 then
        raise exception
            'The migration registry has only % entries; the repository has 17. A '
            'partial registry is more misleading than none.',
            v_count
            using errcode = 'raise_exception';
    end if;

    if v_newest <> '20261022000002' then
        raise exception
            'The newest recorded migration is %, but the repository ends at '
            '20261022000002. Production and the repository have drifted.',
            v_newest
            using errcode = 'raise_exception';
    end if;

    if exists (
        select 1 from pg_proc
         where proname = 'test_id' and pronamespace = 'public'::regnamespace
    ) then
        raise exception 'The leftover test helper public.test_id is still present'
            using errcode = 'raise_exception';
    end if;
end
$$;

commit;
