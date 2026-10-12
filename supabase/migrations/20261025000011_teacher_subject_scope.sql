-- AUDIT F09 — a teacher could enter marks for a subject they do not teach. (P1)
--
-- THE FINDING, CONFIRMED ON PRODUCTION AFTER EVERYTHING ELSE WAS DONE. The scope check in
-- `save_assessment_marks` matched the CLASS and nothing else:
--
--     select 1 from teaching_assignments ta
--      where ta.class_id = v_assess.class_id
--        and ta.teacher_id = public.current_teacher_id()
--        and ta.status = 'ACTIVE'
--
-- So a teacher assigned Bahasa Melayu in a class could save marks for the Bahasa Inggeris
-- assessment in the same class. I ran that against production with a real BM-only teacher:
-- the call returned `{"graded": 0, ...}` — ACCEPTED, not refused.
--
-- WHY THE CLASS ALONE IS NOT ENOUGH. A mark written into another teacher's subject enters
-- that subject's results, and from there a published report card that a parent reads. The
-- audit states the real lesson: the fix is not to tighten the client's check, it is to make
-- the database match what the client already assumed. The screen may hide the button; the
-- database is the boundary.
--
-- THIS IS A SURGICAL CHANGE. The function's mark-handling, clearing, audit write and return
-- shape are untouched — only the authorisation block changes, because rewriting working
-- logic to fix an authorisation bug is how new bugs arrive. Verified by diffing the source
-- before and after: the only difference is the scope check.
--
-- THE MATCH NOW INCLUDES SUBJECT, ASSIGNMENT TYPE AND EFFECTIVE DATES. A `CLASS_TEACHER`
-- assignment covers the class as a whole and has no single subject; a `SUBJECT_TEACHER`
-- assignment must name the subject being marked. An assignment must be in force ON THE
-- ASSESSMENT'S DATE — one that ended last year must not authorise a mark today. Anyone
-- holding `assessments.create` (the head teacher) is unaffected.

do $migration$
declare
    v_src    text;
    v_new    text;
    v_old    text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'save_assessment_marks';
    if v_src is null then
        raise exception 'F09: save_assessment_marks does not exist';
    end if;

    v_old := $old$
        if not exists (
            select 1 from public.teaching_assignments ta
             where ta.class_id = v_assess.class_id
               and ta.teacher_id = public.current_teacher_id()
               and ta.status = 'ACTIVE'
        ) then
            raise exception 'You are not assigned to this class'
                using errcode = '42501';
        end if;$old$;

    -- RE-RUNNABLE. On a fresh database the original scope check is present and is replaced.
    -- On a database that already has the fix, it is absent — and that is fine, not an error:
    -- re-applying a migration must not fail. What must never happen is silently doing nothing
    -- when the check is present in a shape this migration does not recognise, because then a
    -- real fix would be skipped without a word.
    if position(v_old in v_src) = 0 then
        if position('ta.subject_id = v_assess.subject_id' in v_src) > 0 then
            return;  -- already fixed; nothing to do
        end if;
        raise exception 'F09: the scope check is in an unexpected shape — refusing to guess';
    end if;

    v_new := $new$
        if not exists (
            select 1 from public.teaching_assignments ta
             where ta.class_id = v_assess.class_id
               and ta.teacher_id = public.current_teacher_id()
               and ta.status = 'ACTIVE'
               -- The SUBJECT must be the one being marked, unless the teacher holds the
               -- class as a whole — a class teacher has no single subject of their own.
               and (
                     ta.assignment_type = 'CLASS_TEACHER'
                     or ta.subject_id = v_assess.subject_id
                   )
               -- And the assignment must be in force on the day of the assessment.
               and (ta.effective_from is null or ta.effective_from <= v_assess.assessment_date)
               and (ta.effective_to   is null or ta.effective_to   >= v_assess.assessment_date)
        ) then
            raise exception 'You are not assigned to this class and subject'
                using errcode = '42501';
        end if;$new$;

    v_src := replace(v_src, v_old, v_new);

    execute format(
        'create or replace function public.save_assessment_marks('
        'p_assessment_id uuid, p_entries jsonb, p_reason text default null) '
        'returns jsonb language plpgsql security definer set search_path = '''' as %L',
        v_src
    );
end;
$migration$;

revoke all on function public.save_assessment_marks(uuid, jsonb, text) from public, anon;
grant execute on function public.save_assessment_marks(uuid, jsonb, text) to authenticated;

do $guard$
declare v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'save_assessment_marks';
    if v_src is null then
        raise exception 'F09: save_assessment_marks is missing';
    end if;
    if v_src !~ 'ta\.subject_id = v_assess\.subject_id' then
        raise exception 'F09: the subject is still not matched — any subject could be marked';
    end if;
    if v_src !~ 'assignment_type = ''CLASS_TEACHER''' then
        raise exception 'F09: a class teacher would be refused their own class';
    end if;
    if v_src !~ 'effective_from' or v_src !~ 'effective_to' then
        raise exception 'F09: an expired assignment would still authorise a mark';
    end if;
    -- The rest of the function must be untouched.
    if v_src !~ 'ASSESSMENT_MARKS_SAVED' then
        raise exception 'F09: the audit write was lost';
    end if;
end;
$guard$;
