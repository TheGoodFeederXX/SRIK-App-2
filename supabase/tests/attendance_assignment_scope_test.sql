-- AUDIT F08 — attendance may be recorded only by someone assigned to the class ON THAT DAY.
--
-- THE DEFECT, CONFIRMED ON PRODUCTION. `record_class_attendance` checked that a teacher had
-- SOME assignment for the class and nothing else — no status, no dates. A teacher whose
-- assignment had ENDED 300 days earlier recorded the register against production and the
-- database wrote it: `{"recorded": 1}`.
--
-- FOUR CHECKS. As with F09, the first is the one that matters: an authorisation fix that
-- refuses the legitimate teacher is an outage, not a fix.
--
-- NOTE ON SCOPE. Attendance has no `subject_id` — a register is taken for a CLASS on a day,
-- not per subject. So the class is the right scope here and only the DATE was missing. That
-- is why this suite checks dates and status, not subjects.

begin;

do $setup$
declare
    v_t uuid := gen_random_uuid();
    v_year uuid; v_class uuid; v_teacher uuid; v_subj uuid;
    v_child uuid := '33333333-4444-4555-8666-777777777771';
begin
    perform set_config('request.jwt.claims', '', true);

    select id into v_year from public.academic_years where status = 'CURRENT' limit 1;
    if v_year is null then
        raise exception 'F08a: no current academic year — the suite cannot run';
    end if;
    -- The suite OWNS its class. Borrowing whatever exists left it unable to run on a
    -- database with none for the current year — which reports as a FAIL against nothing.
    select id into v_class from public.classes where academic_year_id = v_year limit 1;
    if v_class is null then
        v_class := '55555555-6666-4777-8888-999999999991';
        insert into public.classes (id, academic_year_id, name, code, year_level, status)
        values (v_class, v_year, 'Kelas F08', 'F08', 4, 'ACTIVE');
    end if;
    select id into v_subj from public.subjects limit 1;
    if v_subj is null then
        insert into public.subjects (id, code, name)
        values ('44444444-5555-4666-8777-888888888881', 'F08', 'Subjek F08');
        v_subj := '44444444-5555-4666-8777-888888888881';
    end if;

    insert into auth.users (id, email, email_confirmed_at)
    values (v_t, 'guru.f08t@srialkhairiah.my', now()),
           (v_child, 'murid.f08t@srialkhairiah.my', now());
    update public.profiles set full_name = 'Guru F08', status = 'ACTIVE' where id = v_t;
    update public.profiles set full_name = 'Murid F08', status = 'ACTIVE' where id = v_child;

    insert into public.teachers (user_id, staff_code, full_name, gender, status)
    values (v_t, 'F08', 'Guru F08', 'MALE', 'ACTIVE') returning id into v_teacher;

    insert into public.user_roles (user_id, role_code) values (v_t, 'TEACHER') on conflict do nothing;

    insert into public.students (id, user_id, admission_no, full_name, gender, status, admission_date)
    values (v_child, v_child, 'F08-1', 'Murid F08', 'MALE', 'ACTIVE', current_date);
    insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, ended_at, status)
    values (v_child, v_class, v_year, current_date, null, 'ACTIVE');

    -- A CLOSED assignment: the most recent one ended long ago.
    insert into public.teaching_assignments
        (teacher_id, class_id, academic_year_id, subject_id, assignment_type,
         periods_per_week, effective_from, effective_to, status)
    values (v_teacher, v_class, v_year, v_subj, 'SUBJECT_TEACHER', 2,
            current_date - 500, current_date - 300, 'ACTIVE');

    perform set_config('srik.f08_t', v_t::text, false);
    perform set_config('srik.f08_c', v_class::text, false);
    perform set_config('srik.f08_child', v_child::text, false);
end;
$setup$;

-- F08a: an assignment that ENDED before the day being recorded must be refused.
do $c1$
declare v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f08_t')), true);
    begin
        perform public.record_class_attendance(
            current_setting('srik.f08_c')::uuid, current_date,
            jsonb_build_array(jsonb_build_object(
                'student_id', current_setting('srik.f08_child')::uuid, 'status', 'PRESENT')), null);
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F08a: a teacher whose assignment ended 300 days ago recorded the register';
    end if;
    if v_err !~ 'not assigned' then
        raise exception 'F08a: refused, but for the wrong reason: %', v_err;
    end if;
    raise notice 'PASS: [F08a] an ended assignment cannot record attendance';
end;
$c1$;

-- F08b: AND the assignment in force on that day is accepted. This is the half a careless fix
-- breaks — refuse everybody and the school cannot take a register at all.
do $c2$
declare v_refused boolean := false; v_err text; v_res jsonb;
begin
    perform set_config('request.jwt.claims', '', true);
    -- The same teacher, now genuinely in possession of the class.
    update public.teaching_assignments
       set effective_from = current_date - 10, effective_to = null
     where teacher_id = (select id from public.teachers
                          where user_id = current_setting('srik.f08_t')::uuid);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f08_t')), true);
    begin
        v_res := public.record_class_attendance(
            current_setting('srik.f08_c')::uuid, current_date,
            jsonb_build_array(jsonb_build_object(
                'student_id', current_setting('srik.f08_child')::uuid, 'status', 'PRESENT')), null);
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_refused then
        raise exception 'F08b: a teacher in possession of the class was refused: %', v_err;
    end if;
    if (v_res->>'recorded')::int < 1 then
        raise exception 'F08b: the register was accepted but nothing was written: %', v_res::text;
    end if;
    raise notice 'PASS: [F08b] an assignment in force records the register';
end;
$c2$;

-- F08c: an assignment that has not STARTED yet must not authorise the day either. The
-- original query ignored dates in both directions.
do $c3$
declare v_refused boolean := false;
begin
    perform set_config('request.jwt.claims', '', true);
    -- Starts next week, running into the future.
    update public.teaching_assignments
       set effective_from = current_date + 7, effective_to = null
     where teacher_id = (select id from public.teachers
                          where user_id = current_setting('srik.f08_t')::uuid);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f08_t')), true);
    begin
        perform public.record_class_attendance(
            current_setting('srik.f08_c')::uuid, current_date,
            jsonb_build_array(jsonb_build_object(
                'student_id', current_setting('srik.f08_child')::uuid, 'status', 'PRESENT')), null);
    exception when others then
        v_refused := true;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F08c: an assignment that has not started recorded the register';
    end if;
    raise notice 'PASS: [F08c] an assignment that has not begun cannot record attendance';
end;
$c3$;

-- F08d: a CLOSED assignment (status not ACTIVE) must not authorise the day, even if the dates
-- would allow it. The original query ignored status entirely.
do $c4$
declare v_refused boolean := false;
begin
    perform set_config('request.jwt.claims', '', true);
    update public.teaching_assignments
       set status = 'INACTIVE', effective_from = current_date - 10, effective_to = null
     where teacher_id = (select id from public.teachers
                          where user_id = current_setting('srik.f08_t')::uuid);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f08_t')), true);
    begin
        perform public.record_class_attendance(
            current_setting('srik.f08_c')::uuid, current_date,
            jsonb_build_array(jsonb_build_object(
                'student_id', current_setting('srik.f08_child')::uuid, 'status', 'PRESENT')), null);
    exception when others then
        v_refused := true;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F08d: a closed assignment recorded the register';
    end if;
    raise notice 'PASS: [F08d] a closed assignment cannot record attendance';
end;
$c4$;

rollback;
