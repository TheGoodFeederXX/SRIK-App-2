-- AUDIT F27 — per-subject marks for the reporting screen.
--
-- WHAT WAS WRONG. The reports screen read a school-wide performance payload from an
-- undeployed server and rebuilt subject averages and a ranked list of children in the
-- browser. With the server gone it showed an empty report.
--
-- WHY THE DATABASE DOES THIS. Both reports are built from the same rows at the same
-- moments. Fetching every mark to rebuild them in the browser hits the 1,000-row response
-- cap (audit F28) within a term at this school's size — silently, so the averages would be
-- computed over part of the school with nothing to say so.
--
-- A MISSING MARK IS NULL, NOT ZERO. "Not marked in this subject" and "scored zero" are
-- different claims, and a report that treats them alike ranks a child last for a subject
-- they were never assessed in.

create or replace function public.subject_marks_for_term(p_academic_term_id uuid)
returns table (
    student_id uuid,
    student_name text,
    subject_id uuid,
    subject_name text,
    average_percent numeric,
    marks_counted integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_active_user() or not public.has_permission('reports.view') then
        raise exception 'Not permitted to view subject marks'
            using errcode = 'insufficient_privilege';
    end if;

    return query
    select
        ar.student_id,
        s.full_name,
        a.subject_id,
        sub.name,
        round(avg((ar.score / a.max_score) * 100), 1),
        count(*)::int
      from public.assessment_results ar
      join public.assessments a on a.id = ar.assessment_id
      join public.students s on s.id = ar.student_id
      left join public.subjects sub on sub.id = a.subject_id
     where a.academic_term_id = p_academic_term_id
       and a.status = 'PUBLISHED'
       -- Only marks carrying a number. NOT_ENTERED, ABSENT and EXEMPT are recorded
       -- outcomes, not scores, and treating them as zero would invent a failing grade.
       and ar.status = 'GRADED'
       and ar.score is not null
       and a.max_score > 0
     group by ar.student_id, s.full_name, a.subject_id, sub.name
     order by s.full_name, sub.name;
end;
$$;

revoke all on function public.subject_marks_for_term(uuid) from public, anon;
grant execute on function public.subject_marks_for_term(uuid) to authenticated;

do $guard$
declare
    v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'subject_marks_for_term';
    if v_src is null then
        raise exception 'F27: subject_marks_for_term was not created';
    end if;
    if v_src !~ 'has_permission' then
        raise exception 'F27: subject_marks_for_term does not check the permission';
    end if;
    if v_src !~ 'ar\.status = ''GRADED''' then
        raise exception 'F27: subject_marks_for_term would count unmarked children as zero';
    end if;
    if v_src !~ 'ar\.score is not null' then
        raise exception 'F27: subject_marks_for_term counts a mark with no score';
    end if;
    if has_function_privilege('anon', 'public.subject_marks_for_term(uuid)', 'execute') then
        raise exception 'F27: anon can read subject marks';
    end if;
end;
$guard$;
