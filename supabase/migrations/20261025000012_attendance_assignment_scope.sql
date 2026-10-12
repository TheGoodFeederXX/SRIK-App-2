-- AUDIT F08 — an ended assignment still authorised recording attendance. (P1)
--
-- THE FINDING, CONFIRMED ON PRODUCTION AFTER F09 WAS FIXED. `record_class_attendance` checked
-- that a teacher had SOME assignment for the class, and nothing about whether it was still in
-- force:
--
--     select count(*) into v_assigned
--     from public.teaching_assignments ta
--     where ta.class_id = p_class_id
--       and ta.teacher_id = public.current_teacher_id();
--
-- I gave a teacher an assignment that ENDED 300 DAYS AGO and had them record the register
-- against production. It returned `{"recorded": 1}` — the mark was written. A teacher who left
-- the class, or whose assignment was closed at the end of last year, could still write
-- attendance today.
--
-- THE CLASS IS THE RIGHT SCOPE HERE. Attendance has no `subject_id` — the register is taken
-- for a class on a day, not per subject — so the subject match that F09 needed does not apply.
-- What was missing is the DATE: an assignment must be in force on the day being recorded.
--
-- AND IT MUST BE ACTIVE. The original query ignored `status` as well, so an assignment that
-- had been closed outright still counted.
--
-- THIS IS A SURGICAL CHANGE, like F09: one query replaced inside an otherwise untouched
-- function. The attendance-writing, correction handling, audit write and return shape are all
-- as they were. The migration refuses to guess if the query is not in the shape it expects,
-- and is re-runnable.

do $migration$
declare
    v_src text;
    v_new text;
    v_old text;
begin
    v_old := $old$
        select count(*) into v_assigned
        from public.teaching_assignments ta
        where ta.class_id = p_class_id
          and ta.teacher_id = public.current_teacher_id();
$old$;

    v_new := $new$
        select count(*) into v_assigned
        from public.teaching_assignments ta
        where ta.class_id = p_class_id
          and ta.teacher_id = public.current_teacher_id()
          -- The assignment must still be open. An assignment closed outright is not a
          -- claim to the class.
          and ta.status = 'ACTIVE'
          -- AND it must be in force ON THE DAY BEING RECORDED. Without this, a teacher whose
          -- assignment ended last year could still write today's register (audit F08).
          and (ta.effective_from is null or ta.effective_from <= p_date)
          and (ta.effective_to   is null or ta.effective_to   >= p_date);
$new$;

    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'record_class_attendance';
    if v_src is null then
        raise exception 'F08: record_class_attendance does not exist';
    end if;

    if position(v_old in v_src) = 0 then
        -- Re-runnable: already fixed is a success, not an error.
        if position('ta.effective_to   >= p_date' in v_src) > 0 then
            return;
        end if;
        raise exception 'F08: the assignment check is in an unexpected shape — refusing to guess';
    end if;

    v_src := replace(v_src, v_old, v_new);

    execute format(
        'create or replace function public.record_class_attendance('
        'p_class_id uuid, p_date date, p_entries jsonb, p_recorded_by uuid default null) '
        'returns jsonb language plpgsql security definer set search_path = '''' as %L',
        v_src
    );
end;
$migration$;

do $guard$
declare v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'record_class_attendance';
    if v_src is null then
        raise exception 'F08: record_class_attendance is missing';
    end if;
    if v_src !~ 'ta\.status = ''ACTIVE''' then
        raise exception 'F08: a closed assignment would still authorise the register';
    end if;
    if v_src !~ 'ta\.effective_to   >= p_date' then
        raise exception 'F08: an ended assignment would still authorise the register';
    end if;
    if v_src !~ 'ta\.effective_from <= p_date' then
        raise exception 'F08: an assignment that has not begun would authorise the register';
    end if;
    -- The rest of the function must be intact.
    if v_src !~ 'ATTENDANCE_RECORDED' and v_src !~ 'recorded' then
        raise exception 'F08: the function body looks truncated';
    end if;
end;
$guard$;
