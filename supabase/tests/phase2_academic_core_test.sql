-- =============================================================================
-- SRIK Phase 2 — academic core test suite
-- =============================================================================
-- Mirrors the Phase 1 suite's structure: every test runs inside one transaction
-- that is rolled back at the end, so the seed data survives and no fixtures
-- leak. Run it against a THROWAWAY database, never the remote project.
--
-- The point of these tests is not to prove that inserts work. It is to prove
-- that the rules a school depends on cannot be broken: that years cannot be
-- mixed, that a student cannot be in two classes at once, that Year 6 is not
-- silently promoted, and that a DISABLED user reads nothing.
--
-- Requires the local shim (auth.users + auth.uid()) and Phase 1 applied first.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- PL/pgSQL blocks cannot see psql variables, so test identity flows through
-- functions rather than \set. Same approach as the Phase 1 suite.
create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-a000-' || lpad(p_label, 12, '0'))::uuid;
$$;

-- Act as a given user for the rest of the transaction.
--
-- This must match how auth.uid() actually resolves an identity: it reads the
-- JSON `request.jwt.claims` blob, NOT the dot-separated `request.jwt.claim.sub`
-- setting. Setting the wrong one leaves auth.uid() NULL, every policy denies,
-- and tests fail in a way that looks like an RLS bug rather than a harness bug.
-- `set local role` (not `set_config('role', ...)`) is used so the role reverts
-- with the transaction, exactly as the Phase 1 suite does.
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
-- Fixtures: two administrators, two teachers, a disabled user
-- ---------------------------------------------------------------------------
-- Created as the object owner (reset role) because `authenticated` deliberately
-- holds no INSERT grant on auth tables — which is itself a rule under test.
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.a@srik.test', now()),
    (test_id('2'), 'admin.b@srik.test', now()),
    (test_id('3'), 'teacher.a@srik.test', now()),
    (test_id('4'), 'teacher.b@srik.test', now()),
    (test_id('5'), 'disabled@srik.test', now())
on conflict (id) do nothing;

-- PROFILES ARE CREATED BY THE PHASE 1 TRIGGER. Verify that rather than assume it.
do $$
begin
    if (select count(*) from public.profiles where id in (
            test_id('1'), test_id('2'), test_id('3'), test_id('4'), test_id('5'))) <> 5 then
        raise exception 'FAIL: the auth.users trigger did not create 5 profiles';
    end if;
    raise notice 'PASS: profiles are created by trigger for Phase 2 fixtures';
end
$$;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('2'), 'ADMIN'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'TEACHER')
on conflict do nothing;

update public.profiles set status = 'DISABLED', disabled_at = now()
 where id = test_id('5');

-- ===========================================================================
-- TEST 1: single school is a database guarantee, not a convention
-- ===========================================================================
reset role;
do $$
begin
    insert into public.school_profile (name, short_name, principal_name)
    values ('Sekolah Rendah Islam Al-Khairiah', 'SRIK', 'Ustaz Ahmad');

    -- A second row must be impossible. If this succeeds, "single school" is
    -- only a promise the application makes, and a stray insert could split the
    -- school's configuration in two.
    begin
        insert into public.school_profile (name, short_name) values ('Sekolah Lain', 'SL');
        raise exception 'FAIL: a second school_profile row was accepted';
    exception
        when unique_violation then null;
        when check_violation then null;
    end;

    raise notice 'PASS: only one school profile row can exist';
end
$$;

-- ===========================================================================
-- TEST 2: permissions gate reads (deny by default)
-- ===========================================================================
-- Fixtures, inserted as owner: an academic year, three classes, a subject.
reset role;
insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('101'), '2026', '2026-01-01', '2026-12-31', 'CURRENT');

insert into public.classes (id, academic_year_id, year_level, name)
values (test_id('201'), test_id('101'), 3, 'Al-Junaidi'),
       (test_id('202'), test_id('101'), 3, 'Al-Farabi'),
       (test_id('203'), test_id('101'), 6, 'Al-Khwarizmi');

insert into public.subjects (id, code, name, short_name)
values (test_id('301'), 'BM', 'Bahasa Melayu', 'BM');

select test_as(test_id('3'));   -- TEACHER

do $$
declare
    n integer;
begin
    -- A TEACHER holds students.view, so the list is readable.
    select count(*) into n from public.students;
    if n <> 0 then
        raise exception 'FAIL: expected an empty student list, found %', n;
    end if;
    if not public.has_permission('students.view') then
        raise exception 'FAIL: TEACHER lost students.view';
    end if;

    -- But NOT the write grants. This is the important half: a teacher must not
    -- be able to add or archive a student.
    if public.has_permission('students.create') then
        raise exception 'FAIL: TEACHER has students.create';
    end if;
    if public.has_permission('students.archive') then
        raise exception 'FAIL: TEACHER has students.archive';
    end if;

    raise notice 'PASS: TEACHER reads the academic structure but cannot write student records';
end
$$;

-- ===========================================================================
-- TEST 3: a teacher cannot insert a student
-- ===========================================================================
select test_as(test_id('3'));

do $$
begin
    begin
        insert into public.students (admission_no, full_name)
        values ('S-001', 'Murid Cuba');
        raise exception 'FAIL: TEACHER inserted a student';
    exception
        when insufficient_privilege then null;
    end;
    raise notice 'PASS: TEACHER cannot insert a student record';
end
$$;

-- ===========================================================================
-- TEST 4: an administrator can, and the codes are case-insensitive unique
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
begin
    insert into public.students (id, admission_no, full_name, gender, birth_date)
    values (test_id('401'), 'S-001', 'Ahmad Zaki', 'MALE', '2017-05-01');

    -- "s-001" must collide with "S-001": the same admission number typed in a
    -- different case is still the same number, and allowing both would create a
    -- duplicate student record for one child.
    begin
        insert into public.students (admission_no, full_name) values ('s-001', 'Pendua');
        raise exception 'FAIL: admission numbers are case-sensitively unique';
    exception
        when unique_violation then null;
    end;

    raise notice 'PASS: ADMIN inserts a student and admission numbers are case-insensitively unique';
end
$$;

-- ===========================================================================
-- TEST 5: a student cannot be enrolled in two classes at once
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    first_enrollment uuid;
begin
    select (public.enroll_student(test_id('401'), test_id('201'))).id into first_enrollment;

    -- Enrolling again in the SAME year must close the old row, not create a
    -- second open one. If both stayed open, "the student's class" would depend
    -- on row order and could differ between two screens.
    perform public.enroll_student(test_id('401'), test_id('202'));

    if (select count(*) from public.student_enrollments
         where student_id = test_id('401') and ended_at is null) <> 1 then
        raise exception 'FAIL: a student has more than one open enrollment in one year';
    end if;

    -- The history must survive the change.
    if (select count(*) from public.student_enrollments
         where student_id = test_id('401')) <> 2 then
        raise exception 'FAIL: changing class destroyed the previous enrollment';
    end if;

    -- And the student must now be in the SECOND class.
    if (select class_id from public.student_enrollments
         where student_id = test_id('401') and ended_at is null) <> test_id('202') then
        raise exception 'FAIL: the open enrollment is not the new class';
    end if;

    raise notice 'PASS: changing class closes the old enrollment and keeps the history';
end
$$;

-- ===========================================================================
-- TEST 6: the one-open-enrollment rule holds even against a direct SQL write
-- ===========================================================================
reset role;

do $$
begin
    -- RLS cannot express this rule and a plain policy would not stop it, so the
    -- guarantee comes from the partial unique index. Prove it bites.
    begin
        insert into public.student_enrollments (student_id, class_id, academic_year_id)
        values (test_id('401'), test_id('201'), test_id('101'));
        raise exception 'FAIL: a second open enrollment was accepted';
    exception
        when unique_violation then null;
    end;
    raise notice 'PASS: the database itself refuses a second open enrollment';
end
$$;

-- ===========================================================================
-- TEST 7: a class from another academic year cannot be used
-- ===========================================================================
reset role;

do $$
begin
    insert into public.academic_years (id, name, start_date, end_date, status)
    values (test_id('102'), '2027', '2027-01-01', '2027-12-31', 'PLANNED');

    insert into public.classes (id, academic_year_id, year_level, name)
    values (test_id('204'), test_id('102'), 4, 'Al-Razi');

    -- A student with no open enrollment, so the ONLY rule that can reject this
    -- is the year mismatch. Student 401 already has an open 2026 enrollment, and
    -- using them here would trip the one-open-enrollment index instead and
    -- prove nothing about the composite foreign key.
    insert into public.students (id, admission_no, full_name)
    values (test_id('499'), 'S-499', 'Murid Ujian Tahun');

    -- The class belongs to 2027 but the enrollment claims 2026. The composite
    -- foreign key must reject this; without it the enrollment would silently
    -- place a student in next year's class.
    begin
        insert into public.student_enrollments (student_id, class_id, academic_year_id)
        values (test_id('499'), test_id('204'), test_id('101'));
        raise exception 'FAIL: a class from another academic year was accepted';
    exception
        when foreign_key_violation then null;
    end;

    raise notice 'PASS: a class cannot be enrolled under a different academic year';
end
$$;

-- ===========================================================================
-- TEST 8: only one CURRENT academic year
-- ===========================================================================
reset role;

do $$
begin
    begin
        update public.academic_years set status = 'CURRENT' where id = test_id('102');
        raise exception 'FAIL: a second CURRENT academic year was accepted';
    exception
        when unique_violation then null;
    end;
    raise notice 'PASS: at most one academic year can be CURRENT';
end
$$;

-- ===========================================================================
-- TEST 9: subject codes are global and unique
-- ===========================================================================
reset role;

do $$
begin
    begin
        insert into public.subjects (code, name) values ('bm', 'Bahasa Melayu Pendua');
        raise exception 'FAIL: subjects are not globally unique';
    exception
        when unique_violation then null;
    end;
    raise notice 'PASS: subject codes are globally unique (not duplicated per year)';
end
$$;

-- ===========================================================================
-- TEST 10: teaching assignment shape is enforced
-- ===========================================================================
reset role;

do $$
declare
    v_teacher uuid;
begin
    insert into public.teachers (id, staff_code, full_name, gender)
    values (test_id('501'), 'TCH001', 'Ustazah Aminah', 'FEMALE');
    v_teacher := test_id('501');

    -- A CLASS_TEACHER must NOT carry a subject.
    begin
        insert into public.teaching_assignments
            (teacher_id, class_id, academic_year_id, subject_id, assignment_type)
        values (v_teacher, test_id('201'), test_id('101'), test_id('301'), 'CLASS_TEACHER');
        raise exception 'FAIL: a CLASS_TEACHER with a subject was accepted';
    exception
        when check_violation then null;
    end;

    -- A SUBJECT_TEACHER must carry one, plus a positive period count.
    begin
        insert into public.teaching_assignments
            (teacher_id, class_id, academic_year_id, assignment_type)
        values (v_teacher, test_id('201'), test_id('101'), 'SUBJECT_TEACHER');
        raise exception 'FAIL: a SUBJECT_TEACHER without a subject was accepted';
    exception
        when check_violation then null;
    end;

    begin
        insert into public.teaching_assignments
            (teacher_id, class_id, academic_year_id, subject_id, assignment_type, periods_per_week)
        values (v_teacher, test_id('201'), test_id('101'), test_id('301'), 'SUBJECT_TEACHER', 0);
        raise exception 'FAIL: a SUBJECT_TEACHER with zero periods was accepted';
    exception
        when check_violation then null;
    end;

    -- The valid shape must work.
    insert into public.teaching_assignments
        (id, teacher_id, class_id, academic_year_id, assignment_type)
    values (test_id('601'), v_teacher, test_id('201'), test_id('101'), 'CLASS_TEACHER');

    raise notice 'PASS: teaching assignment shapes are enforced (class vs subject teacher)';
end
$$;

-- ===========================================================================
-- TEST 11: Year 6 is NOT promoted automatically
-- ===========================================================================
select test_as(test_id('1'));

do $$
begin
    -- Put a Year 6 student in the Year 6 class.
    insert into public.students (id, admission_no, full_name) 
    values (test_id('402'), 'S-002', 'Murid Enam');
    perform public.enroll_student(test_id('402'), test_id('203'));

    -- Promoting out of Year 6 must be REFUSED rather than guessed. What happens
    -- after Year 6 is a school decision (graduate? transfer?), and inventing an
    -- answer here would silently mislabel those students.
    begin
        perform public.promote_students(test_id('203'), test_id('204'));
        raise exception 'FAIL: Year 6 students were promoted automatically';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: Year 6 is refused automatic promotion (no invented outcome)';
end
$$;

-- ===========================================================================
-- TEST 12: promotion moves students and keeps history
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    moved integer;
begin
    -- Promote exactly one named student, rather than the whole class. Other
    -- students from earlier tests still sit in class 201, and promoting all of
    -- them would make the count assertion below depend on test order — a test
    -- that breaks when its neighbours change is worse than no test.
    insert into public.students (id, admission_no, full_name)
    values (test_id('403'), 'S-003', 'Murid Tiga');
    perform public.enroll_student(test_id('403'), test_id('201'));

    moved := public.promote_students(test_id('201'), test_id('204'), array[test_id('403')]);

    if moved <> 1 then
        raise exception 'FAIL: expected 1 student promoted, got %', moved;
    end if;

    -- The student now has one OPEN enrollment per academic year, which is the
    -- intended shape: the 2026 row stays open (that year is still running) and a
    -- 2027 row is opened. The uniqueness rule is per year, so this is correct
    -- and the query must therefore be scoped to the target year.
    if (select se.class_id from public.student_enrollments se
         where se.student_id = test_id('403')
           and se.academic_year_id = test_id('102')
           and se.ended_at is null) <> test_id('204') then
        raise exception 'FAIL: the promoted student is not in the target class';
    end if;

    -- The previous year's enrollment must be untouched by promotion: a student
    -- is still a member of their old class until that year closes.
    if (select se.class_id from public.student_enrollments se
         where se.student_id = test_id('403')
           and se.academic_year_id = test_id('101')
           and se.ended_at is null) <> test_id('201') then
        raise exception 'FAIL: promotion disturbed the previous year''s enrollment';
    end if;

    raise notice 'PASS: promotion moves students forward and preserves history';
end
$$;

-- ===========================================================================
-- TEST 13: a DISABLED user reads nothing
-- ===========================================================================
select test_as(test_id('5'));   -- DISABLED

do $$
begin
    if public.is_active_user() then
        raise exception 'FAIL: is_active_user() is true for a DISABLED profile';
    end if;
    if exists (select 1 from public.students) then
        raise exception 'FAIL: DISABLED user can read students';
    end if;
    if exists (select 1 from public.classes) then
        raise exception 'FAIL: DISABLED user can read classes';
    end if;
    if exists (select 1 from public.school_profile) then
        raise exception 'FAIL: DISABLED user can read the school profile';
    end if;
    raise notice 'PASS: a DISABLED user reads no Phase 2 data even with a valid token';
end
$$;

-- ===========================================================================
-- TEST 14: enrollments and assignments cannot be written directly
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN, the most privileged user

do $$
begin
    -- An ADMIN still has no write grant on these tables: class changes must go
    -- through the audited RPC so the old row is always closed. Allowing a
    -- direct write would let a screen create a second open enrollment.
    begin
        insert into public.student_enrollments (student_id, class_id, academic_year_id)
        values (test_id('401'), test_id('201'), test_id('101'));
        raise exception 'FAIL: ADMIN wrote an enrollment directly, bypassing the RPC';
    exception
        when insufficient_privilege then null;
    end;

    begin
        update public.student_enrollments set ended_at = now() where student_id = test_id('401');
        raise exception 'FAIL: ADMIN updated an enrollment directly';
    exception
        when insufficient_privilege then null;
    end;

    raise notice 'PASS: enrollments are writable only through the audited RPC';
end
$$;

-- ===========================================================================
-- TEST 15: class changes are audited
-- ===========================================================================
select test_as(test_id('2'));   -- ADMIN B, who holds audit.view

do $$
declare
    n integer;
begin
    select count(*) into n
      from public.authorization_audit
     where action in ('STUDENT_ENROLLED', 'STUDENTS_PROMOTED')
       and created_at > now() - interval '1 hour';
    if n < 2 then
        raise exception 'FAIL: expected enrollment/promotion audit rows, found %', n;
    end if;
    raise notice 'PASS: enrollment and promotion are audited';
end
$$;

-- ===========================================================================
-- TEST 16: anon reaches nothing in Phase 2
-- ===========================================================================
reset role;

do $$
declare
    t text;
    n integer;
begin
    foreach t in array array[
        'school_profile', 'teachers', 'students', 'guardians', 'student_guardians',
        'academic_years', 'academic_terms', 'classes', 'subjects',
        'student_enrollments', 'class_subjects', 'teaching_assignments'
    ] loop
        if has_table_privilege('anon', 'public.' || t, 'SELECT') then
            raise exception 'FAIL: anon has SELECT on %', t;
        end if;
    end loop;

    if has_function_privilege('anon', 'public.enroll_student(uuid,uuid,text)', 'EXECUTE') then
        raise exception 'FAIL: anon can execute enroll_student';
    end if;
    if has_function_privilege('anon', 'public.promote_students(uuid,uuid,uuid[],text)', 'EXECUTE') then
        raise exception 'FAIL: anon can execute promote_students';
    end if;
    if has_function_privilege('anon', 'public.close_academic_year(uuid,text)', 'EXECUTE') then
        raise exception 'FAIL: anon can execute close_academic_year';
    end if;

    raise notice 'PASS: anon has no access to any Phase 2 table or function';
end
$$;

-- ===========================================================================
-- TEST 17: guardians are not auto-merged
-- ===========================================================================
reset role;

do $$
declare
    a uuid; b uuid;
begin
    -- Two different people who happen to share a name and a phone number. They
    -- MUST be allowed to exist as separate records: merging them would join two
    -- families' histories, and no constraint can tell them apart.
    insert into public.guardians (id, full_name, phone) values
        (test_id('701'), 'Ahmad bin Ali', '0123456789'),
        (test_id('702'), 'Ahmad bin Ali', '0123456789');
    a := test_id('701'); b := test_id('702');
    if a = b then
        raise exception 'FAIL: guardian ids collided';
    end if;

    if (select count(*) from public.guardians where full_name = 'Ahmad bin Ali') <> 2 then
        raise exception 'FAIL: duplicate guardians were merged or rejected';
    end if;

    raise notice 'PASS: guardians sharing a name and phone stay separate records';
end
$$;

-- ===========================================================================
-- TEST 18: at most one primary guardian per student
-- ===========================================================================
reset role;

do $$
begin
    insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
    values (test_id('401'), test_id('701'), 'Bapa', true);

    -- A second primary contact would make "who do we call first" ambiguous.
    begin
        insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
        values (test_id('401'), test_id('702'), 'Ibu', true);
        raise exception 'FAIL: a second primary guardian was accepted';
    exception
        when unique_violation then null;
    end;

    -- A non-primary second guardian is fine.
    insert into public.student_guardians (student_id, guardian_id, relationship, is_emergency_contact)
    values (test_id('401'), test_id('702'), 'Ibu', true);

    raise notice 'PASS: at most one primary guardian per student, others allowed';
end
$$;

-- ===========================================================================
-- TEST 19: class display name follows the required format
-- ===========================================================================
reset role;

do $$
declare
    display text;
begin
    select display_name into display from public.classes where id = test_id('201');
    if display <> '3 Al-Junaidi' then
        raise exception 'FAIL: class display name is "%" (expected "3 Al-Junaidi")', display;
    end if;
    raise notice 'PASS: class display name is "3 Al-Junaidi"';
end
$$;

-- ===========================================================================
-- TEST 20: year level is limited to 1..6
-- ===========================================================================
reset role;

do $$
begin
    begin
        insert into public.classes (academic_year_id, year_level, name)
        values (test_id('101'), 7, 'Tidak Sah');
        raise exception 'FAIL: a Year 7 class was accepted (SRIK is primary only)';
    exception
        when check_violation then null;
    end;
    raise notice 'PASS: year level is constrained to 1..6';
end
$$;

-- ===========================================================================
-- TEST 21: teaching duties are set through the RPC, and closed not deleted
-- ===========================================================================
-- Clear anything earlier tests left behind so the counts below do not depend on
-- what ran before. Done as the owner: `authenticated` deliberately holds no
-- DELETE grant on this table.
reset role;
delete from public.teaching_assignments where teacher_id = test_id('501');

select test_as(test_id('1'));   -- ADMIN

do $$
declare
    created integer;
    open_now integer;
    closed integer;
begin

    -- A teacher with a class and a subject.
    perform public.set_teacher_assignments(
        test_id('501'),
        test_id('101'),
        array[test_id('201')],
        array[test_id('301')]
    );

    -- One CLASS_TEACHER plus one SUBJECT_TEACHER.
    select count(*) into open_now from public.teaching_assignments
     where teacher_id = test_id('501') and status = 'ACTIVE';
    if open_now <> 2 then
        raise exception 'FAIL: expected 2 active assignments, found %', open_now;
    end if;

    -- Setting duties AGAIN must close the old ones, not stack a second set on
    -- top. Two live sets would make "who teaches this class" ambiguous.
    created := public.set_teacher_assignments(
        test_id('501'),
        test_id('101'),
        array[test_id('202')],
        array[test_id('301')]
    );

    if created <> 2 then
        raise exception 'FAIL: expected 2 new assignments, got %', created;
    end if;

    select count(*) into open_now from public.teaching_assignments
     where teacher_id = test_id('501') and status = 'ACTIVE';
    if open_now <> 2 then
        raise exception 'FAIL: re-setting duties left % active assignments', open_now;
    end if;

    -- The previous set must still exist as history.
    select count(*) into closed from public.teaching_assignments
     where teacher_id = test_id('501') and status = 'INACTIVE';
    if closed <> 2 then
        raise exception 'FAIL: the previous assignments were deleted, not closed (% found)', closed;
    end if;

    -- A class from another academic year must be refused.
    begin
        perform public.set_teacher_assignments(
            test_id('501'), test_id('101'), array[test_id('204')], '{}'::uuid[]);
        raise exception 'FAIL: a class from another year was accepted';
    exception
        when check_violation then null;
    end;

    raise notice 'PASS: duties are replaced atomically and the previous set is kept as history';
end
$$;

-- ===========================================================================
-- TEST 22: a TEACHER cannot change teaching duties
-- ===========================================================================
select test_as(test_id('3'));   -- TEACHER

do $$
begin
    begin
        perform public.set_teacher_assignments(
            test_id('501'), test_id('101'), array[test_id('201')], '{}'::uuid[]);
        raise exception 'FAIL: a TEACHER changed teaching duties';
    exception
        when insufficient_privilege then null;
    end;
    raise notice 'PASS: a TEACHER cannot change teaching duties';
end
$$;

-- ===========================================================================
-- Summary
-- ===========================================================================
do $$
begin
    raise notice '';
    raise notice '==============================================';
    raise notice '  ALL PHASE 2 ACADEMIC CORE TESTS PASSED';
    raise notice '==============================================';
end
$$;

rollback;
