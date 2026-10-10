-- Guard tests for audit findings F05, F06 and F07 — record-scope authorization.
--
-- WHAT THESE THREE HAVE IN COMMON. Each is a policy that asks "does this person
-- have the right kind of account?" and never asks "is this their record?". A
-- permission answers what someone may DO; it says nothing about WHICH rows. Both
-- questions have to be answered, and these policies only answered the first.
--
--   F05  a DISABLED guardian still reads their child, because the guardian
--        policies are granted to `public` and never call `is_active_user()`
--   F06  every teacher reads every student's personal details, because
--        `students.view` is held by TEACHER and the policy stops there
--   F07  any signed-in user reads the whole school's attendance, because the
--        only condition is `is_active_user()` — there is no scope clause at all
--
-- These helpers are defined here rather than shared. The phase suites create
-- theirs INSIDE the transaction and roll back, so nothing survives for this file
-- to use. Same reason this file uses `raise_exception` for every guard: a raised
-- error is the only failure mode that cannot be swallowed.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e000-' || lpad(p_label, 12, '0'))::uuid;
$$;

create or replace function test_as(p_user uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text,
        true
    );
    execute format('set local role %I', p_role);
end;
$$;

-- ===========================================================================
-- TEST SETUP: two unrelated families, a class, and a teacher who does not
-- teach it. The fixtures are the argument: a policy can only be shown to leak
-- if there is a record that belongs to somebody else.
-- ===========================================================================
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.scope@srik.test', now()),
    (test_id('2'), 'guru.scope@srik.test', now()),
    (test_id('10'), 'bapa.a.scope@srik.test', now()),
    (test_id('11'), 'bapa.b.scope@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
    (test_id('1'), 'Pentadbir Ujian', 'ACTIVE'),
    (test_id('2'), 'Guru Ujian', 'ACTIVE'),
    -- Family A's own account is ACTIVE...
    (test_id('10'), 'Bapa A', 'ACTIVE'),
    -- ...and family B's is DISABLED. Same policy, different account state, so a
    -- leaked row is visible rather than assumed.
    --
    -- `on conflict do UPDATE`, not `do nothing`. A plain `do nothing` left this
    -- account ACTIVE and the test passed for the wrong reason: an earlier suite in
    -- the same database had already created this id, so the conflicting insert was
    -- skipped in silence and the policy was never exercised against a disabled
    -- account. A diagnostic caught it — the row read ACTIVE. The account state is
    -- the entire subject of this test, so it is forced rather than merely proposed.
    (test_id('11'), 'Bapa B (DILUMPUHKAN)', 'DISABLED')
on conflict (id) do update set status = excluded.status;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'), (test_id('2'), 'TEACHER'),
    (test_id('10'), 'GUARDIAN'), (test_id('11'), 'GUARDIAN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code, status)
values (test_id('700'), test_id('900'), 1, '1 Al-Junaidi', '1J', 'ACTIVE')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, gender, status)
values
    (test_id('401'), 'A-001', 'Anak Keluarga A', 'MALE', 'ACTIVE'),
    (test_id('402'), 'B-001', 'Anak Keluarga B', 'FEMALE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments
    (id, student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('501'), test_id('401'), test_id('700'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('502'), test_id('402'), test_id('700'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict (id) do nothing;

insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('601'), test_id('10'), 'Bapa A', '0111111111'),
    (test_id('602'), test_id('11'), 'Bapa B', '0222222222')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
    (test_id('401'), test_id('601'), 'FATHER', true),
    (test_id('402'), test_id('602'), 'FATHER', true)
on conflict do nothing;

-- A teacher who exists but teaches NOTHING. Every class-scoped policy must then
-- return nothing for them, and 402's details must be unreachable.
insert into public.teachers (id, user_id, staff_code, full_name, status)
values (test_id('801'), test_id('2'), 'G-UJI', 'Guru Ujian', 'ACTIVE')
on conflict (id) do nothing;

-- Attendance for BOTH children, so a leak of the other family's record is
-- detectable rather than merely unlikely.
insert into public.student_attendance
    (id, student_id, enrollment_id, class_id, attendance_date, status)
values
    (test_id('901'), test_id('401'), test_id('501'), test_id('700'), '2026-03-02', 'PRESENT'),
    (test_id('902'), test_id('402'), test_id('502'), test_id('700'), '2026-03-02', 'ABSENT')
on conflict (id) do nothing;

-- ===========================================================================
-- F05: a DISABLED guardian must not read their child's record.
-- ===========================================================================
select test_as(test_id('11'));  -- family B's DISABLED guardian

do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.students where id = test_id('402');
    if v_seen > 0 then
        raise exception 'FAIL F05: a DISABLED guardian read their child''s student record'
            using errcode = 'raise_exception';
    end if;
    select count(*) into v_seen from public.student_guardians where student_id = test_id('402');
    if v_seen > 0 then
        raise exception 'FAIL F05: a DISABLED guardian read their child''s guardian link'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a disabled account reads nothing, even for its own child';
end
$$;

-- And the ACTIVE guardian in the same position must still see theirs. Without
-- this half, the fix could "pass" by denying everybody, which is a different bug.
reset role;
select test_as(test_id('10'));  -- family A's ACTIVE guardian

do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.students where id = test_id('401');
    if v_seen <> 1 then
        raise exception 'FAIL F05: an ACTIVE guardian could not read their own child'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an active guardian still reads their own child';
end
$$;

-- ===========================================================================
-- F06: a teacher must not read a student they do not teach.
-- ===========================================================================
reset role;
select test_as(test_id('2'));  -- TEACHER, teaches nothing

do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.students where id = test_id('402');
    if v_seen > 0 then
        raise exception 'FAIL F06: a teacher read a student they do not teach'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher cannot read a student outside their classes';
end
$$;

-- The ADMIN must still see everyone: the school's office has to be able to look
-- up any child, and a fix that broke that would be rejected by the school.
reset role;
select test_as(test_id('1'));  -- ADMIN

do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.students
     where id in (test_id('401'), test_id('402'));
    if v_seen <> 2 then
        raise exception 'FAIL F06: the admin lost sight of students (% of 2)', v_seen
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the admin still sees every student';
end
$$;

-- ===========================================================================
-- F07: attendance must be scoped, not merely gated on being signed in.
-- ===========================================================================
reset role;
select test_as(test_id('10'));  -- family A's guardian

do $$
declare
    v_seen integer;
begin
    -- Their own child: expected.
    select count(*) into v_seen from public.student_attendance where student_id = test_id('401');
    if v_seen <> 1 then
        raise exception 'FAIL F07: a guardian could not read their own child''s attendance'
            using errcode = 'raise_exception';
    end if;

    -- Another family's child: the leak. The old policy was `is_active_user()`
    -- alone, so this returned 1 for ANY signed-in account.
    select count(*) into v_seen from public.student_attendance where student_id = test_id('402');
    if v_seen > 0 then
        raise exception 'FAIL F07: a guardian read ANOTHER child''s attendance'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: attendance is scoped to the caller''s own children';
end
$$;

-- ===========================================================================
-- F08 and F09: the WRITE paths must be scoped, and the mitigation is structural.
--
-- These two findings are different in kind from F05/F06/F07 and it is worth
-- recording why, because the difference is the whole answer.
--
-- `student_attendance_write` and `assessment_results_write` are permission tests
-- with no scope clause — exactly the shape of the defects above. They are NOT
-- exploitable, because `authenticated` does not hold INSERT, UPDATE or DELETE on
-- either table: writes must go through the RPCs, and the RPCs DO check class
-- scope. The permissive policy is unreachable.
--
-- That is a real mitigation and not a reason to relax, so the test locks the
-- STRUCTURE rather than the policy text: if a future migration grants write
-- access to the table, these fail and the mis-scoped policy becomes live.
-- ===========================================================================
reset role;
do $$
declare
    v_tables text[] := array['student_attendance', 'assessment_results'];
    v_table  text;
    v_priv   text;
    v_open   text := '';
begin
    foreach v_table in array v_tables loop
        foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
            if has_table_privilege('authenticated',
                                   format('public.%I', v_table), v_priv) then
                v_open := v_open || format('%s.%s ', v_table, v_priv);
            end if;
        end loop;
    end loop;

    if v_open <> '' then
        raise exception
            'FAIL F08/F09: an API role can write these tables directly, so their '
            'unscoped write policies are now reachable: %', v_open
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: attendance and marks cannot be written except through the scoped RPCs';
end
$$;

-- And the RPC that writes marks must actually carry the class scope. Asserted on
-- the function BODY, because the guarantee is inside the SQL and a later
-- `create or replace` could drop it while leaving every policy untouched.
reset role;
do $$
declare
    v_body text := pg_get_functiondef(
        (select oid from pg_proc where proname = 'save_assessment_marks')
    );
begin
    if v_body not like '%teaching_assignments%'
       or v_body not like '%current_teacher_id%' then
        raise exception
            'FAIL F09: save_assessment_marks no longer scopes to the teacher''s classes'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: save_assessment_marks scopes marks to the teacher''s own classes';
end
$$;

rollback;
