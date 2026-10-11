-- Guard test for audit findings F23, F24 and F25 — which class is a child in, when.
--
-- THE SCENARIO, and it is the school's real calendar rather than a contrived one.
-- In October 2026 the office plans next year: every child is moved into their 2027
-- class. Nothing about 2026 changes — the year is still running, the children are
-- still in their 2026 classes until December.
--
-- Against the code being fixed, that single act of planning breaks four things:
--
--   1. Each promoted child has TWO open enrollments. `getStudent` reads with
--      `maybeSingle()`, which errors on two rows, so the child's record will not
--      open at all.
--   2. Every reader filtering `ended_at is null` sees both rows and picks whichever
--      the database returns first. The directory shows a 2026 child in a 2027 class.
--   3. A 2026 attendance register resolves the class for the day being marked
--      against a 2027 placement.
--   4. A published 2026 report card, regenerated, names the 2027 class against 2026
--      marks. The marks are right and the class is wrong, which is the kind of
--      error that is only found by a parent.
--
-- WHAT THIS SUITE PINS.
--   a. In October 2026 but holding only a 2027 placement, the child is STILL in
--      their 2026 class.            <- F24
--   b. The 2027 placement does not take effect until 2027 starts.  <- F24
--   c. On a date inside 2026, the answer is the 2026 class even after 2027 exists.
--                                                                  <- F23, F25
--   d. A child who moved class inside a year is in the OLD class before the move
--      and the NEW one after — the interval decides, not "the latest row".  <- F25
--   e. A child with no placement on that date resolves to NOTHING, not to a
--      neighbouring year's class.                                   <- F23
--   f. Planning next year leaves exactly ONE open enrollment, so `maybeSingle()`
--      cannot be handed two rows.                                   <- F24
--   g. Moving a child inside the same year still closes the old placement.  <- F24
--
-- (g) is the case a careless fix breaks: the obvious way to stop closing 2026's
-- row is to stop closing anything, and then a child who changed class in March is
-- in both classes for the rest of the year.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-ec00-' || lpad(p_label, 12, '0'))::uuid;
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

reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.f23@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Pentadbir F23', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status, must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- TWO academic years, 2026 running and 2027 planned. This is the whole fixture:
-- the bug does not exist with one year.
-- ---------------------------------------------------------------------------
-- ONLY ONE ACADEMIC YEAR MAY BE CURRENT — `idx_academic_years_one_current` is a
-- unique index, so inserting a second CURRENT year is a hard error rather than a
-- choice, and it aborts the whole transaction with "duplicate key value violates
-- unique constraint". The suite must therefore USE the current year rather than
-- create one.
--
-- In a fresh database there is one, seeded by Phase 2. If there is none, the
-- fixture makes the 2026 year current — which succeeds precisely because there is
-- no other.
create or replace function y23(p_which text) returns uuid language sql stable as $$
    select id from public.academic_years where name = 'F23-' || p_which limit 1;
$$;

do $$
begin
    if not exists (select 1 from public.academic_years where status = 'CURRENT') then
        insert into public.academic_years (id, name, start_date, end_date, status)
        values (test_id('901'), 'F23-2026', '2026-01-01', '2026-12-31', 'CURRENT')
        on conflict (id) do nothing;
    end if;
end
$$;

-- The planned year. 2027 must not be CURRENT, and must not exist as a name twice.
insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('902'), 'F23-2027', '2027-01-01', '2027-12-31', 'PLANNED')
on conflict (id) do update set status = 'PLANNED';

-- The 2026 class must belong to whichever year is actually CURRENT, or the
-- "current year" preference in `class_on` would be comparing against a different
-- year than the fixture assumes.
create or replace function y23_current() returns uuid language sql stable as $$
    select id from public.academic_years where status = 'CURRENT' limit 1;
$$;

insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'F23-401', 'Murid Naik Tahun', 'MALE', 'ACTIVE'),
    (test_id('402'), 'F23-402', 'Murid Tukar Kelas', 'FEMALE', 'ACTIVE'),
    (test_id('403'), 'F23-403', 'Murid Tiada Kelas', 'MALE', 'ACTIVE')
on conflict (id) do nothing;

-- Classes: one per year, plus a second 2026 class to move a child INTO.
insert into public.classes (id, academic_year_id, name, year_level, code, status) values
    (test_id('201'), y23_current(), 'F23 Tahun 3', 3, 'F23A', 'ACTIVE'),
    (test_id('202'), y23_current(), 'F23 Tahun 3 B', 3, 'F23B', 'ACTIVE'),
    (test_id('203'), y23('2027'), 'F23 Tahun 4', 4, 'F23C', 'ACTIVE')
on conflict (id) do nothing;

-- Preconditions, asserted where the fixture is made. Without two years and three
-- classes, several checks below would pass by accident.
do $$
begin
    if (select count(*) from public.academic_years where name like 'F23-%') <> 2 then
        raise exception 'F23 test setup: the two academic years were not created'
            using errcode = 'raise_exception';
    end if;
    if (select count(*) from public.academic_years where status = 'CURRENT') <> 1 then
        raise exception 'F23 test setup: expected exactly one CURRENT academic year, '
            'found %', (select count(*) from public.academic_years where status = 'CURRENT')
            using errcode = 'raise_exception';
    end if;
    if (select academic_year_id from public.classes where id = test_id('201'))
       is distinct from y23_current() then
        raise exception 'F23 test setup: the 2026 class does not belong to the CURRENT year'
            using errcode = 'raise_exception';
    end if;
    if (select count(*) from public.classes where code like 'F23%') <> 3 then
        raise exception 'F23 test setup: the three classes were not created'
            using errcode = 'raise_exception';
    end if;
end
$$;

select test_as(test_id('1'));

-- ===========================================================================
-- SETUP: child 401 is in the 2026 class, placed at the start of 2026.
-- Child 402 will move class inside 2026.
-- ===========================================================================
do $$
begin
    perform public.enroll_student(test_id('401'), test_id('201'), 'placement awal',
                                  '2026-01-01'::date);
    perform public.enroll_student(test_id('402'), test_id('201'), 'placement awal',
                                  '2026-01-01'::date);
    raise notice 'PASS: two children are placed in 2026';
end
$$;

-- ===========================================================================
-- F24a: THE CORE CASE. Plan 2027 for child 401 — then ask where the child is.
--
-- The answer must still be the 2026 class, because it is still 2026. This is the
-- check that fails against the defect: the old code stamped the 2027 placement
-- with `now()` and every reader saw it.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    perform public.plan_next_year_enrollment(test_id('401'), test_id('203'), 'naik tahun 4');

    v_class := public.class_on(test_id('401'), '2026-10-15'::date);

    if v_class is distinct from test_id('201') then
        raise exception
            'FAIL F24: in October 2026, after planning a 2027 placement, the child '
            'resolves to class % instead of their 2026 class — planning next year '
            'has moved them out of this year''s class',
            coalesce(v_class::text, '<none>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a 2027 placement does not change the 2026 class';
end
$$;

-- ===========================================================================
-- F24b: and when 2027 arrives, the placement DOES take effect.
--
-- The other half. A fix that ignored future placements entirely would pass the
-- check above and mean promotion never works.
-- ===========================================================================
do $$
declare
    v_class uuid;
    -- Kept deliberately: when this check fails, the rows ARE the diagnosis. The
    -- first version of the message said only that the answer was wrong, and finding
    -- out why took three runs.
    v_diag  text;
begin
    select string_agg(
               'yr=' || e.academic_year_id::text || ' cls=' || e.class_id::text ||
               ' from=' || e.enrolled_at::text || ' to=' || coalesce(e.ended_at::text, 'open'),
               ' | ')
      into v_diag
      from public.student_enrollments e
     where e.student_id = test_id('401');

    v_class := public.class_on(test_id('401'), '2027-01-15'::date);

    if v_class is distinct from test_id('203') then
        raise exception
            'FAIL F24: in January 2027 the child resolves to class % instead of their '
            '2027 class — the planned placement never took effect. ROWS: %. CURRENT: %',
            coalesce(v_class::text, '<none>'), coalesce(v_diag, '<no rows>'), y23_current()
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the 2027 placement takes effect in 2027';
end
$$;

-- ===========================================================================
-- F24c: exactly ONE open enrollment after planning.
--
-- `getStudent` reads the current placement with `maybeSingle()`, which ERRORS when
-- it is handed two rows — so two open enrollments is not a wrong answer, it is a
-- student record that refuses to open.
-- ===========================================================================
do $$
declare
    v_open integer;
begin
    select count(*) into v_open
      from public.student_enrollments
     where student_id = test_id('401') and ended_at is null;

    if v_open <> 1 then
        raise exception
            'FAIL F24: the child has % open enrollments. A reader asking for one row '
            'gets an error, and the student record cannot be opened at all', v_open
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: planning next year leaves exactly one open enrollment';
end
$$;

-- ===========================================================================
-- F25a: a mid-year class move — before the move, the OLD class.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    -- Child 402 moves class on 2026-04-01.
    perform public.enroll_student(test_id('402'), test_id('202'), 'pertukaran kelas',
                                  '2026-04-01'::date);

    v_class := public.class_on(test_id('402'), '2026-03-20'::date);
    if v_class is distinct from test_id('201') then
        raise exception
            'FAIL F25: before the move the child resolves to class % instead of the '
            'class they were in', coalesce(v_class::text, '<none>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: before a mid-year move, the child is in the old class';
end
$$;

-- ===========================================================================
-- F25b: on and after the move, the NEW class.
--
-- Both directions, because a reader that simply picked the OLDEST row would pass
-- the check above and be wrong forever after.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    v_class := public.class_on(test_id('402'), '2026-04-01'::date);
    if v_class is distinct from test_id('202') then
        raise exception
            'FAIL F25: on the day of the move the child resolves to class % instead '
            'of the new class', coalesce(v_class::text, '<none>')
            using errcode = 'raise_exception';
    end if;

    v_class := public.class_on(test_id('402'), '2026-09-01'::date);
    if v_class is distinct from test_id('202') then
        raise exception
            'FAIL F25: after the move the child resolves to class % instead of the '
            'new class', coalesce(v_class::text, '<none>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: on and after a mid-year move, the child is in the new class';
end
$$;

-- ===========================================================================
-- F25c: the day BEFORE the move belongs to the old class, not the new one.
--
-- An off-by-one here would put a child in a class a day early, and the mark would
-- land on the wrong register. The interval is inclusive of `enrolled_at`, and the
-- previous day is the one that must not tip over.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    v_class := public.class_on(test_id('402'), '2026-03-31'::date);
    if v_class is distinct from test_id('201') then
        raise exception
            'FAIL F25: the day before the move already resolves to the new class — '
            'a placement has taken effect one day early'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the day before a move still belongs to the old class';
end
$$;

-- ===========================================================================
-- F23a: a child with NO placement on that date resolves to NOTHING.
--
-- Child 403 was never enrolled. The answer must be no class — not the class of
-- another year, and not the most recent class the child ever had. Naming a class
-- a child was not in is worse than naming none, because nobody re-checks it.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    v_class := public.class_on(test_id('403'), '2026-06-01'::date);
    if v_class is not null then
        raise exception
            'FAIL F23: a child with no enrollment resolves to class % — a class they '
            'were never in', v_class
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a child with no placement resolves to nothing';
end
$$;

-- ===========================================================================
-- F23b: a date BEFORE any placement resolves to nothing.
--
-- The same rule, one step harder: the child has a placement, just not yet. Asking
-- about the year before they joined must not return their later class.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    v_class := public.class_on(test_id('401'), '2025-06-01'::date);
    if v_class is not null then
        raise exception
            'FAIL F23: a date before the child joined resolves to class %', v_class
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a date before the placement resolves to nothing';
end
$$;

-- ===========================================================================
-- F24d: moving a child WITHIN the same year still closes the old placement.
--
-- The case a careless fix breaks. The obvious way to stop the 2027 promotion from
-- closing the 2026 row is to stop closing anything — and then a child who changed
-- class in April is in both classes for the rest of the year.
-- ===========================================================================
do $$
declare
    v_class uuid;
begin
    -- Child 401 moves from 201 to 202 inside 2026.
    perform public.enroll_student(test_id('401'), test_id('202'), 'tukar kelas 2026',
                                  '2026-04-01'::date);

    v_class := public.class_on(test_id('401'), '2026-03-20'::date);
    if v_class is distinct from test_id('201') then
        raise exception
            'FAIL F24: before an in-year move the child resolves to class %', v_class
            using errcode = 'raise_exception';
    end if;

    v_class := public.class_on(test_id('401'), '2026-05-01'::date);
    if v_class is distinct from test_id('202') then
        raise exception
            'FAIL F24: after an in-year move the child resolves to class % instead '
            'of the new class — the old placement was not closed', v_class
            using errcode = 'raise_exception';
    end if;

    v_class := public.class_on(test_id('401'), '2027-02-01'::date);
    if v_class is distinct from test_id('203') then
        raise exception
            'FAIL F24: in 2027 the child resolves to class % — an in-year move in '
            '2026 removed their 2027 placement', v_class
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an in-year move closes the old placement and keeps the 2027 plan';
end
$$;

-- ===========================================================================
-- F23c: the SNAPSHOT question — a 2026 report names the 2026 class.
--
-- This is the F23 acceptance criterion stated directly: after promotion, a 2026
-- term still resolves to a 2026 class. Asked for a date inside the 2026 term, the
-- answer must be one of the 2026 classes and never the 2027 one.
-- ===========================================================================
reset role;
select test_as(test_id('1'));

do $$
declare
    v_class uuid;
    v_2026  uuid[] := array[test_id('201'), test_id('202')];
begin
    -- Ask about a date inside the 2026 academic year, after all the planning above.
    v_class := public.class_on(test_id('401'), '2026-06-01'::date);

    if v_class = test_id('203') then
        raise exception
            'FAIL F23: a 2026 date resolves to the 2027 class — a 2026 report card '
            'would name the class this child is in NEXT year against this year''s marks'
            using errcode = 'raise_exception';
    end if;

    if not (v_class = any(v_2026)) then
        raise exception
            'FAIL F23: a 2026 date resolves to class %, which is not a 2026 class',
            coalesce(v_class::text, '<none>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a 2026 date resolves to a 2026 class after promotion';
end
$$;

-- ===========================================================================
-- F24e: the SUPERSEDED OVERLOAD is gone.
--
-- `p_effective_from` has a default, so adding it creates a second function rather
-- than replacing the first. A three-argument call would then resolve to the OLD
-- one and keep the bug while the new code reads correctly in review. This project
-- has been bitten by exactly this before.
-- ===========================================================================
reset role;

do $$
declare
    v_count integer;
begin
    select count(*) into v_count
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'enroll_student';

    if v_count <> 1 then
        raise exception
            'FAIL F24: there are % functions named enroll_student. A three-argument '
            'call resolves to the one without the effective date, which keeps the '
            'original defect while appearing to be fixed', v_count
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: only the effective-date version of enroll_student exists';
end
$$;

-- ===========================================================================
-- F24f: an anonymous caller cannot ask for a student's class.
-- ===========================================================================
do $$
declare
    v_refused boolean := false;
begin
    begin
        execute 'set local role anon';
        perform public.class_on(test_id('401'), '2026-06-01'::date);
    exception when others then
        v_refused := true;
    end;
    reset role;

    if not v_refused then
        raise exception 'FAIL F24: an anonymous caller can resolve a student''s class'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an anonymous caller is refused';
end
$$;

rollback;
