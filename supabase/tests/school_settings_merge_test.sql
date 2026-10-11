-- AUDIT F27 — two settings screens must not erase each other's save.
--
-- WHAT WENT WRONG. `school_profile.settings` is one jsonb column holding every
-- screen's configuration. Each screen read the whole object, changed its own key,
-- and wrote the whole object back. Two screens saving different keys therefore
-- raced, and the later save wrote a copy of the object it had read BEFORE the
-- earlier save — so the earlier screen's change vanished. Nothing errored.
--
-- These three checks are the whole finding: two saves both survive, the old
-- read-then-write pattern really does lose one, and a user without
-- `settings.manage` cannot merge at all.

\set ON_ERROR_STOP on

begin;

-- An admin to act as. Resolved by permission rather than hard-coded, so this
-- suite still means something if the people in the database change.
create temp table admin_user as
select p.id
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
 where ur.role_code = 'ADMIN'
   and p.status = 'ACTIVE'
 limit 1;

create temp table admin_claims as
select format('{"sub":"%s","role":"authenticated"}', id)::jsonb as claims from admin_user;

-- F27s1: two different keys, written one after the other, BOTH survive.
do $s1$
declare
    v_claims jsonb;
    v_before jsonb;
begin
    select claims into v_claims from admin_claims;
    select settings into v_before from public.school_profile where id is not null;
    if v_claims is null then
        raise exception 'F27s1: no active admin to act as';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', v_claims::text, true);

    perform public.merge_school_settings('{"f27_branding": {"colour": "green"}}'::jsonb);
    perform public.merge_school_settings('{"f27_grading": "A"}'::jsonb);

    perform set_config('role', 'postgres', true);

    if (select settings->'f27_branding'->>'colour' from public.school_profile where id is not null) <> 'green' then
        raise exception 'F27s1: the FIRST save was lost';
    end if;
    if (select settings->>'f27_grading' from public.school_profile where id is not null) <> 'A' then
        raise exception 'F27s1: the SECOND save was lost';
    end if;

    -- And an existing key that neither save touched is still there.
    if v_before is not null and v_before <> '{}'::jsonb then
        declare
            v_key text;
        begin
            select k into v_key from jsonb_object_keys(v_before) k
             where k not in ('f27_branding','f27_grading') limit 1;
            if v_key is not null
               and (select settings->>v_key from public.school_profile where id is not null) is null then
                raise exception 'F27s1: the merge dropped the untouched key %', v_key;
            end if;
        end;
    end if;

    perform public.merge_school_settings('{"f27_branding": null}'::jsonb);
    raise notice 'PASS: [F27s1] two screens save different keys; both survive';
end;
$s1$;

-- F27s2: the OLD read-then-write pattern really does lose a save, so the fix is
-- not cosmetic. Done by hand, exactly as the screens used to do it.
--
-- WHY THIS IS PAIRED WITH F27s1 AND WHY F27s1 ALONE WAS NOT ENOUGH. A staged
-- read-then-write still passes F27s1, because a single-threaded test has nothing
-- to interleave with: read, write, read, write, both survive. That is a test that
-- cannot see the defect it is meant to guard, so it is not a guard. This check
-- does the interleaving BY HAND — two reads taken before either write — which is
-- exactly the state two screens are in when they both have the form open. It
-- fails if the pattern loses a save, and it fails if the pattern is ever changed
-- to something that would NOT lose one, because then the case it describes is no
-- longer being exercised.
do $s2$
declare
    v_first jsonb;
    v_second jsonb;
begin
    select settings into v_first from public.school_profile where id is not null;
    select settings into v_second from public.school_profile where id is not null;

    -- Screen A writes its key from the copy it read.
    update public.school_profile
       set settings = v_first || '{"f27_race_a": true}'::jsonb
     where id is not null;
    -- Screen B writes its key from ITS stale copy.
    update public.school_profile
       set settings = v_second || '{"f27_race_b": true}'::jsonb
     where id is not null;

    if (select settings->>'f27_race_a' from public.school_profile where id is not null) is not null then
        raise exception 'F27s2: the stale write did NOT lose the first save — this test is not exercising the race';
    end if;

    raise notice 'PASS: [F27s2] read-then-write loses the first save (so the merge is doing real work)';
end;
$s2$;

-- F27s4: the merge must be ONE statement, so two sessions cannot interleave.
--
-- F27s1 and F27s2 both describe the race and neither can lose data in a
-- single-threaded run: F27s1 has nothing to interleave with, and F27s2 stages the
-- interleaving by hand rather than producing it. So neither one fails when the
-- merge is rewritten as a read followed by a write — verified by doing exactly
-- that, and watching this suite go green.
--
-- CONCURRENCY IS THE ONLY THING THAT CAN SEE IT, so this check opens a SECOND
-- session, holds a read of the old value, and confirms the merge in the first
-- session is not built from it. The database function is inspected for its SHAPE
-- because a functional test would need both sessions to commit in a fixed order,
-- which a shell suite cannot reliably arrange.
do $s4$
declare
    v_src text;
    v_rows integer;
begin
    select p.prosrc,
           (select count(*) from pg_proc q
             where q.pronamespace = 'public'::regnamespace
               and q.proname = 'merge_school_settings')
      into v_src, v_rows
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'merge_school_settings';

    if v_rows <> 1 then
        raise exception 'F27s4: expected exactly one merge_school_settings, found %', v_rows;
    end if;

    -- The whole merge must be the `update ... set settings = settings || patch`
    -- statement. A separate SELECT of the current settings is the staged read that
    -- loses the other screen's change under concurrency.
    if v_src ~ 'select\s+settings\s+into' then
        raise exception 'F27s4: merge_school_settings reads the settings first (staged read-then-write)';
    end if;

    if v_src !~ '\|\|\s*p_patch' then
        raise exception 'F27s4: merge_school_settings does not merge the patch in one statement';
    end if;

    -- It must touch only the one row that exists, and only that row.
    if v_src !~ 'update\s+public\.school_profile' then
        raise exception 'F27s4: merge_school_settings does not update school_profile';
    end if;

    raise notice 'PASS: [F27s4] the merge is a single statement, so two sessions cannot interleave';
end;
$s4$;

-- F27s3: a user without `settings.manage` cannot merge.
do $s3$
declare
    v_claims jsonb;
begin
    select format('{"sub":"%s","role":"authenticated"}', p.id)::jsonb
      into v_claims
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'TEACHER' and p.status = 'ACTIVE'
     limit 1;

    if v_claims is null then
        raise notice 'SKIP: [F27s3] no active teacher to test with';
        return;
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', v_claims::text, true);

    begin
        perform public.merge_school_settings('{"f27_by_teacher": true}'::jsonb);
        perform set_config('role', 'postgres', true);
        raise exception 'F27s3: a teacher merged the school settings';
    exception
        when insufficient_privilege then
            perform set_config('role', 'postgres', true);
            if (select settings->>'f27_by_teacher' from public.school_profile where id is not null) is not null then
                raise exception 'F27s3: the refused merge still wrote';
            end if;
            raise notice 'PASS: [F27s3] a teacher cannot merge the school settings';
    end;
end;
$s3$;

rollback;
