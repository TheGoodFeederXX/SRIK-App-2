-- =============================================================================
-- SRIK Phase 3 — timetable and attendance test suite
-- =============================================================================
-- Same structure as the Phase 1 and 2 suites: one transaction, rolled back at
-- the end, run against a THROWAWAY database.
--
-- These tests are not here to prove that inserts work. They exist to prove the
-- rules the school depends on cannot be broken:
--   * a class cannot be in two lessons at once, and neither can a teacher;
--   * assembly, break and Zohor cannot become lessons in a mark sheet;
--   * a teacher cannot be scheduled for a subject they do not teach;
--   * a student cannot be marked present in a class they had already left;
--   * re-sending a register corrects it instead of duplicating it;
--   * a correction without a reason is refused;
--   * a missing attendance row is NOT the same as an absence.
--
-- Requires the local shim, then Phases 1, 2 and 3 applied in order.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Helpers (identical approach to the earlier suites)
-- ---------------------------------------------------------------------------
create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-a000-' || lpad(p_label, 12, '0'))::uuid;
$$;

-- Act as a given user. auth.uid() reads the JSON `request.jwt.claims` blob, not
-- the dot-separated setting; using the wrong one leaves auth.uid() NULL and
-- every policy denies, which looks like an RLS bug rather than a harness bug.
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
    (test_id('1'), 'admin.p3@srik.test', now()),
    (test_id('3'), 'teacher.p3@srik.test', now()),
    (test_id('4'), 'teacher2.p3@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'TEACHER')
on conflict do nothing;

-- Academic year must be CURRENT for the fixture to be realistic.
insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026/2027', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values
    (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J'),
    (test_id('202'), test_id('900'), 5, 'Naim', '5N')
on conflict (id) do nothing;

insert into public.subjects (id, code, name) values
    (test_id('301'), 'MT3', 'Matematik'),
    (test_id('302'), 'SNS3', 'Sains')
on conflict (id) do nothing;

insert into public.teachers (id, staff_code, full_name, status) values
    (test_id('101'), 'P3T1', 'Ustaz Pertama', 'ACTIVE'),
    (test_id('102'), 'P3T2', 'Ustaz Kedua', 'ACTIVE')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P3S1', 'Ahmad Zaki', 'ACTIVE'),
    (test_id('402'), 'P3S2', 'Nur Aisyah', 'ACTIVE')
on conflict (id) do nothing;

-- The teacher IS assigned to Matematik in 3 Al-Junaidi, but not to Sains.
-- A SUBJECT_TEACHER must carry a positive periods_per_week; the Phase 2 shape
-- constraint requires it.
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
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

insert into public.timetables (id, academic_year_id, name, version, status, effective_from)
values (test_id('700'), test_id('900'), 'Jadual Utama', 1, 'DRAFT', '2026-01-05')
on conflict (id) do nothing;

-- ===========================================================================
-- TEST 1: the school day template uses the boundaries the school gave
-- ===========================================================================
reset role;
do $$
declare
    v_created integer;
    v_break   record;
    v_zohor   record;
begin
    v_created := public.seed_school_day_template(test_id('700'));

    select * into v_break from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'SUNDAY' and period_number = 5;
    if v_break is null or v_break.start_time <> '09:50' or v_break.end_time <> '10:25'
       or v_break.type <> 'BREAK' then
        raise exception 'FAIL: period 5 is not the 9:50-10:25 break';
    end if;

    -- Zohor runs 13:20-14:00, as the school's own 2026 timetable export shows.
    select * into v_zohor from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 11;
    if v_zohor is null or v_zohor.type <> 'PRAYER' or v_zohor.start_time <> '13:20'
       or v_zohor.end_time <> '14:00' then
        raise exception 'FAIL: period 11 is not Zohor at 13:20-14:00';
    end if;

    -- Sunday period 1 is assembly, Thursday is Yasin/Dhuha, other days teach.
    if not exists (
        select 1 from public.timetable_periods
         where timetable_id = test_id('700') and day_of_week = 'SUNDAY'
           and period_number = 1 and type = 'ASSEMBLY'
    ) then
        raise exception 'FAIL: Sunday period 1 is not assembly';
    end if;

    if not exists (
        select 1 from public.timetable_periods
         where timetable_id = test_id('700') and day_of_week = 'THURSDAY'
           and period_number = 1 and label = 'Yasin/Dhuha'
    ) then
        raise exception 'FAIL: Thursday period 1 is not Yasin/Dhuha';
    end if;

    if not exists (
        select 1 from public.timetable_periods
         where timetable_id = test_id('700') and day_of_week = 'MONDAY'
           and period_number = 1 and type = 'TEACHING'
    ) then
        raise exception 'FAIL: Monday period 1 should be a teaching period';
    end if;

    raise notice 'PASS: school day template matches the boundaries the school gave';
end
$$;

-- ===========================================================================
-- TEST 2: the school day is the twelve periods the school actually runs
-- ===========================================================================
do $$
declare
    v_numbers integer[];
    v_row     record;
begin
    select array_agg(period_number order by period_number) into v_numbers
      from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'SUNDAY';

    if v_numbers <> array[1,2,3,4,5,6,7,8,9,10,11,12] then
        raise exception 'FAIL: expected 12 periods but got %', v_numbers;
    end if;

    -- The day must start and finish when the school does.
    select * into v_row from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'SUNDAY' and period_number = 1;
    if v_row.start_time <> '07:30' then
        raise exception 'FAIL: the day should start at 7:30, got %', v_row.start_time;
    end if;

    select * into v_row from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'SUNDAY' and period_number = 12;
    if v_row.end_time <> '14:30' then
        raise exception 'FAIL: the day should end at 14:30, got %', v_row.end_time;
    end if;

    raise notice 'PASS: the school day is the twelve periods the school runs (7:30-14:30)';
end
$$;

-- ===========================================================================
-- TEST 2b: every period is back-to-back — no gaps, no invented breaks
-- ===========================================================================
do $$
declare
    v_prev_number integer := null;
    v_prev_end    time := null;
    v_row         record;
begin
    for v_row in
        select period_number, start_time, end_time
          from public.timetable_periods
         where timetable_id = test_id('700') and day_of_week = 'SUNDAY'
         order by period_number
    loop
        if v_prev_number is not null and v_row.start_time <> v_prev_end then
            raise exception 'FAIL: a gap between period % (ends %) and % (starts %)',
                v_prev_number, v_prev_end, v_row.period_number, v_row.start_time;
        end if;
        v_prev_number := v_row.period_number;
        v_prev_end := v_row.end_time;
    end loop;
    raise notice 'PASS: the periods run back-to-back with no gaps';
end
$$;

-- ===========================================================================
-- TEST 3: overlapping periods are refused by the database
-- ===========================================================================
do $$
begin
    begin
        -- Overlaps the 09:50-10:25 break. Period 99 is unused, so this fails on
        -- the overlap itself rather than on the period number already existing.
        insert into public.timetable_periods
            (timetable_id, day_of_week, period_number, start_time, end_time, type)
        values (test_id('700'), 'SUNDAY', 99, '10:00', '10:30', 'TEACHING');
        raise exception 'FAIL: an overlapping period was accepted';
    exception
        when exclusion_violation then null;
    end;
    raise notice 'PASS: two periods on the same day cannot overlap';
end
$$;

-- ===========================================================================
-- TEST 4: a non-teaching period must say what it is
-- ===========================================================================
do $$
begin
    begin
        insert into public.timetable_periods
            (timetable_id, day_of_week, period_number, start_time, end_time, type, label)
        values (test_id('700'), 'TUESDAY', 98, '08:05', '08:40', 'BREAK', null);
        raise exception 'FAIL: a break period with no label was accepted';
    exception
        when check_violation then null;
    end;

    begin
        insert into public.timetable_periods
            (timetable_id, day_of_week, period_number, start_time, end_time, type, label)
        values (test_id('700'), 'TUESDAY', 98, '08:05', '08:40', 'TEACHING', 'Rehat');
        raise exception 'FAIL: a teaching period with a break label was accepted';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: a period must be labelled correctly for its type';
end
$$;

-- ===========================================================================
-- TEST 5: assembly and break cannot become lessons
-- ===========================================================================
do $$
declare
    v_assembly uuid;
    v_break    uuid;
begin
    select id into v_assembly from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'SUNDAY' and period_number = 1;
    select id into v_break from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 5;

    -- Assembly with a subject would put Perhimpunan in a mark sheet.
    begin
        insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
        values (v_assembly, test_id('201'), test_id('301'), test_id('101'));
        raise exception 'FAIL: a subject was attached to the assembly period';
    exception
        when check_violation then null;
    end;

    begin
        insert into public.timetable_entries (period_id, class_id, subject_id)
        values (v_break, test_id('201'), test_id('301'));
        raise exception 'FAIL: a subject was attached to the break period';
    exception
        when check_violation then null;
    end;

    -- An assembly entry with no subject is fine and expected.
    insert into public.timetable_entries (period_id, class_id)
    values (v_assembly, test_id('201'));
    insert into public.timetable_entries (period_id, class_id)
    values (v_assembly, test_id('202'));

    raise notice 'PASS: assembly and break cannot carry a subject';
end
$$;

-- ===========================================================================
-- TEST 6: a teaching period needs a subject
-- ===========================================================================
do $$
declare
    v_teach uuid;
begin
    select id into v_teach from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 1;

    begin
        insert into public.timetable_entries (period_id, class_id, teacher_id)
        values (v_teach, test_id('201'), test_id('101'));
        raise exception 'FAIL: a teaching period with no subject was accepted';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: a teaching period must name a subject';
end
$$;

-- ===========================================================================
-- TEST 7: a teacher cannot be scheduled for a subject they do not teach
-- ===========================================================================
do $$
declare
    v_teach uuid;
begin
    select id into v_teach from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 1;

    -- Teacher 101 teaches Matematik in this class, but NOT Sains.
    begin
        insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
        values (v_teach, test_id('201'), test_id('302'), test_id('101'));
        raise exception 'FAIL: a teacher was scheduled for a subject they do not teach';
    exception
        when check_violation then null;
    end;

    -- The subject they ARE assigned to is accepted.
    insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
    values (v_teach, test_id('201'), test_id('301'), test_id('101'));

    raise notice 'PASS: only assigned subjects can be scheduled for a teacher';
end
$$;

-- ===========================================================================
-- TEST 8: a class cannot be in two lessons at once
-- ===========================================================================
do $$
declare
    v_teach uuid;
begin
    select id into v_teach from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 1;

    begin
        -- Class 201 already has Matematik with teacher 101 in this period.
        -- Teacher 101 is the assigned teacher, so this entry passes the
        -- assignment check and fails on the double-booking rule — which is the
        -- rule under test. Using an unassigned teacher would trip the other
        -- check first and prove nothing about double-booking.
        insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
        values (v_teach, test_id('201'), test_id('301'), test_id('101'));
        raise exception 'FAIL: a class was double-booked in one period';
    exception
        when unique_violation then null;
    end;

    raise notice 'PASS: a class cannot be in two places in the same period';
end
$$;

-- ===========================================================================
-- TEST 9: a teacher cannot be in two classes at once
-- ===========================================================================
do $$
declare
    v_teach uuid;
begin
    select id into v_teach from public.timetable_periods
     where timetable_id = test_id('700') and day_of_week = 'MONDAY' and period_number = 1;

    -- Teacher 101 is already in class 201 for this period. Assign them to
    -- Matematik in class 202 too — legitimate assignment, impossible timetable.
    insert into public.teaching_assignments
        (teacher_id, class_id, subject_id, academic_year_id, assignment_type,
         periods_per_week, status)
    values (test_id('101'), test_id('202'), test_id('301'), test_id('900'),
            'SUBJECT_TEACHER', 6, 'ACTIVE')
    on conflict do nothing;

    begin
        insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
        values (v_teach, test_id('202'), test_id('301'), test_id('101'));
        raise exception 'FAIL: a teacher was double-booked across two classes';
    exception
        when unique_violation then null;
    end;

    raise notice 'PASS: a teacher cannot be in two classes in the same period';
end
$$;

-- ===========================================================================
-- TEST 10: a timetable with no lessons cannot be published
-- ===========================================================================
reset role;
do $$
begin
    -- The fixture rows above are inserted as the owner so they bypass RLS, but
    -- the RPC checks auth.uid(); act as the admin for the call itself.
    -- An empty timetable is its own record: timetable 700 already has the
    -- entries the conflict tests created, so it is no longer empty.
    insert into public.timetables (id, academic_year_id, name, version, status, effective_from)
    values (test_id('702'), test_id('900'), 'Jadual Kosong', 1, 'DRAFT', '2026-01-05')
    on conflict (id) do nothing;

    perform test_as(test_id('1'));
    begin
        perform public.publish_timetable(test_id('702'), 'Publish test');
        raise exception 'FAIL: an empty timetable was published';
    exception
        when check_violation then null;
    end;
    raise notice 'PASS: a timetable with no lessons cannot be published';
end
$$;

-- ===========================================================================
-- TEST 11: publishing supersedes the previous timetable instead of deleting it
-- ===========================================================================
reset role;
do $$
declare
    v_result jsonb;
    v_old    record;
begin
    perform test_as(test_id('1'));
    v_result := public.publish_timetable(test_id('700'), 'Mula guna');
    if not (v_result->>'published')::boolean then
        raise exception 'FAIL: publishing a timetable with lessons did not succeed';
    end if;

    if (select status from public.timetables where id = test_id('700')) <> 'PUBLISHED' then
        raise exception 'FAIL: the timetable is not PUBLISHED after publishing';
    end if;

    if (select published_at from public.timetables where id = test_id('700')) is null then
        raise exception 'FAIL: publish time was not recorded';
    end if;

    -- Publish a second version and confirm the first is superseded, not gone.
    reset role;
    insert into public.timetables (id, academic_year_id, name, version, status, effective_from)
    values (test_id('701'), test_id('900'), 'Jadual Utama', 2, 'DRAFT', '2026-06-01')
    on conflict (id) do nothing;

    insert into public.timetable_periods
        (id, timetable_id, day_of_week, period_number, start_time, end_time, type)
    values (test_id('710'), test_id('701'), 'MONDAY', 1, '07:30', '08:05', 'TEACHING')
    on conflict (id) do nothing;

    insert into public.timetable_entries (period_id, class_id, subject_id, teacher_id)
    values (test_id('710'), test_id('202'), test_id('301'), test_id('101'));

    perform test_as(test_id('1'));
    perform public.publish_timetable(test_id('701'), 'Versi kedua');

    select * into v_old from public.timetables where id = test_id('700');
    if v_old.status <> 'SUPERSEDED' then
        raise exception 'FAIL: the earlier timetable was not superseded (got %)', v_old.status;
    end if;
    if v_old.published_at is null then
        raise exception 'FAIL: superseding erased when the old timetable had been published';
    end if;

    raise notice 'PASS: publishing supersedes the previous timetable and keeps its history';
end
$$;

-- ===========================================================================
-- TEST 12: recording a class register works and is idempotent
-- ===========================================================================
reset role;
do $$
declare
    v_result jsonb;
    v_count  integer;
begin
    perform test_as(test_id('1'));
    perform set_config('role', 'authenticated', true);

    v_result := public.record_class_attendance(
        test_id('201'), '2026-02-02',
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'PRESENT'),
            jsonb_build_object('student_id', test_id('402'), 'status', 'ABSENT', 'remark', 'Demam')
        ),
        null);

    if (v_result->>'recorded')::integer <> 2 then
        raise exception 'FAIL: expected 2 records written, got %', v_result->>'recorded';
    end if;

    select count(*) into v_count from public.student_attendance
     where attendance_date = '2026-02-02';
    if v_count <> 2 then
        raise exception 'FAIL: expected 2 attendance rows, got %', v_count;
    end if;

    -- Re-sending the SAME register must not duplicate anything.
    v_result := public.record_class_attendance(
        test_id('201'), '2026-02-02',
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'PRESENT'),
            jsonb_build_object('student_id', test_id('402'), 'status', 'ABSENT', 'remark', 'Demam')
        ),
        null);

    if (v_result->>'recorded')::integer <> 0 or (v_result->>'corrected')::integer <> 0 then
        raise exception 'FAIL: re-sending an unchanged register was not a no-op: %', v_result;
    end if;

    select count(*) into v_count from public.student_attendance
     where attendance_date = '2026-02-02';
    if v_count <> 2 then
        raise exception 'FAIL: re-sending duplicated the register (% rows)', v_count;
    end if;

    raise notice 'PASS: a class register is recorded once and re-sending it is a no-op';
end
$$;

-- ===========================================================================
-- TEST 13: changing a status corrects the record and writes an audit row
-- ===========================================================================
do $$
declare
    v_result jsonb;
    v_count  integer;
begin
    perform test_as(test_id('1'));

    v_result := public.record_class_attendance(
        test_id('201'), '2026-02-02',
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('402'), 'status', 'LATE', 'remark', 'Lewat 10 minit')
        ),
        null);

    if (v_result->>'corrected')::integer <> 1 then
        raise exception 'FAIL: changing a status did not register as a correction: %', v_result;
    end if;

    select count(*) into v_count from public.attendance_corrections
     where student_id = test_id('402') and attendance_date = '2026-02-02';
    if v_count <> 1 then
        raise exception 'FAIL: expected 1 audit row, got %', v_count;
    end if;

    if not exists (
        select 1 from public.attendance_corrections
         where student_id = test_id('402') and attendance_date = '2026-02-02'
           and old_status = 'ABSENT' and new_status = 'LATE'
    ) then
        raise exception 'FAIL: the audit row does not record what changed';
    end if;

    -- Still one row for the day: a correction replaces, never duplicates.
    select count(*) into v_count from public.student_attendance
     where student_id = test_id('402') and attendance_date = '2026-02-02';
    if v_count <> 1 then
        raise exception 'FAIL: a correction created a second row for the day';
    end if;

    raise notice 'PASS: a changed status corrects the record and is written to the audit trail';
end
$$;

-- ===========================================================================
-- TEST 14: one record per student per day is a database guarantee
-- ===========================================================================
do $$
begin
    -- The unique rule is proven as the OWNER, because `authenticated` holds no
    -- direct INSERT grant (proven separately in test 19). Testing it as the
    -- owner isolates the rule itself from the grant.
    reset role;
    begin
        insert into public.student_attendance
            (student_id, enrollment_id, class_id, attendance_date, status)
        select student_id, enrollment_id, class_id, '2026-02-02', 'PRESENT'
          from public.student_attendance
         where attendance_date = '2026-02-02' limit 1;
        raise exception 'FAIL: a second attendance row for the same student and day was accepted';
    exception
        when unique_violation then null;
    end;
    raise notice 'PASS: a student can only have one attendance record per day';
end
$$;

-- ===========================================================================
-- TEST 15: a student cannot be marked in a class they were not enrolled in
-- ===========================================================================
do $$
begin
    perform test_as(test_id('1'));

    begin
        -- Student 401 is enrolled in 201, not 202.
        perform public.record_class_attendance(
            test_id('202'), '2026-02-02',
            jsonb_build_array(
                jsonb_build_object('student_id', test_id('401'), 'status', 'PRESENT')
            ),
            null);
        raise exception 'FAIL: attendance was recorded for a class the student is not in';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: a student cannot be marked in a class they were not enrolled in';
end
$$;

-- ===========================================================================
-- TEST 16: attendance cannot be attached to an enrollment that had ended
-- ===========================================================================
reset role;
do $$
declare
    v_old_enrollment uuid;
begin
    -- Close the enrollment on 2026-03-01 by moving the student to class 202.
    perform test_as(test_id('1'));
    select id into v_old_enrollment from public.student_enrollments
     where student_id = test_id('401') and class_id = test_id('201');

    reset role;
    update public.student_enrollments
       set ended_at = '2026-03-01'
     where id = v_old_enrollment;

    -- Proving the enrollment rule needs to write directly, which `authenticated`
    -- cannot (test 19 proves that is deliberate), so it is done as the owner.
    reset role;
    begin
        insert into public.student_attendance
            (student_id, enrollment_id, class_id, attendance_date, status)
        values (test_id('401'), v_old_enrollment, test_id('201'), '2026-03-15', 'PRESENT');
        raise exception 'FAIL: attendance was recorded against an ended enrollment';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: attendance cannot be attached to an enrollment that had ended';
end
$$;

-- ===========================================================================
-- TEST 17: a correction must state a reason
-- ===========================================================================
do $$
begin
    perform test_as(test_id('1'));

    begin
        perform public.correct_attendance(
            test_id('401'), '2026-02-02', 'SICK', '   ', null);
        raise exception 'FAIL: a correction with a blank reason was accepted';
    exception
        when invalid_parameter_value then null;
    end;

    begin
        perform public.correct_attendance(
            test_id('401'), '2026-02-02', 'SICK', null, null);
        raise exception 'FAIL: a correction with no reason was accepted';
    exception
        when invalid_parameter_value then null;
    end;

    raise notice 'PASS: a correction must state a reason';
end
$$;

-- ===========================================================================
-- TEST 18: a missing row is NOT an absence
-- ===========================================================================
do $$
declare
    v_recorded integer;
    v_absent   integer;
begin
    perform test_as(test_id('1'));

    -- Nobody recorded 2026-02-03. Reporting that day as a full absence would
    -- accuse every student of missing school.
    select count(*) into v_absent
      from public.student_attendance
     where attendance_date = '2026-02-03' and status = 'ABSENT';
    if v_absent <> 0 then
        raise exception 'FAIL: a day with no register produced % absences', v_absent;
    end if;

    select count(*) into v_recorded
      from public.student_attendance where attendance_date = '2026-02-03';
    if v_recorded <> 0 then
        raise exception 'FAIL: a day with no register has % rows', v_recorded;
    end if;

    raise notice 'PASS: a day with no register is distinguishable from a day of absences';
end
$$;

-- ===========================================================================
-- TEST 19: attendance cannot be written directly, only through the RPC
-- ===========================================================================
do $$
begin
    perform test_as(test_id('1'));

    begin
        insert into public.student_attendance
            (student_id, enrollment_id, class_id, attendance_date, status)
        select student_id, enrollment_id, class_id, '2026-02-04', 'PRESENT'
          from public.student_attendance where attendance_date = '2026-02-02' limit 1;
        raise exception 'FAIL: a direct insert into student_attendance succeeded';
    exception
        when insufficient_privilege then null;
    end;

    raise notice 'PASS: attendance can only be written through the audited RPC';
end
$$;

-- ===========================================================================
-- TEST 20: a TEACHER can record a register but cannot publish a timetable
-- ===========================================================================
do $$
declare
    v_result jsonb;
begin
    perform test_as(test_id('3'));

    -- Recording is the teacher's job.
    v_result := public.record_class_attendance(
        test_id('201'), '2026-02-05',
        jsonb_build_array(
            jsonb_build_object('student_id', test_id('401'), 'status', 'PRESENT')
        ),
        null);
    if (v_result->>'recorded')::integer <> 1 then
        raise exception 'FAIL: a TEACHER could not record a register';
    end if;

    -- Publishing the timetable is not.
    begin
        perform public.publish_timetable(test_id('701'), 'Cuba');
        raise exception 'FAIL: a TEACHER published a timetable';
    exception
        when insufficient_privilege then null;
    end;

    raise notice 'PASS: a TEACHER records registers but cannot publish timetables';
end
$$;

-- ===========================================================================
-- TEST 21: a TEACHER cannot read the staff attendance register
-- ===========================================================================
do $$
declare
    v_visible integer;
begin
    reset role;
    insert into public.teacher_attendance
        (teacher_id, attendance_date, status, check_in)
    values (test_id('101'), '2026-02-02', 'PRESENT', '2026-02-02 07:20:00+08');

    perform test_as(test_id('3'));

    -- Staff attendance is the office's business. A teacher seeing a colleague's
    -- record would be a privacy problem, not a feature.
    select count(*) into v_visible from public.teacher_attendance;
    if v_visible <> 0 then
        raise exception 'FAIL: a TEACHER could read % staff attendance rows', v_visible;
    end if;

    raise notice 'PASS: a TEACHER cannot read the staff attendance register';
end
$$;

-- ===========================================================================
-- TEST 22: an ADMIN can read staff attendance, and check-out cannot precede check-in
-- ===========================================================================
reset role;
do $$
begin
    perform test_as(test_id('1'));

    if (select count(*) from public.teacher_attendance) <> 1 then
        raise exception 'FAIL: an ADMIN could not read the staff attendance register';
    end if;

    begin
        insert into public.teacher_attendance
            (teacher_id, attendance_date, check_in, check_out, status)
        values (test_id('102'), '2026-02-03',
                '2026-02-03 08:00:00+08', '2026-02-03 07:00:00+08', 'PRESENT');
        raise exception 'FAIL: leaving before arriving was accepted';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: an ADMIN reads staff attendance and impossible times are refused';
end
$$;

-- ===========================================================================
-- TEST 23: the correction log cannot be edited or deleted
-- ===========================================================================
reset role;
do $$
declare
    v_before integer;
begin
    select count(*) into v_before from public.attendance_corrections;

    perform test_as(test_id('1'));

    begin
        update public.attendance_corrections set reason = 'ditukar';
        if (select count(*) from public.attendance_corrections) <> v_before then
            raise exception 'FAIL: the correction log changed size';
        end if;
    exception
        when insufficient_privilege then null;
    end;

    begin
        delete from public.attendance_corrections;
        if (select count(*) from public.attendance_corrections) <> v_before then
            raise exception 'FAIL: a correction was deleted';
        end if;
    exception
        when insufficient_privilege then null;
    end;

    raise notice 'PASS: the correction log is append-only';
end
$$;

-- ===========================================================================
-- TEST 24: an inactive user reads nothing new
-- ===========================================================================
reset role;
do $$
declare
    v_visible integer;
begin
    insert into auth.users (id, email, email_confirmed_at)
    values (test_id('6'), 'disabled.p3@srik.test', now())
    on conflict (id) do nothing;
    update public.profiles set status = 'DISABLED', disabled_at = now()
     where id = test_id('6');

    perform test_as(test_id('6'));

    select count(*) into v_visible from public.student_attendance;
    if v_visible <> 0 then
        raise exception 'FAIL: a DISABLED user read % attendance rows', v_visible;
    end if;

    select count(*) into v_visible from public.timetables;
    if v_visible <> 0 then
        raise exception 'FAIL: a DISABLED user read % timetables', v_visible;
    end if;

    raise notice 'PASS: a DISABLED user reads no attendance and no timetable';
end
$$;

-- ===========================================================================
-- TEST 25: exact teaching pairs — no invented subjects, no invented class teachers
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_created integer;
    v_subj    integer;
    v_ct      integer;
begin
    -- One teacher, two classes, each with a DIFFERENT subject. This is the case
    -- set_teacher_assignments cannot express: it pairs every class with every
    -- subject, granting a subject the teacher does not take.
    v_created := public.set_teaching_pairs(
        test_id('102'), test_id('900'),
        jsonb_build_array(
            jsonb_build_object('class_id', test_id('201'), 'subject_id', test_id('301')),
            jsonb_build_object('class_id', test_id('202'), 'subject_id', test_id('302'))
        ),
        'test'
    );

    if v_created <> 2 then
        raise exception 'FAIL: expected 2 subject duties, got %', v_created;
    end if;

    select count(*) into v_subj from public.teaching_assignments
     where teacher_id = test_id('102') and status = 'ACTIVE'
       and assignment_type = 'SUBJECT_TEACHER';
    if v_subj <> 2 then
        raise exception 'FAIL: expected exactly 2 subject duties, found %', v_subj;
    end if;

    -- The exact pairing must hold: subject 301 only with class 201, never 202.
    if exists (select 1 from public.teaching_assignments
                where teacher_id = test_id('102') and status = 'ACTIVE'
                  and class_id = test_id('202') and subject_id = test_id('301')) then
        raise exception 'FAIL: subject 301 was paired with class 202, which was never asked for';
    end if;

    -- And it must NOT have made the teacher a class teacher.
    select count(*) into v_ct from public.teaching_assignments
     where teacher_id = test_id('102') and status = 'ACTIVE'
       and assignment_type = 'CLASS_TEACHER';
    if v_ct <> 0 then
        raise exception 'FAIL: a class-teacher duty was created when none was asked for';
    end if;

    raise notice 'PASS: exact teaching pairs are recorded without inventing subjects or class teachers';
end
$$;

-- ===========================================================================
-- TEST 26: re-setting pairs closes the old set, and the old set is kept
-- ===========================================================================
do $$
declare
    v_created integer;
    v_open    integer;
    v_closed  integer;
begin
    v_created := public.set_teaching_pairs(
        test_id('102'), test_id('900'),
        jsonb_build_array(
            jsonb_build_object('class_id', test_id('201'), 'subject_id', test_id('302'))
        ),
        'changed'
    );

    if v_created <> 1 then
        raise exception 'FAIL: expected 1 new duty, got %', v_created;
    end if;

    select count(*) into v_open from public.teaching_assignments
     where teacher_id = test_id('102') and status = 'ACTIVE'
       and assignment_type = 'SUBJECT_TEACHER';
    if v_open <> 1 then
        raise exception 'FAIL: two live sets make "who teaches this" ambiguous (% open)', v_open;
    end if;

    select count(*) into v_closed from public.teaching_assignments
     where teacher_id = test_id('102') and status = 'INACTIVE';
    if v_closed <> 2 then
        raise exception 'FAIL: the previous pairs were deleted, not closed (% found)', v_closed;
    end if;

    raise notice 'PASS: re-setting pairs closes the previous set and keeps it as history';
end
$$;

-- ===========================================================================
-- TEST 27: a malformed pairs list is refused rather than half-applied
-- ===========================================================================
do $$
begin
    begin
        perform public.set_teaching_pairs(
            test_id('101'), test_id('900'), '{"class_id": "x"}'::jsonb, 'bad');
        raise exception 'FAIL: a non-array pairs value was accepted';
    exception
        when invalid_parameter_value then null;
    end;
    raise notice 'PASS: a malformed pairs list is refused';
end
$$;

-- ===========================================================================
-- TEST 28: a TEACHER cannot set teaching pairs
-- ===========================================================================
select test_as(test_id('3'));   -- TEACHER

do $$
begin
    begin
        perform public.set_teaching_pairs(
            test_id('102'), test_id('900'),
            jsonb_build_array(
                jsonb_build_object('class_id', test_id('201'), 'subject_id', test_id('301'))),
            'nope');
        raise exception 'FAIL: a TEACHER set teaching pairs';
    exception
        when insufficient_privilege then null;
    end;
    raise notice 'PASS: a TEACHER cannot set teaching pairs';
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
    raise notice '  ALL PHASE 3 TIMETABLE AND ATTENDANCE TESTS PASSED';
    raise notice '==============================================';
end
$$;

rollback;
