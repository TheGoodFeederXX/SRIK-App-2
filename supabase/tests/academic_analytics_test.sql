-- AUDIT F27 — academic analytics computed by the database.
--
-- The screen previously read every figure from an undeployed server. It now calls the
-- database, which counts where the rows are: a pass rate built from a partial download is
-- wrong in a way nobody can see (audit F28), and the grade scale must be the same one the
-- report card uses.

\set ON_ERROR_STOP on

begin;

-- Fixtures this suite owns. The test database has no classes or subjects, and borrowing
-- another suite's rows breaks as soon as they change theirs.
create temp table ax as
select
    gen_random_uuid() as class_id,
    gen_random_uuid() as subject_id,
    coalesce(
        (select ay.id from public.academic_years ay where ay.status = 'CURRENT' limit 1),
        gen_random_uuid()
    ) as year_id,
    gen_random_uuid() as term_marks,
    gen_random_uuid() as term_empty;

insert into public.academic_years (id, name, start_date, end_date, status)
select year_id, 'Tahun Analitik', '2026-01-01', '2026-12-31', 'CURRENT' from ax
where not exists (select 1 from public.academic_years ay where ay.status = 'CURRENT');

insert into public.classes (id, name, code, year_level, academic_year_id)
select class_id, 'Kelas Analitik', concat('AX', substr(class_id::text, 1, 6)), 1, year_id from ax
on conflict (id) do nothing;

insert into public.subjects (id, code, name, status)
select subject_id, concat('AXS', substr(subject_id::text, 1, 6)), 'Subjek Analitik', 'ACTIVE' from ax
on conflict (id) do nothing;

do $setup$
declare
    v_class uuid; v_subject uuid; v_year uuid; v_term uuid; v_empty uuid;
    v_student uuid; v_assessment uuid; v_admin uuid;
begin
    select class_id, subject_id, year_id, term_marks, term_empty
      into v_class, v_subject, v_year, v_term, v_empty from ax;

    insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
    select v_term, v_year, 'Penggal Analitik', 94, '2026-01-01', '2026-06-30', 'PLANNED'
    where v_year is not null and not exists (select 1 from public.academic_terms where id = v_term);
    insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
    select v_empty, v_year, 'Penggal Kosong', 95, '2026-07-01', '2026-12-31', 'PLANNED'
    where v_year is not null and not exists (select 1 from public.academic_terms where id = v_empty);

    insert into public.students (admission_no, full_name, gender, status, admission_date)
    values (concat('AX', substr(v_term::text, 1, 6)), 'Anak Analitik', 'MALE', 'ACTIVE', current_date)
    returning id into v_student;

    -- Enrolled directly, as the other suites do: this runs as the owner, and the point
    -- here is the analytics, not the enrolment path.
    insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, ended_at, status)
    values (v_student, v_class, v_year, current_date, null, 'ACTIVE');

    insert into public.assessments (title, type, subject_id, class_id, academic_term_id, max_score, weight)
    values (concat('Analitik ', substr(v_term::text, 1, 6)), 'TEST', v_subject, v_class, v_term, 100, 1)
    returning id into v_assessment;

    -- Marking and publishing are permission-checked, so the admin has to BE the session.
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    perform public.save_assessment_marks(v_assessment, jsonb_build_array(
        jsonb_build_object('student_id', v_student, 'status', 'GRADED', 'score', 90)), 'analitik');
    perform public.publish_assessment(v_assessment, 'analitik');

    perform set_config('role', 'postgres', true);
end;
$setup$;

-- F27ax1: the figures are real. A 90% mark lands in grade A and the average is 90.
do $c1$
declare v_admin uuid; v_term uuid; v_res jsonb;
begin
    select term_marks into v_term from ax;
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    v_res := public.academic_analytics(v_term, null);

    if (v_res->'metrics'->>'overallAverage')::numeric <> 90 then
        raise exception 'F27ax1: expected an average of 90, got %', v_res->'metrics'->>'overallAverage';
    end if;
    if v_res->'metrics'->>'topPerformer' <> 'Anak Analitik' then
        raise exception 'F27ax1: the top performer is wrong: %', v_res->'metrics'->>'topPerformer';
    end if;
    -- 90% is an A on the school's own scale, so the distribution must say A.
    if not exists (select 1 from jsonb_array_elements(v_res->'gradeDistribution') g
                    where g->>'grade' = 'A' and (g->>'count')::int = 1) then
        raise exception 'F27ax1: a 90%% mark was not graded A: %', v_res->'gradeDistribution';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27ax1] the figures are real — 90%% is an A, average 90';
end;
$c1$;

-- F27ax2: an EMPTY term has NO pass rate. 0% would tell the school every child failed.
do $c2$
declare v_admin uuid; v_term uuid; v_res jsonb;
begin
    select term_empty into v_term from ax;
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    v_res := public.academic_analytics(v_term, null);

    if (v_res->'metrics'->>'passRate') is not null then
        raise exception 'F27ax2: an unmarked term reported a pass rate of %', v_res->'metrics'->>'passRate';
    end if;
    if (v_res->'metrics'->>'marksCounted')::int <> 0 then
        raise exception 'F27ax2: an unmarked term counted % marks', v_res->'metrics'->>'marksCounted';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27ax2] an unmarked term has no pass rate, not a pass rate of zero';
end;
$c2$;

-- F27ax3: a DRAFT assessment's marks are excluded. The school decides when marks count.
do $c3$
declare v_admin uuid; v_term uuid; v_res jsonb; v_class uuid; v_subject uuid; v_student uuid;
begin
    select term_marks, class_id, subject_id into v_term, v_class, v_subject from ax;
    select id into v_student from public.students where full_name = 'Anak Analitik' limit 1;
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    -- A second assessment, left as a draft, with a mark of 10. Markers are
    -- permission-checked, so the session has to be the admin again.
    declare v_draft uuid;
    begin
        perform set_config('role', 'postgres', true);
        insert into public.assessments (title, type, subject_id, class_id, academic_term_id, max_score, weight)
        values (concat('Draf ', substr(v_term::text, 1, 6)), 'TEST', v_subject, v_class, v_term, 100, 1)
        returning id into v_draft;

        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
        perform public.save_assessment_marks(v_draft, jsonb_build_array(
            jsonb_build_object('student_id', v_student, 'status', 'GRADED', 'score', 10)), 'draf');
        perform set_config('role', 'postgres', true);
    end;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    v_res := public.academic_analytics(v_term, null);

    if (v_res->'metrics'->>'marksCounted')::int <> 1 then
        raise exception 'F27ax3: a draft mark was counted (% marks)', v_res->'metrics'->>'marksCounted';
    end if;
    if (v_res->'metrics'->>'overallAverage')::numeric <> 90 then
        raise exception 'F27ax3: a draft mark changed the average to %', v_res->'metrics'->>'overallAverage';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27ax3] a draft assessment''s marks are not counted';
end;
$c3$;

-- F27ax35: a child whose mark is NOT_ENTERED is not counted as scoring zero.
-- This is the failure that produces a plausible-but-wrong number: an unmarked child
-- dragged into the average pulls it down, and nothing on screen looks broken.
do $c35$
declare v_admin uuid; v_term uuid; v_res jsonb; v_class uuid; v_subject uuid; v_student uuid;
begin
    select term_marks, class_id, subject_id into v_term, v_class, v_subject from ax;
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

    declare v_second uuid; v_assessment uuid;
    begin
        perform set_config('role', 'postgres', true);
        insert into public.students (admission_no, full_name, gender, status, admission_date)
        values (concat('AY', substr(v_term::text, 1, 6)), 'Anak Belum Tanda', 'MALE', 'ACTIVE', current_date)
        returning id into v_second;
        insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, ended_at, status)
        select v_second, v_class, ay.id, current_date, null, 'ACTIVE'
          from public.academic_years ay where ay.status = 'CURRENT' limit 1;

        insert into public.assessments (title, type, subject_id, class_id, academic_term_id, max_score, weight)
        values (concat('Belum Tanda ', substr(v_term::text, 1, 6)), 'TEST', v_subject, v_class, v_term, 100, 1)
        returning id into v_assessment;

        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
        -- A recorded outcome that carries NO score. EXEMPT is a real decision the office
        -- makes; the child is in the class and has no mark, which is the case that must
        -- not be read as a zero. (NOT_ENTERED cannot be published — the database refuses
        -- to publish an assessment while marks are still missing, which is correct.)
        -- BOTH children need a recorded outcome: the publish step refuses while any
        -- enrolled child is still NOT_ENTERED, which is a rule worth keeping.
        perform public.save_assessment_marks(v_assessment, jsonb_build_array(
            jsonb_build_object('student_id', v_second, 'status', 'EXEMPT'),
            jsonb_build_object('student_id',
                (select id from public.students where full_name = 'Anak Analitik' limit 1),
                'status', 'EXEMPT')), 'belum tanda');
        perform public.publish_assessment(v_assessment, 'belum tanda');
        perform set_config('role', 'postgres', true);
    end;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);
    v_res := public.academic_analytics(v_term, null);
    perform set_config('role', 'postgres', true);

    -- The average must still be 90, not dragged toward zero by the unmarked child.
    if (v_res->'metrics'->>'overallAverage')::numeric <> 90 then
        raise exception 'F27ax35: an exempt child pulled the average to %',
            v_res->'metrics'->>'overallAverage';
    end if;
    if (v_res->'metrics'->>'marksCounted')::int <> 1 then
        raise exception 'F27ax35: a child with no score was counted as a mark (% counted)',
            v_res->'metrics'->>'marksCounted';
    end if;
    -- And no zero appears anywhere in the distribution. Counting a no-score child as 0
    -- creates an E that did not happen.
    if exists (select 1 from jsonb_array_elements(v_res->'gradeDistribution') g
                where g->>'grade' = 'E') then
        raise exception 'F27ax35: a child with no score created an E grade: %',
            v_res->'gradeDistribution';
    end if;
    if (select sum((g->>'count')::int) from jsonb_array_elements(v_res->'gradeDistribution') g) <> 1 then
        raise exception 'F27ax35: the distribution counts more marks than exist: %',
            v_res->'gradeDistribution';
    end if;

    raise notice 'PASS: [F27ax35] a child with no score is not counted as zero';
end;
$c35$;

-- F27ax4: a guardian cannot read school-wide analytics.
do $c4$
declare v_user uuid := gen_random_uuid(); v_term uuid;
begin
    select term_marks into v_term from ax;
    insert into auth.users (id, email, email_confirmed_at) values (v_user, 'ax.penjaga@srialkhairiah.my', now());
    update public.profiles set full_name = 'Penjaga Analitik', status = 'ACTIVE' where id = v_user;
    insert into public.user_roles (user_id, role_code) values (v_user, 'GUARDIAN');

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    begin
        perform public.academic_analytics(v_term, null);
        perform set_config('role', 'postgres', true);
        raise exception 'F27ax4: a guardian read school-wide analytics';
    exception when insufficient_privilege then
        perform set_config('role', 'postgres', true);
    end;

    raise notice 'PASS: [F27ax4] a guardian cannot read school-wide analytics';
end;
$c4$;

rollback;
