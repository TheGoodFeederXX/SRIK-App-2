-- =============================================================================
-- Phase 2 completion — service_role grants
-- =============================================================================
-- WHY THIS FILE EXISTS
--
-- Phases 1 and 2 granted the Data API roles (`authenticated`, `anon`) access to
-- every table, and revoked it from `anon`. They never granted anything to
-- `service_role`, the role a Supabase secret key acts as.
--
-- That gap went unnoticed until the `provision-teacher-account` Edge Function
-- was deployed and tested live. It reads `teachers` with the secret key to
-- confirm the teacher exists, and got:
--
--     permission denied for table teachers   (42501)
--
-- The function could not work at all. A secret key is intended for privileged
-- server-side work, and this project's own contract says privileged operations
-- belong in authenticated Edge Functions — so the missing grant was a real
-- defect, not a misconfiguration of the function.
--
-- WHY `bypassrls` WAS NOT ENOUGH
--
-- `service_role` carries BYPASSRLS, which skips row level security. It does not
-- skip table-level GRANTs: those are a separate mechanism applied first. Every
-- table here also has FORCE ROW LEVEL SECURITY, so the owner is not exempt
-- either. The table grants are therefore genuinely required.
--
-- SCOPE OF THIS GRANT
--
-- Full CRUD on every table, deliberately. This role is reachable ONLY with a
-- key that never leaves the server — it is not in the browser bundle, not in a
-- VITE_ variable, and not committed. Its whole purpose is to perform work that
-- ordinary signed-in users must not. Narrowing it per table would create a
-- failure that appears only when some later administrative task happens to
-- touch a table nobody thought to grant, which is exactly the class of bug that
-- produced this file. The safety property that matters is that no browser ever
-- holds this key, and that is enforced elsewhere.
--
-- WHAT STILL DOES NOT CHANGE
--
-- `anon` remains denied across the board, and `authenticated` keeps its existing
-- narrow grants. In particular `student_enrollments` and `teaching_assignments`
-- still have NO INSERT/UPDATE/DELETE for `authenticated`: those stay RPC-only,
-- because a class change must close the old row and open a new one atomically.
-- This file does not widen what a signed-in user can do.
--
-- Idempotent: GRANT is additive, so re-running changes nothing.
-- =============================================================================

do $$
declare
    t record;
begin
    -- Every table in the public schema. Enumerated rather than listed by hand so
    -- a future table cannot silently inherit this gap the way these 19 did.
    for t in
        select tablename
        from pg_tables
        where schemaname = 'public'
        order by tablename
    loop
        execute format('grant select, insert, update, delete on public.%I to service_role', t.tablename);
    end loop;
end
$$;

-- Sequences behind identity/serial columns, needed for inserts through the
-- secret key (e.g. the authorization audit trail).
grant usage, select on all sequences in schema public to service_role;

-- Verification: the function's own read must now succeed. Without the SELECT on
-- teachers the Edge Function returns "Teacher not found" and the owner sees an
-- unexplainable failure, so assert it here rather than discovering it live.
do $$
begin
    if not exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'teachers'
          and grantee = 'service_role'
          and privilege_type = 'SELECT'
    ) then
        raise exception 'service_role still cannot read public.teachers';
    end if;

    -- The security property from Phases 1 and 2 must survive this file.
    if exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'
    ) then
        raise exception 'anon gained table grants; it must stay denied';
    end if;

    -- Enrolments must remain RPC-only for signed-in users.
    if exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'student_enrollments'
          and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) then
        raise exception 'student_enrollments gained a write grant for authenticated';
    end if;
end
$$;
