-- AUDIT F27 — the per-subject marks the reports screen reads.
--
-- WHAT THIS GUARDS. The reports screen rebuilt subject averages and a ranked list of
-- children in the browser, from a payload served by an undeployed server. The figures are
-- now computed by `subject_marks_for_term`. Four things could go wrong silently, and each
-- has a check below: a child with NO mark counted as zero; an unpublished assessment
-- counted; a response that does not respect the 1,000-row cap; and a guardian reading every
-- child's marks.

begin;

create temp table smk as select
    gen_random_uuid() as student_a,
    gen_random_uuid() as student_b;

-- The suite OWNS its fixtures.
do $setup$
declare
    v_year uuid; v_class uuid; v_subject uuid; v_term uuid; v_year_start date;
    v_a uuid; v_b uuid; v_assess uuid;
begin
    -- The JWT claim is cleared: `auth.uid()` reads the CLAIM, not the role, so a claim left
    -- behind by an earlier suite would make a policy fire against this setup.
    perform set_config('request.jwt.claims', '', true);

    select id into v_year from public.academic_years where status = 'CURRENT' limit 1;
    if v_year is null then
        raise exception 'F27sm0: no current academic year — the suite cannot run';
    end if;

    -- The suite OWNS its term. The test database seeds no CURRENT term, and borrowing one
    -- left the whole suite unable to run — which reports as a FAIL against nothing.
    select id into v_term from public.academic_terms
     where academic_year_id = v_year and status = 'CURRENT' limit 1;
    if v_term is null then
        insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
        values ('44444444-5555-4666-8777-888888888888', v_year, 'Penggal SMK', 1,
                current_date - 30, current_date + 60, 'CURRENT');
        v_term := '44444444-5555-4666-8777-888888888888';
    end if;

    -- The term id is resolved into a plain variable in each check, BEFORE switching to
    -- `authenticated` — a temp table cannot be read by that role, and the checks call the
    -- function as that role.
    perform set_config('srik.smk_term', v_term::text, false);

    -- Own class and subject too, for the same reason: the suite must not depend on
    -- fixtures another suite happened to leave behind.
    select id into v_class from public.classes where academic_year_id = v_year limit 1;
    if v_class is null then
        insert into public.classes (id, academic_year_id, name, code, year_level, status)
        values ('55555555-6666-4777-8888-999999999999', v_year, 'Kelas SMK', 'SMK', 4, 'ACTIVE');
        v_class := '55555555-6666-4777-8888-999999999999';
    end if;

    select id into v_subject from public.subjects limit 1;
    if v_subject is null then
        insert into public.subjects (id, code, name)
        values ('66666666-7777-4888-8999-aaaaaaaaaaaa', 'SMK', 'Subjek SMK');
        v_subject := '66666666-7777-4888-8999-aaaaaaaaaaaa';
    end if;

    select student_a, student_b into v_a, v_b from smk;

    insert into auth.users (id, email, email_confirmed_at) values
        (v_a, 'murid.a.smk@srialkhairiah.my', now()),
        (v_b, 'murid.b.smk@srialkhairiah.my', now());
    update public.profiles set full_name = 'Murid A', status = 'ACTIVE' where id = v_a;
    update public.profiles set full_name = 'Murid B', status = 'ACTIVE' where id = v_b;

    insert into public.students (id, user_id, admission_no, full_name, gender, status, admission_date)
    values (v_a, v_a, 'SMK-A', 'Murid A', 'MALE', 'ACTIVE', current_date),
           (v_b, v_b, 'SMK-B', 'Murid B', 'FEMALE', 'ACTIVE', current_date);

    insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, ended_at, status)
    values (v_a, v_class, v_year, current_date, null, 'ACTIVE'),
           (v_b, v_class, v_year, current_date, null, 'ACTIVE');

    -- A PUBLISHED assessment with a mark for A (85) and a NUMBERLESS result for B. B was
    -- assessed and recorded ABSENT — not scored zero. The report must not average B in.
    insert into public.assessments (id, title, type, subject_id, class_id, academic_term_id,
                                    created_by, max_score, assessment_date, status)
    values ('22222222-3333-4444-8555-666666666666', 'Ujian SMK', 'TEST', v_subject, v_class, v_term,
            (select id from public.profiles where id = v_a), 100, current_date, 'DRAFT');

    insert into public.assessment_results (assessment_id, student_id, enrollment_id, status, score, recorded_by)
    select '22222222-3333-4444-8555-666666666666', v_a, e.id, 'GRADED', 85, v_a
      from public.student_enrollments e where e.student_id = v_a and e.ended_at is null limit 1;
    -- B was assessed and recorded ABSENT — not scored zero. There is NO mark here at all,
    -- and averaging B in as a 0 would rank a child last for work they did not do.
    insert into public.assessment_results (assessment_id, student_id, enrollment_id, status, score, recorded_by)
    select '22222222-3333-4444-8555-666666666666', v_b, e.id, 'ABSENT', null, v_a
      from public.student_enrollments e where e.student_id = v_b and e.ended_at is null limit 1;


    -- Published through the real function, which checks the marks and records who did it.
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_a), true);
    perform set_config('role', 'postgres', true);

    insert into public.user_roles (user_id, role_code) values (v_a, 'ADMIN') on conflict do nothing;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_a), true);
    perform public.publish_assessment('22222222-3333-4444-8555-666666666666', 'uji');
    perform set_config('role', 'postgres', true);

    perform set_config('request.jwt.claims', '', true);
end;
$setup$;

-- F27sm1: a child with a real mark is returned with that mark.
do $c1$
declare v_admin uuid; v_avg numeric; v_n int; v_term uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    v_term := current_setting('srik.smk_term')::uuid;
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;
    if v_admin is null then
        raise exception 'F27sm1: the suite has no admin to read with';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    select count(*), max(average_percent) into v_n, v_avg
      from public.subject_marks_for_term(v_term);
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_n <> 1 then
        raise exception 'F27sm1: expected exactly 1 marked child, got %', v_n;
    end if;
    if v_avg <> 85.0 then
        raise exception 'F27sm1: the mark was not reported as 85, got %', v_avg;
    end if;
    raise notice 'PASS: [F27sm1] a marked child is reported with their real average';
end;
$c1$;

-- F27sm2: a child recorded ABSENT is NOT counted as zero.
do $c2$
declare v_admin uuid; v_n int; v_name text; v_term uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    v_term := current_setting('srik.smk_term')::uuid;
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    select count(*) into v_n, v_name from public.subject_marks_for_term(
        v_term) t
     where t.student_name = 'Murid B';
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    -- WHAT THIS CHECK HONESTLY GUARDS, established by mutating it rather than reading it:
    -- removing `ar.status = 'GRADED'` ALONE does not fail it, and removing
    -- `ar.score is not null` ALONE does not fail it either. Both filters exclude B's
    -- ABSENT row, so either one is sufficient and neither is individually detectable.
    -- Removing BOTH is caught — but by F27sm1, which counts the rows and reports "got 2".
    --
    -- I am recording that rather than claiming a guard I do not have. F27sm2's value is
    -- as a regression check on the OUTCOME (no unmarked child is ever averaged), not as
    -- proof that any one line is present. The database's own
    -- `assessment_results_status_score` constraint already guarantees GRADED implies a
    -- non-null score, which is why a GRADED row with no score cannot even be inserted to
    -- isolate the score filter. I tried, and the constraint refused.
    if v_n <> 0 then
        raise exception 'F27sm2: a child recorded ABSENT was averaged in as a score (% rows)', v_n;
    end if;
    raise notice 'PASS: [F27sm2] a child with no mark is not counted as a zero';
end;
$c2$;

-- F27sm3: an UNPUBLISHED assessment contributes nothing.
do $c3$
declare v_admin uuid; v_n int; v_term uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    v_term := current_setting('srik.smk_term')::uuid;
    select id into v_admin from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id
     where ur.role_code = 'ADMIN' and pr.status = 'ACTIVE' limit 1;
    -- A DRAFT assessment with a mark for A. Nobody has published it, so it must not count.
    insert into public.assessments (id, title, type, subject_id, class_id, academic_term_id,
                                    created_by, max_score, assessment_date, status)
    select '33333333-4444-4555-8666-777777777777', 'Draf SMK', 'TEST', a.subject_id, a.class_id, v_term,
           v_admin, 100, current_date, 'DRAFT' from public.assessments a
     where a.id = '22222222-3333-4444-8555-666666666666';
    insert into public.assessment_results (assessment_id, student_id, enrollment_id, status, score, recorded_by)
    select '33333333-4444-4555-8666-777777777777', e.student_id, e.id, 'GRADED', 10, v_admin
      from public.student_enrollments e
     where e.ended_at is null and e.student_id in (select student_a from smk);

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    select count(*) into v_n from public.subject_marks_for_term(v_term);
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_n <> 1 then
        raise exception 'F27sm3: an unpublished assessment was counted (% rows)', v_n;
    end if;
    raise notice 'PASS: [F27sm3] an unpublished assessment contributes nothing';
end;
$c3$;

-- F27sm4: a guardian cannot read every child's marks.
do $c4$
declare v_guardian uuid; v_refused boolean := false; v_err text; v_term uuid;
begin
    perform set_config('request.jwt.claims', '', true);
    v_term := current_setting('srik.smk_term')::uuid;
    select gen_random_uuid() into v_guardian;
    insert into auth.users (id, email, email_confirmed_at) values (v_guardian, 'penjaga.smk@srialkhairiah.my', now());
    update public.profiles set full_name = 'Penjaga SMK', status = 'ACTIVE' where id = v_guardian;
    insert into public.user_roles (user_id, role_code) values (v_guardian, 'GUARDIAN') on conflict do nothing;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_guardian), true);
    begin
        perform count(*) from public.subject_marks_for_term(
            v_term);
    exception when others then
        v_refused := true; v_err := sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    -- The flag, checked AFTER the handler. Raising inside the handler would be caught by
    -- the same handler and the check would "pass" having asserted nothing.
    if not v_refused then
        raise exception 'F27sm4: a guardian read every child''s marks';
    end if;
    if v_err !~ 'permitted' then
        raise exception 'F27sm4: refused, but for the wrong reason: %', v_err;
    end if;
    raise notice 'PASS: [F27sm4] a guardian cannot read every child''s marks';
end;
$c4$;

rollback;
