-- AUDIT F09 — a teacher may enter marks only for the subject they teach.
--
-- THE DEFECT, CONFIRMED ON PRODUCTION. `save_assessment_marks` checked the CLASS and nothing
-- else. A teacher assigned Bahasa Melayu in a class could save marks for the Bahasa Inggeris
-- assessment in the same class — and did: the call returned `{"graded": 0, ...}` instead of
-- refusing. Those marks would flow into another subject's results and a published report
-- card a parent reads.
--
-- FIVE CHECKS. The second is the one that matters most, because an authorisation fix that
-- refuses everybody is not a fix — it is an outage.

begin;

-- One teacher, one class, two subjects. The teacher holds Bahasa Melayu ONLY, and the
-- assignment is in force.
do $setup$
declare
    v_t uuid := gen_random_uuid();
    v_year uuid; v_class uuid; v_term uuid; v_bm uuid; v_bi uuid; v_teacher uuid;
begin
    perform set_config('request.jwt.claims', '', true);

    select id into v_year from public.academic_years where status = 'CURRENT' limit 1;
    if v_year is null then
        raise exception 'F09a: no current academic year — the suite cannot run';
    end if;
    select id into v_term from public.academic_terms
     where academic_year_id = v_year and status = 'CURRENT' limit 1;
    if v_term is null then
        insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
        values ('77777777-8888-4999-8aaa-bbbbbbbbbbbb', v_year, 'Penggal F09', 1,
                current_date - 30, current_date + 60, 'CURRENT');
        v_term := '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
    end if;
    select id into v_class from public.classes where academic_year_id = v_year limit 1;
    if v_class is null then
        insert into public.classes (id, academic_year_id, name, code, year_level, status)
        values ('88888888-9999-4aaa-8bbb-cccccccccccc', v_year, 'Kelas F09', 'F09', 4, 'ACTIVE');
        v_class := '88888888-9999-4aaa-8bbb-cccccccccccc';
    end if;
    -- The suite OWNS its two subjects. Borrowing whatever is already there left it unable to
    -- run on a database with fewer than two — which reports as a FAIL against nothing.
    v_bm := 'dddddddd-1111-4222-8333-444444444441';
    v_bi := 'eeeeeeee-1111-4222-8333-444444444442';
    insert into public.subjects (id, code, name) values
        (v_bm, 'F09BM', 'Bahasa Melayu F09'),
        (v_bi, 'F09BI', 'Bahasa Inggeris F09')
    on conflict (id) do nothing;

    insert into auth.users (id, email, email_confirmed_at)
    values (v_t, 'guru.bm.f09@srialkhairiah.my', now());
    update public.profiles set full_name = 'Guru BM F09', status = 'ACTIVE' where id = v_t;
    insert into public.teachers (user_id, staff_code, full_name, gender, status)
    values (v_t, 'F09', 'Guru BM F09', 'MALE', 'ACTIVE')
    returning id into v_teacher;

    insert into public.user_roles (user_id, role_code) values (v_t, 'TEACHER') on conflict do nothing;

    -- Bahasa Melayu ONLY, in force today.
    insert into public.teaching_assignments
        (teacher_id, class_id, academic_year_id, subject_id, assignment_type,
         periods_per_week, effective_from, status)
    values (v_teacher, v_class, v_year, v_bm, 'SUBJECT_TEACHER', 2, current_date - 10, 'ACTIVE');

    -- A draft assessment for EACH subject, both in this same class.
    insert into public.assessments (id, title, type, subject_id, class_id, academic_term_id,
                                    created_by, max_score, assessment_date, status)
    values ('bbbbbbbb-1111-4222-8333-444444444444', 'Ujian BM F09', 'TEST', v_bm, v_class, v_term,
            v_t, 100, current_date, 'DRAFT'),
           ('cccccccc-1111-4222-8333-444444444445', 'Ujian BI F09', 'TEST', v_bi, v_class, v_term,
            v_t, 100, current_date, 'DRAFT');

    -- Session settings, not a temp table: `authenticated` cannot read a temp table, and the
    -- checks below run AS that role.
    perform set_config('srik.f09_t', v_t::text, false);
    perform set_config('srik.f09_bi', v_bi::text, false);
    perform set_config('srik.f09_bm', v_bm::text, false);
end;
$setup$;

-- F09a: the subject they DO teach is accepted. An authorisation fix that refuses everybody
-- is an outage, not a fix.
do $c1$
declare v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f09_t')), true);
    begin
        perform public.save_assessment_marks('bbbbbbbb-1111-4222-8333-444444444444', '[]'::jsonb, 'uji');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_refused then
        raise exception 'F09a: a teacher was refused marks for their OWN subject: %', v_err;
    end if;
    raise notice 'PASS: [F09a] a teacher may save marks for the subject they teach';
end;
$c1$;

-- F09b: THE DEFECT. Another subject in the SAME class must be refused.
do $c2$
declare v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f09_t')), true);
    begin
        perform public.save_assessment_marks('cccccccc-1111-4222-8333-444444444445', '[]'::jsonb, 'uji');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F09b: a Bahasa Melayu teacher saved Bahasa Inggeris marks in the same class';
    end if;
    if v_err !~ 'not assigned' then
        raise exception 'F09b: refused, but for the wrong reason: %', v_err;
    end if;
    raise notice 'PASS: [F09b] a teacher cannot mark another subject in the same class';
end;
$c2$;

-- F09c: an assignment that ENDED before the assessment must not authorise a mark.
do $c3$
declare v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    -- The BM assignment ended well before the assessment date.
    update public.teaching_assignments
       set effective_from = current_date - 400, effective_to = current_date - 200
     where teacher_id = (select id from public.teachers
                          where user_id = current_setting('srik.f09_t')::uuid);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f09_t')), true);
    begin
        perform public.save_assessment_marks('bbbbbbbb-1111-4222-8333-444444444444', '[]'::jsonb, 'uji');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if not v_refused then
        raise exception 'F09c: an expired assignment still authorised a mark';
    end if;
    raise notice 'PASS: [F09c] an expired assignment does not authorise a mark';
end;
$c3$;

-- F09d: a CLASS_TEACHER holds the whole class and has no single subject, so they are not
-- locked out by the subject match.
do $c4$
declare v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    update public.teaching_assignments
       set assignment_type = 'CLASS_TEACHER', subject_id = null, periods_per_week = null,
           effective_from = current_date - 10, effective_to = null
     where teacher_id = (select id from public.teachers
                          where user_id = current_setting('srik.f09_t')::uuid);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f09_t')), true);
    begin
        -- The OTHER subject — permitted for a class teacher, who holds the whole class.
        perform public.save_assessment_marks('cccccccc-1111-4222-8333-444444444445', '[]'::jsonb, 'uji');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_refused then
        raise exception 'F09d: a class teacher was refused a subject in their own class: %', v_err;
    end if;
    raise notice 'PASS: [F09d] a class teacher may mark any subject in their class';
end;
$c4$;

-- F09e: staff who hold assessments.create are unaffected — they are the head teacher, and
-- the audit asks for a deliberate grant rather than a narrower lock.
do $c5$
declare v_admin uuid; v_refused boolean := false; v_err text;
begin
    perform set_config('request.jwt.claims', '', true);
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;
    if v_admin is null then
        raise exception 'F09e: the suite has no admin';
    end if;
    perform set_config('srik.f09_admin', v_admin::text, false);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    begin
        perform public.save_assessment_marks('cccccccc-1111-4222-8333-444444444445', '[]'::jsonb, 'uji');
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_refused then
        raise exception 'F09e: the head teacher was refused: %', v_err;
    end if;
    raise notice 'PASS: [F09e] staff with assessments.create are not restricted by subject';
end;
$c5$;

rollback;
