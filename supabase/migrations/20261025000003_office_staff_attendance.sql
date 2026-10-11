-- AUDIT F27 — the office's staff register had no way to read or write.
--
-- WHAT WAS WRONG. The office's teacher-attendance screen read teachers and their
-- attendance through an Express endpoint that is not deployed, so the register was
-- always empty and marking someone present did nothing. The office could not tell
-- who was in.
--
-- WHY THESE ARE FUNCTIONS RATHER THAN DIRECT TABLE ACCESS. `teacher_attendance`
-- already has a `write` policy requiring `attendance.manage_staff`, which is the
-- office's. Reading is restricted to a teacher's own rows. So a READ of everyone
-- needs to be a function that answers "for the office" — and it must decide that
-- from the caller's permissions, not from an argument a caller can set.
--
-- The date is passed in as the SCHOOL's day. The screen computes it once in
-- Malaysia time and both the register and a teacher's own history use it, so the
-- two cannot end up describing different days.

create or replace function public.list_staff_attendance(p_date date default current_date)
returns table (
    teacher_id uuid,
    attendance_date date,
    status public.teacher_attendance_status,
    check_in timestamptz,
    check_out timestamptz,
    remark text,
    recorded_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    -- The office only. A teacher gets an empty register, which is the correct
    -- answer to a question they are not entitled to ask.
    if not public.is_active_user() or not public.has_permission('attendance.manage_staff') then
        raise exception 'Not allowed to view the staff attendance register'
            using errcode = 'insufficient_privilege';
    end if;

    return query
        select ta.teacher_id, ta.attendance_date, ta.status,
               ta.check_in, ta.check_out, ta.remark, ta.recorded_by
          from public.teacher_attendance ta
         where ta.attendance_date = p_date
         order by ta.teacher_id;
end;
$$;

revoke all on function public.list_staff_attendance(date) from public, anon;
grant execute on function public.list_staff_attendance(date) to authenticated;

-- One teacher's attendance over a range, for the month view.
--
-- A separate function from the day register because the question is different:
-- "who was in today" versus "how was this person's month". Both are the office's,
-- so both check the same permission.
create or replace function public.list_staff_attendance_range(
    p_teacher_id uuid,
    p_from date,
    p_to date
)
returns table (
    attendance_date date,
    status public.teacher_attendance_status,
    check_in timestamptz,
    check_out timestamptz,
    remark text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_active_user() or not public.has_permission('attendance.manage_staff') then
        raise exception 'Not allowed to view a teacher''s attendance'
            using errcode = 'insufficient_privilege';
    end if;
    if p_from > p_to then
        raise exception 'The start of the range is after its end'
            using errcode = 'invalid_parameter_value';
    end if;

    return query
        select ta.attendance_date, ta.status, ta.check_in, ta.check_out, ta.remark
          from public.teacher_attendance ta
         where ta.teacher_id = p_teacher_id
           and ta.attendance_date between p_from and p_to
         order by ta.attendance_date;
end;
$$;

revoke all on function public.list_staff_attendance_range(uuid, date, date) from public, anon;
grant execute on function public.list_staff_attendance_range(uuid, date, date) to authenticated;

-- Records or corrects one teacher's attendance for one day.
--
-- Keyed on (teacher, date) so a second call corrects the first rather than adding
-- a second row for the same day — two rows for one teacher on one day would make
-- "how many days was she in" unanswerable.
--
-- `recorded_by` is the CALLER, and it references `auth.users(id)`, not `teachers`.
-- Writing the teacher's id there violates the foreign key, which is how that was
-- found the first time.
create or replace function public.record_staff_attendance(
    p_teacher_id uuid,
    p_date date,
    p_status public.teacher_attendance_status,
    p_remark text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if not public.is_active_user() or not public.has_permission('attendance.manage_staff') then
        raise exception 'Not allowed to record staff attendance'
            using errcode = 'insufficient_privilege';
    end if;
    if p_teacher_id is null then
        raise exception 'A teacher is required' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.teachers t where t.id = p_teacher_id) then
        raise exception 'No such teacher' using errcode = 'invalid_parameter_value';
    end if;

    insert into public.teacher_attendance
        (teacher_id, attendance_date, status, remark, recorded_by, recorded_at)
    values
        (p_teacher_id, p_date, p_status, p_remark, v_actor, now())
    on conflict (teacher_id, attendance_date) do update
       set status = excluded.status,
           remark = excluded.remark,
           -- The office correcting a record takes it over, and the audit trail
           -- shows who did it.
           recorded_by = v_actor,
           recorded_at = now(),
           updated_at = now();
end;
$$;

revoke all on function public.record_staff_attendance(uuid, date, public.teacher_attendance_status, text) from public, anon;
grant execute on function public.record_staff_attendance(uuid, date, public.teacher_attendance_status, text) to authenticated;

-- Guard: the register must be gated on the OFFICE permission, and the recorder must
-- be the caller. A function that trusted a `recorded_by` argument would let a
-- caller attribute a record to someone else.
do $guard$
declare
    v_src text;
begin
    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'list_staff_attendance';
    if v_src is null then
        raise exception 'F27: list_staff_attendance was not created';
    end if;
    if v_src !~ 'has_permission' then
        raise exception 'F27: list_staff_attendance does not check the office permission';
    end if;

    select p.prosrc into v_src from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'record_staff_attendance';
    if v_src is null then
        raise exception 'F27: record_staff_attendance was not created';
    end if;
    if v_src !~ 'has_permission' then
        raise exception 'F27: record_staff_attendance does not check the office permission';
    end if;
    if v_src !~ 'v_actor' then
        raise exception 'F27: record_staff_attendance does not record the caller';
    end if;
    -- ON CONFLICT is what keeps one row per teacher per day.
    if v_src !~ 'on conflict' then
        raise exception 'F27: record_staff_attendance can write two rows for one day';
    end if;

    if has_function_privilege('anon', 'public.list_staff_attendance_range(uuid, date, date)', 'execute') then
        raise exception 'F27: anon can reach the staff attendance range';
    end if;

    if has_function_privilege('anon', 'public.list_staff_attendance(date)', 'execute')
       or has_function_privilege('anon', 'public.record_staff_attendance(uuid, date, public.teacher_attendance_status, text)', 'execute') then
        raise exception 'F27: anon can reach the staff attendance functions';
    end if;
end;
$guard$;
