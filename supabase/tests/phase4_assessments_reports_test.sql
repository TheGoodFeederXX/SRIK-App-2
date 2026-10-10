-- =============================================================================
-- SRIK Phase 4 — assessments and report cards test suite
-- =============================================================================
-- Same structure as the earlier suites: one transaction, rolled back at the end,
-- run against a THROWAWAY database.
--
-- These tests exist to prove the rules the school depends on cannot be broken:
--   * an absent child is not a failing child (null is not zero);
--   * a score cannot exceed the maximum;
--   * marks cannot be filed against a child who was never in the class;
--   * a teacher cannot enter marks for a class they do not teach;
--   * a published assessment cannot be silently edited;
--   * an incomplete assessment cannot be published;
--   * a PUBLISHED REPORT CARD DOES NOT CHANGE WHEN THE SOURCE CHANGES;
--   * a correction becomes a new revision, and the old one stays on file.
--
-- The report card rule is the one that matters most. It is the difference
-- between a school that can prove what it told a parent and one that cannot.
--
-- Requires the local shim, then Phases 1, 2, 3 and 4 applied in order.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Helpers (identical approach to the earlier suites)
-- ---------------------------------------------------------------------------
create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-b000-' || lpad(p_label, 12, '0'))::uuid;
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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p4@srik.test', now()),
    (test_id('3'), 'teacher.p4@srik.test', now()),
    (test_id('4'), 'outsider.p4@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'TEACHER')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026/2027', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

-- Two semesters, as the school uses.
insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
values
    (test_id('950'), test_id('900'), 'Semester 1', 1, '2026-01-01', '2026-06-30', 'CURRENT'),
    (test_id('951'), test_id('900'), 'Semester 2', 2, '2026-07-01', '2026-12-31', 'PLANNED')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values
    (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J'),
    (test_id('202'), test_id('900'), 5, 'Naim', '5N')
on conflict (id) do nothing;

insert into public.subjects (id, code, name) values
    (test_id('301'), 'MT4', 'Matematik'),
    (test_id('302'), 'SN4', 'Sains')
on conflict (id) do nothing;

-- Teacher P4T1 is linked to a real user, so the scoping policies can be tested
-- against a signed-in person rather than a bare row.
insert into public.teachers (id, user_id, staff_code, full_name, status) values
    (test_id('101'), test_id('3'), 'P4T1', 'Ustaz Pertama', 'ACTIVE'),
    (test_id('102'), null, 'P4T2', 'Ustaz Kedua', 'ACTIVE')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P4S1', 'Ahmad Zaki', 'ACTIVE'),
    (test_id('402'), 'P4S2', 'Nur Aisyah', 'ACTIVE'),
    (test_id('403'), 'P4S3', 'Umar Faruq', 'ACTIVE')
on conflict (id) do nothing;

-- Teacher 101 takes Matematik in 3 Al-Junaidi. Nobody takes Sains there.
insert into public.teaching_assignments
    (teacher_id, class_id, subject_id, academic_year_id, assignment_type,
     periods_per_week, status)
values
    (test_id('101'), test_id('201'), test_id('301'), test_id('900'),
     'SUBJECT_TEACHER', 6, 'ACTIVE')
on conflict do nothing;

insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('401'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('403'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

-- Attendance, so the report snapshot has something real to freeze.
insert into public.student_attendance
    (student_id, enrollment_id, class_id, attendance_date, status, recorded_by)
select test_id('401'), e.id, test_id('201'), d::date, 'PRESENT', test_id('1')
  from public.student_enrollments e,
       generate_series('2026-02-01'::date, '2026-02-10'::date, '1 day') d
 where e.student_id = test_id('401') and e.ended_at is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- An assessment to work with
-- ---------------------------------------------------------------------------
reset role;
insert into public.assessments
    (id, title, type, subject_id, class_id, academic_term_id, max_score, status)
values
    (test_id('600'), 'Ujian Pertengahan Tahun', 'MID_YEAR_EXAM',
     test_id('301'), test_id('201'), test_id('950'), 100, 'DRAFT')
on conflict (id) do nothing;

-- ===========================================================================
-- TEST 1: an absent child is not a failing child
-- ===========================================================================
-- The rule the whole phase rests on. Storing "absent" as 0 would make every
-- absent child look like they scored nothing and failed.
--
-- Written through the register function, because that is the only way marks can
-- be written at all: `authenticated` holds no INSERT grant on the table.
select test_as(test_id('1'));   -- ADMIN

do $$
begin
    begin
        -- A mark that is not "graded" must not carry a score at all.
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('401'), 'status', 'ABSENT', 'score', 0)),
            'test');
        raise exception 'FAIL: an absent child was given a score of 0'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    -- And a graded mark must have one.
    begin
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('401'), 'status', 'GRADED')),
            'test');
        raise exception 'FAIL: a graded mark was accepted with no score'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    -- An absent child must be storable WITHOUT a score.
    perform public.save_assessment_marks(
        test_id('600'),
        jsonb_build_array(jsonb_build_object(
            'student_id', test_id('401'), 'status', 'ABSENT')),
        'test');
    raise notice 'PASS: an absent child is never recorded as scoring zero';
end
$$;

-- ===========================================================================
-- TEST 2: a score cannot be above the maximum
-- ===========================================================================
do $$
begin
    begin
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('401'), 'status', 'GRADED', 'score', 101)),
            'test');
        raise exception 'FAIL: a score of 101 out of 100 was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    begin
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('401'), 'status', 'GRADED', 'score', -5)),
            'test');
        raise exception 'FAIL: a negative score was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a score must be between 0 and the assessment maximum';
end
$$;

-- ===========================================================================
-- TEST 2b: a mark cannot exceed a maximum that is not 100
-- ===========================================================================
do $$
begin
    -- A quiz out of 20, to prove the limit follows the assessment rather than a
    -- hard-coded 100.
    insert into public.assessments
        (id, title, type, subject_id, class_id, academic_term_id, max_score, status)
    values (test_id('610'), 'Kuiz 20 Markah', 'QUIZ',
            test_id('301'), test_id('201'), test_id('950'), 20, 'DRAFT')
    on conflict (id) do nothing;

    begin
        perform public.save_assessment_marks(
            test_id('610'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('401'), 'status', 'GRADED', 'score', 21)),
            'test');
        raise exception 'FAIL: 21 out of 20 was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    -- And 20 out of 20 must be fine.
    perform public.save_assessment_marks(
        test_id('610'),
        jsonb_build_array(jsonb_build_object(
            'student_id', test_id('401'), 'status', 'GRADED', 'score', 20)),
        'test');
    raise notice 'PASS: the score limit follows the assessment, not a fixed 100';
end
$$;

-- ===========================================================================
-- TEST 3: a mark cannot be filed against a child in another class
-- ===========================================================================
do $$
begin
    -- A child enrolled in 5 Naim, not in the class the assessment belongs to.
    reset role;
    insert into public.students (id, admission_no, full_name, status)
    values (test_id('405'), 'P4S5', 'Ali OutOfClass', 'ACTIVE')
    on conflict (id) do nothing;

    insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
    values (test_id('405'), test_id('202'), test_id('900'), '2026-01-05', 'ACTIVE')
    on conflict do nothing;

    perform test_as(test_id('1'));

    begin
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(jsonb_build_object(
                'student_id', test_id('405'), 'status', 'GRADED', 'score', 50)),
            'test');
        raise exception 'FAIL: a mark was filed for a child in a different class'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a mark cannot be filed against a child who was not in the class';
end
$$;

-- ===========================================================================
-- TEST 4: a whole register is saved in one call, and re-sending is harmless
-- ===========================================================================
do $$
declare
    v_result jsonb;
begin
    v_result := public.save_assessment_marks(
        test_id('600'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 85, 'tp', 5),
            jsonb_build_object('student_id', test_id('402'), 'status', 'GRADED', 'score', 72, 'tp', 4),
            jsonb_build_object('student_id', test_id('403'), 'status', 'ABSENT')
        ),
        'entering the register'
    );

    -- Three students, all three given a decided result. Two are scores and one
    -- is an absence, but an absence is a decision and counts as marked.
    if (v_result->>'graded')::integer <> 3 then
        raise exception 'FAIL: expected 3 results written, got %', v_result->>'graded';
    end if;

    -- Re-sending the identical register must change nothing at all.
    v_result := public.save_assessment_marks(
        test_id('600'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 85, 'tp', 5),
            jsonb_build_object('student_id', test_id('402'), 'status', 'GRADED', 'score', 72, 'tp', 4),
            jsonb_build_object('student_id', test_id('403'), 'status', 'ABSENT')
        ),
        'same again'
    );

    if (v_result->>'unchanged')::integer <> 3 then
        raise exception 'FAIL: re-sending the register changed % rows', v_result->>'graded';
    end if;

    raise notice 'PASS: a register saves in one call and re-sending it is harmless';
end
$$;

-- ===========================================================================
-- TEST 5: a teacher cannot enter marks for a class they do not teach
-- ===========================================================================
select test_as(test_id('4'));   -- the outsider, a TEACHER with no assignment here

do $$
begin
    begin
        perform public.save_assessment_marks(
            test_id('600'),
            jsonb_build_array(
                jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 99)),
            'should be refused');
        raise exception 'FAIL: an unassigned teacher entered marks'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a teacher cannot enter marks for a class they are not assigned to';
end
$$;

-- ===========================================================================
-- TEST 6: the assigned teacher CAN enter marks, and cannot publish
-- ===========================================================================
select test_as(test_id('3'));   -- the assigned TEACHER

do $$
declare
    v_result jsonb;
begin
    v_result := public.save_assessment_marks(
        test_id('600'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 88)),
        'teacher correcting a mark'
    );
    if (v_result->>'graded')::integer <> 1 then
        raise exception 'FAIL: the assigned teacher could not enter a mark'
            using errcode = 'raise_exception';
    end if;

    -- Publishing changes what the school tells parents, which is the office's
    -- decision rather than a subject teacher's.
    begin
        perform public.publish_assessment(test_id('600'), 'teacher trying');
        raise exception 'FAIL: a TEACHER published an assessment'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: the assigned teacher enters marks but cannot publish';
end
$$;

-- ===========================================================================
-- TEST 7: an assessment with missing marks cannot be published
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
begin
    -- A FRESH assessment where one child is deliberately left unmarked. The
    -- first assessment has all three decided by now, so it is the wrong subject
    -- for this test.
    reset role;
    insert into public.assessments
        (id, title, type, subject_id, class_id, academic_term_id, max_score, status)
    values (test_id('620'), 'Ujian Belum Siap', 'FINAL_EXAM',
            test_id('301'), test_id('201'), test_id('950'), 100, 'DRAFT')
    on conflict (id) do nothing;

    perform test_as(test_id('1'));

    -- Two of the three children marked, one left with nothing at all.
    perform public.save_assessment_marks(
        test_id('620'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 70),
            jsonb_build_object('student_id', test_id('402'), 'status', 'GRADED', 'score', 60)),
        'leaving one out');

    begin
        perform public.publish_assessment(test_id('620'), 'too early');
        -- A distinct errcode, so the handler below cannot swallow this.
        raise exception 'FAIL: an assessment with a missing mark was published'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
        when raise_exception then raise;
    end;

    raise notice 'PASS: an assessment cannot be published while a mark is missing';
end
$$;

-- ===========================================================================
-- TEST 8: once every mark is in, publishing works and freezes the marks
-- ===========================================================================
do $$
declare
    v_result jsonb;
begin
    -- Give the third child a decided result.
    perform public.save_assessment_marks(
        test_id('620'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('403'), 'status', 'GRADED', 'score', 65)),
        'completing the register');

    v_result := public.publish_assessment(test_id('620'), 'marks complete');
    if (v_result->>'published')::boolean is not true then
        raise exception 'FAIL: a complete assessment would not publish'
            using errcode = 'raise_exception';
    end if;

    -- And after publishing, the marks cannot be quietly changed. This must be
    -- aimed at the assessment that was just published (620); 600 is still a
    -- draft and editing it is perfectly legitimate.
    begin
        perform public.save_assessment_marks(
            test_id('620'),
            jsonb_build_array(
                jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 10)),
            'sneaking a change');
        raise exception 'FAIL: a published assessment accepted a silent edit'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a complete assessment publishes, and its marks are then frozen';
end
$$;

-- ===========================================================================
-- TEST 9: publishing an empty assessment is refused outright
-- ===========================================================================
do $$
begin
    begin
        perform public.publish_assessment(test_id('950'), 'not an assessment');
        raise exception 'FAIL: a non-existent assessment was published'
            using errcode = 'raise_exception';
    exception
        when no_data_found then null;
        when raise_exception then raise;
    end;
    raise notice 'PASS: publishing something that is not an assessment is refused';
end
$$;

-- ===========================================================================
-- TEST 10: the report snapshot freezes the marks as they stand
-- ===========================================================================
do $$
declare
    v_snap jsonb;
begin
    -- 600 already has every child decided, so it can be published for the
    -- report tests to work from.
    perform public.publish_assessment(test_id('600'), 'marks complete');

    v_snap := public.build_report_snapshot(test_id('401'), test_id('950'));

    if v_snap->'student'->>'full_name' <> 'Ahmad Zaki' then
        raise exception 'FAIL: the snapshot did not capture the child''s name';
    end if;

    if v_snap->'class'->>'display_name' <> '3 Al-Junaidi' then
        raise exception 'FAIL: the snapshot did not capture the class name'
            using errcode = 'raise_exception';
    end if;

    -- Only PUBLISHED assessments belong on a report. A draft is a plan.
    -- 600 and 620 are published by now; 610 (Kuiz) is still a draft and must
    -- NOT appear.
    if jsonb_array_length(v_snap->'assessments') <> 2 then
        raise exception 'FAIL: expected 2 published assessments, found %',
            jsonb_array_length(v_snap->'assessments');
    end if;

    -- The draft quiz must not be on the report.
    if exists (
        select 1 from jsonb_array_elements(v_snap->'assessments') a
         where a->>'title' = 'Kuiz 20 Markah'
    ) then
        raise exception 'FAIL: a draft assessment appeared on a report card'
            using errcode = 'raise_exception';
    end if;

    -- Attendance is summarised, and 10 days were recorded as present.
    if (v_snap->'attendance'->>'days_recorded')::integer <> 10 then
        raise exception 'FAIL: expected 10 recorded days, got %',
            v_snap->'attendance'->>'days_recorded';
    end if;

    raise notice 'PASS: the snapshot captures the child, class, marks and attendance';
end
$$;

-- ===========================================================================
-- TEST 11: THE RULE THAT MATTERS — a published report does not change when
--          the source changes
-- ===========================================================================
do $$
declare
    v_published jsonb;
    v_report    record;
    v_after     jsonb;
begin
    -- Publish the report, taking a snapshot of the marks as they are now.
    v_published := public.publish_report_card(test_id('401'), test_id('950'), 'end of term');

    select * into v_report from public.report_cards
     where student_id = test_id('401') and academic_term_id = test_id('950')
       and status = 'PUBLISHED';
    if v_report.id is null then
        raise exception 'FAIL: no published report card was created'
            using errcode = 'raise_exception';
    end if;

    -- Now change the SOURCE. A head teacher corrects the mark, and the child
    -- is renamed. On a live-computed report both would silently rewrite a
    -- report the parent has already been given.
    reset role;

    -- Re-open the assessment so the correction is possible.
    update public.assessments set status = 'CLOSED' where id = test_id('600');

    perform public.save_assessment_marks(
        test_id('600'),
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'GRADED', 'score', 10)),
        'a correction after the report went out');

    update public.students set full_name = 'Ahmad Zaki (renamed)' where id = test_id('401');

    -- The report must be byte-for-byte what it was.
    select snapshot into v_after from public.report_cards where id = v_report.id;

    if v_after <> v_report.snapshot then
        raise exception 'FAIL: the published report changed when the source changed'
            using errcode = 'raise_exception';
    end if;

    if v_after->'student'->>'full_name' <> 'Ahmad Zaki' then
        raise exception 'FAIL: the report picked up the new name (%)',
            v_after->'student'->>'full_name';
    end if;

    -- Find the mid-year exam by name rather than by position: the report now
    -- carries more than one assessment, and index 0 is not guaranteed to be it.
    if exists (
        select 1 from jsonb_array_elements(v_after->'assessments') a
         where a->>'title' = 'Ujian Pertengahan Tahun'
           and (a->>'score')::numeric <> 88
    ) then
        raise exception 'FAIL: the report picked up the corrected mark'
            using errcode = 'raise_exception';
    end if;

    -- And the corrected value really is different in the source now, so this
    -- test would fail if the snapshot were computed live.
    reset role;
    if not exists (
        select 1 from public.assessment_results r
         where r.assessment_id = test_id('600')
           and r.student_id = test_id('401')
           and r.score = 10
    ) then
        raise exception 'FAIL: the source was not actually changed, so this test proves nothing'
            using errcode = 'raise_exception';
    end if;
    perform test_as(test_id('1'));

    raise notice 'PASS: a published report does not change when the marks or the name change';
end
$$;

-- ===========================================================================
-- TEST 12: a correction becomes a new revision, with the old one kept
-- ===========================================================================
do $$
declare
    v_first  record;
    v_result jsonb;
    v_count  integer;
begin
    select * into v_first from public.report_cards
     where student_id = test_id('401') and academic_term_id = test_id('950')
       and status = 'PUBLISHED';

    v_result := public.publish_report_card(test_id('401'), test_id('950'), 'reissue after correction');

    if (v_result->>'version')::integer <> 2 then
        raise exception 'FAIL: the correction was not revision 2, got %', v_result->>'version';
    end if;

    if (v_result->>'superseded_id')::uuid <> v_first.id then
        raise exception 'FAIL: the new revision does not point at the one it replaces'
            using errcode = 'raise_exception';
    end if;

    -- The old report must still exist. A correction that deleted its
    -- predecessor would destroy the evidence of what was originally issued.
    select count(*) into v_count from public.report_cards
     where student_id = test_id('401') and academic_term_id = test_id('950');
    if v_count <> 2 then
        raise exception 'FAIL: expected 2 revisions on file, found %', v_count;
    end if;

    select count(*) into v_count from public.report_cards
     where id = v_first.id and status = 'SUPERSEDED';
    if v_count <> 1 then
        raise exception 'FAIL: the previous revision was not marked superseded'
            using errcode = 'raise_exception';
    end if;

    -- And only one revision may be current.
    select count(*) into v_count from public.report_cards
     where student_id = test_id('401') and academic_term_id = test_id('950')
       and status = 'PUBLISHED';
    if v_count <> 1 then
        raise exception 'FAIL: % revisions are current at once', v_count;
    end if;

    raise notice 'PASS: a correction is a new revision, and the original stays on file';
end
$$;

-- ===========================================================================
-- TEST 13: the new revision carries the corrected mark
-- ===========================================================================
do $$
declare
    v_snap jsonb;
begin
    select snapshot into v_snap from public.report_cards
     where student_id = test_id('401') and academic_term_id = test_id('950')
       and status = 'PUBLISHED';

    if exists (
        select 1 from jsonb_array_elements(v_snap->'assessments') a
         where a->>'title' = 'Ujian Pertengahan Tahun'
           and (a->>'score')::numeric <> 10
    ) then
        raise exception 'FAIL: the new revision did not pick up the correction'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a new revision is rebuilt from the corrected source';
end
$$;

-- ===========================================================================
-- TEST 14: a teacher reads their own class's assessments but not another's
-- ===========================================================================
select test_as(test_id('3'));   -- the assigned TEACHER

do $$
declare
    v_seen integer;
begin
    -- Assigned to 3 Al-Junaidi, so this assessment is visible.
    select count(*) into v_seen from public.assessments where id = test_id('600');
    if v_seen <> 1 then
        raise exception 'FAIL: the assigned teacher could not see their own assessment'
            using errcode = 'raise_exception';
    end if;

    reset role;
    insert into public.assessments
        (id, title, type, subject_id, class_id, academic_term_id, max_score, status)
    values (test_id('601'), 'Ujian Kelas Lain', 'MID_YEAR_EXAM',
            test_id('302'), test_id('202'), test_id('950'), 100, 'DRAFT')
    on conflict (id) do nothing;

    perform test_as(test_id('3'));

    -- Belongs to a class they do not teach, so it must not be readable.
    select count(*) into v_seen from public.assessments where id = test_id('601');
    if v_seen <> 0 then
        raise exception 'FAIL: a teacher read an assessment from a class they do not teach'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: a teacher sees their own class''s assessments and not another''s';
end
$$;

-- ===========================================================================
-- TEST 15: a report card cannot be invented by a screen
-- ===========================================================================
reset role;

do $$
declare
    v_ok boolean;
begin
    -- Report cards are written only by the snapshot function, so there is no
    -- INSERT grant. A screen that could insert one could also fabricate a
    -- report the school never issued.
    select has_table_privilege('authenticated', 'public.report_cards', 'INSERT')
      into v_ok;
    if v_ok then
        raise exception 'FAIL: authenticated can insert a report card directly'
            using errcode = 'raise_exception';
    end if;

    select has_table_privilege('authenticated', 'public.assessment_results', 'INSERT')
      into v_ok;
    if v_ok then
        raise exception 'FAIL: authenticated can insert a result directly, bypassing the register'
            using errcode = 'raise_exception';
    end if;

    raise notice 'PASS: report cards and results can only be written through the audited functions';
end
$$;

-- ===========================================================================
-- TEST 16: RLS is on and forced for every new table
-- ===========================================================================
do $$
declare
    v_missing text;
begin
    select string_agg(c.relname, ', ') into v_missing
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname in ('grade_boundaries', 'assessments', 'assessment_results', 'report_cards')
       and not (c.relrowsecurity and c.relforcerowsecurity);

    if v_missing is not null then
        raise exception 'FAIL: RLS is not enabled and forced on: %', v_missing;
    end if;

    raise notice 'PASS: RLS is enabled and forced on all four new tables';
end
$$;

-- ===========================================================================
-- TEST 17: the grade scale is the school's data, not code
-- ===========================================================================
do $$
declare
    v_count integer;
begin
    -- Seeded with a usable default, and editable afterwards.
    select count(*) into v_count from public.grade_boundaries where status = 'ACTIVE';
    if v_count < 5 then
        raise exception 'FAIL: the grade scale is empty'
            using errcode = 'raise_exception';
    end if;

    begin
        insert into public.grade_boundaries (grade, min_percent, max_percent)
        values ('X', 80, 50);
        raise exception 'FAIL: a boundary with min above max was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: the grade scale is stored as data and its ranges are validated';
end
$$;

-- ===========================================================================
-- TEST 18: every write to an assessment is audited
-- ===========================================================================
do $$
declare
    v_marks integer;
    v_pub   integer;
    v_rep   integer;
begin
    select count(*) into v_marks from public.authorization_audit
     where action = 'ASSESSMENT_MARKS_SAVED';
    select count(*) into v_pub from public.authorization_audit
     where action = 'ASSESSMENT_PUBLISHED';
    select count(*) into v_rep from public.authorization_audit
     where action = 'REPORT_CARD_PUBLISHED';

    if v_marks = 0 or v_pub = 0 or v_rep = 0 then
        raise exception 'FAIL: an action was taken without an audit record (marks=%, publish=%, report=%)',
            v_marks, v_pub, v_rep;
    end if;

    raise notice 'PASS: entering marks, publishing and issuing a report are all audited';
end
$$;

-- ===========================================================================
-- Summary
-- ===========================================================================
reset role;
do $$
begin
    raise notice '';
    raise notice '==============================================';
    raise notice '  ALL PHASE 4 ASSESSMENT AND REPORT TESTS PASSED';
    raise notice '==============================================';
end
$$;

rollback;
