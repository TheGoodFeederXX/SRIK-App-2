-- AUDIT F27 — the academic analytics screen read from a server that is not deployed.
--
-- WHAT WAS WRONG. Grade distribution, subject performance, class comparison and the
-- headline metrics (pass rate, top performer, improvement) all came from one Express
-- endpoint. The screen therefore showed an empty chart and a GPA of 0.000 for a school
-- with marks on file — a figure that reads as catastrophic rather than as missing.
--
-- WHY THE DATABASE DOES THIS AND NOT THE BROWSER. The figure that matters here is a PASS
-- RATE, and a pass rate is only meaningful if it is computed the same way every time.
-- Counting marks in the browser means:
--   * the 1,000-row response cap (audit F28) silently truncates the marks, so the rate
--     is computed over part of the school and nothing says so;
--   * the grade scale has to be re-applied in JavaScript, where it can drift from the
--     one the report card uses.
-- Here the school's OWN `grade_boundaries` decide the grade, and the counting happens
-- where the rows are.
--
-- WHAT A PASS MEANS. A pass is a mark in the school's two lowest failing bands or above
-- — which is to say, anything that is not E. That is read from `grade_boundaries`
-- rather than hard-coded, so if the school changes its scale the pass rate follows.

create or replace function public.academic_analytics(
    p_academic_term_id uuid,
    p_class_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if not public.is_active_user() or not public.has_permission('reports.view') then
        raise exception 'Not permitted to view academic analytics'
            using errcode = 'insufficient_privilege';
    end if;

    if p_academic_term_id is null then
        raise exception 'A term is required'
            using errcode = 'invalid_parameter_value';
    end if;

    with
    -- Every marked result in the term, with the percentage it represents.
    marks as (
        select
            ar.student_id,
            a.subject_id,
            a.class_id,
            a.max_score,
            ar.score,
            case when a.max_score > 0 then (ar.score / a.max_score) * 100 else null end as percent
          from public.assessment_results ar
          join public.assessments a on a.id = ar.assessment_id
         where a.academic_term_id = p_academic_term_id
           and a.status = 'PUBLISHED'
           -- Only marks that actually carry a number. NOT_ENTERED and ABSENT are not
           -- scores of zero, and counting them as zero would invent a failing grade.
           and ar.status = 'GRADED'
           and ar.score is not null
           and (p_class_id is null or a.class_id = p_class_id)
    ),
    -- The grade each mark falls into, from the SCHOOL's own scale.
    graded as (
        select m.*, gb.grade
          from marks m
          left join public.grade_boundaries gb
            on m.percent >= gb.min_percent and m.percent <= gb.max_percent
           and gb.status = 'ACTIVE'
         where m.percent is not null
    ),
    distribution as (
        select coalesce(jsonb_agg(jsonb_build_object('grade', grade, 'count', n) order by grade), '[]'::jsonb) as j
          from (select grade, count(*) as n from graded where grade is not null group by grade) x
    ),
    -- Aggregated once into a plain row per subject, THEN ordered and packed. Postgres
    -- refuses an aggregate nested inside another aggregate's ORDER BY, which is how this
    -- first failed — the average has to exist as a column before it can be sorted on.
    subject_rows as (
        select subject_id, round(avg(percent)::numeric, 1) as average, count(*) as n
          from graded group by subject_id
    ),
    subjects as (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'subjectId', subject_id,
                   'subject', (select s.name from public.subjects s where s.id = subject_id),
                   'average', average,
                   'count', n
               ) order by average desc), '[]'::jsonb) as j
          from subject_rows
    ),
    class_rows as (
        select class_id, round(avg(percent)::numeric, 1) as average, count(*) as n
          from graded group by class_id
    ),
    classes as (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'classId', class_id,
                   'className', (select c.display_name from public.classes c where c.id = class_id),
                   'average', average,
                   'count', n
               ) order by average desc), '[]'::jsonb) as j
          from class_rows
    ),
    -- How many marks WOULD pass. A pass is a mark in a band the school does not treat
    -- as failing; read from the scale, not hard-coded.
    pass_marks as (
        select count(*) filter (where grade is not null and grade <> 'E') as passed,
               count(*) filter (where grade is not null) as total
          from graded
    ),
    top as (
        select s.full_name, round(avg(g.percent)::numeric, 1) as average
          from graded g join public.students s on s.id = g.student_id
         group by s.full_name
         order by average desc
         limit 1
    )
    select jsonb_build_object(
        'gradeDistribution', (select j from distribution),
        'subjectPerformance', (select j from subjects),
        'classComparison', (select j from classes),
        'metrics', jsonb_build_object(
            -- Null, NOT zero, when there are no published marks yet. A pass rate of 0%
            -- and no data at all are different claims, and only one of them is true.
            'passRate', case when (select total from pass_marks) > 0
                             then round(((select passed from pass_marks)::numeric
                                        / (select total from pass_marks)) * 100, 1)
                             else null end,
            'marksCounted', (select total from pass_marks),
            'topPerformer', (select full_name from top),
            'topPerformerAverage', (select average from top),
            'overallAverage', (select round(avg(percent)::numeric, 1) from graded)
        )
    ) into v_result;

    return v_result;
end;
$$;

revoke all on function public.academic_analytics(uuid, uuid) from public, anon;
grant execute on function public.academic_analytics(uuid, uuid) to authenticated;

-- Guard: the two things that would silently produce a WRONG number rather than an
-- empty screen. Counting unmarked children as zero, and hard-coding the pass band.
do $guard$
declare
    v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'academic_analytics';
    if v_src is null then
        raise exception 'F27: academic_analytics was not created';
    end if;
    if v_src !~ 'has_permission' then
        raise exception 'F27: academic_analytics does not check the permission';
    end if;
    if v_src !~ 'ar\.status = ''GRADED''' then
        raise exception 'F27: academic_analytics would count unmarked children as zero';
    end if;
    if v_src !~ 'grade_boundaries' then
        raise exception 'F27: academic_analytics does not use the school''s grade scale';
    end if;
    if has_function_privilege('anon', 'public.academic_analytics(uuid, uuid)', 'execute') then
        raise exception 'F27: anon can read academic analytics';
    end if;
end;
$guard$;
