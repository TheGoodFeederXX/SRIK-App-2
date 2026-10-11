-- AUDIT F27 — a person's own settings must be theirs alone.
--
-- WHAT WAS WRONG. Three screens read and wrote notification preferences through an
-- Express endpoint that is not deployed, so the switches moved and nothing saved,
-- with no error. The fix needs a place to store them, and the point of that place is
-- that NOBODY ELSE can read it — not another user, not an admin. Whether a teacher
-- wants an email digest is not the office's business.
--
-- So these checks are mostly about who CANNOT see the row.

\set ON_ERROR_STOP on

begin;

create temp table actor_ids as
select
    (select p.id from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1) as admin_id,
    (select p.id from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'TEACHER' and p.status = 'ACTIVE' limit 1) as teacher_id;

-- F27p1: two saves of different keys BOTH survive.
do $p1$
declare
    v_admin uuid;
begin
    select admin_id into v_admin from actor_ids;
    if v_admin is null then
        raise exception 'F27p1: no active admin to act as';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    perform public.merge_my_preferences('{"f27_digest": true}'::jsonb);
    perform public.merge_my_preferences('{"f27_sms": false}'::jsonb);

    if not (public.my_preferences() ? 'f27_digest') then
        raise exception 'F27p1: the FIRST preference was lost';
    end if;
    if not (public.my_preferences() ? 'f27_sms') then
        raise exception 'F27p1: the SECOND preference was lost';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27p1] two saves of different keys both survive';
end;
$p1$;

-- F27p2: a second person cannot read the first person's preferences.
do $p2$
declare
    v_admin uuid;
    v_teacher uuid;
    v_seen integer;
begin
    select admin_id, teacher_id into v_admin, v_teacher from actor_ids;
    if v_teacher is null then
        raise notice 'SKIP: [F27p2] no active teacher to test isolation with';
        return;
    end if;

    -- The teacher asks for THEIR OWN preferences. The admin's row must not appear.
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_teacher), true);

    if public.my_preferences() ? 'f27_digest' then
        raise exception 'F27p2: the teacher can see the admin''s preferences';
    end if;

    -- And a direct read of the table, which is the path a bug would take.
    select count(*) into v_seen from public.user_preferences where user_id = v_admin;
    if v_seen <> 0 then
        raise exception 'F27p2: the teacher can read % of the admin''s preference rows', v_seen;
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27p2] one person cannot read another''s preferences';
end;
$p2$;

-- F27p3: an anonymous caller cannot reach either function.
do $p3$
begin
    if has_function_privilege('anon', 'public.my_preferences()', 'execute') then
        raise exception 'F27p3: anon can read preferences';
    end if;
    if has_function_privilege('anon', 'public.merge_my_preferences(jsonb)', 'execute') then
        raise exception 'F27p3: anon can write preferences';
    end if;
    raise notice 'PASS: [F27p3] anon cannot read or write preferences';
end;
$p3$;

-- F27p4: the merge is ONE statement, so the lost update cannot come back.
do $p4$
declare
    v_src text;
    v_forced boolean;
    v_policies integer;
begin
    select p.prosrc into v_src
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'merge_my_preferences';

    if v_src ~ 'select\s+preferences\s+into' then
        raise exception 'F27p4: merge_my_preferences reads first — that is the lost update';
    end if;
    if v_src !~ '\|\| p_patch' then
        raise exception 'F27p4: merge_my_preferences does not merge the patch';
    end if;

    select c.relrowsecurity and c.relforcerowsecurity into v_forced
      from pg_class c where c.oid = 'public.user_preferences'::regclass;
    if not v_forced then
        raise exception 'F27p4: user_preferences does not have RLS forced';
    end if;

    select count(*) into v_policies from pg_policies
     where schemaname='public' and tablename='user_preferences';
    if v_policies <> 1 then
        raise exception 'F27p4: expected one policy on user_preferences, found %', v_policies;
    end if;

    raise notice 'PASS: [F27p4] the merge is one statement and the table is forced under RLS';
end;
$p4$;

rollback;
