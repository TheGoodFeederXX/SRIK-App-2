-- ---------------------------------------------------------------------------
-- AUDIT F27 — a teacher can record their own attendance
--
-- THE GAP. `teacher_attendance` exists, has RLS, and a teacher can READ their own
-- row. No teacher can WRITE one: the only write policy requires
-- `attendance.manage_staff`, which is an office permission. So the self check-in
-- screen could never save anything — it called `api.submitMyAttendance()` against
-- an Express endpoint that is not deployed, and there was no database path either.
--
-- Granting `attendance.manage_staff` is not the answer: that permission lets
-- someone record attendance on behalf of EVERY teacher. A teacher checking in for
-- themselves is a different act, and it must not come with the ability to mark a
-- colleague present or absent.
--
-- So the write goes through one RPC that can only ever write a row for the caller,
-- for today, and that refuses to touch a day the office has already recorded.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Check in / correct today
-- ---------------------------------------------------------------------------
create or replace function public.record_my_attendance(
    p_status public.teacher_attendance_status default 'PRESENT',
    p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_teacher_id uuid;
    v_today      date;
    v_existing   record;
    v_row        public.teacher_attendance;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if not public.is_active_user() then
        raise exception 'This account is not active'
            using errcode = 'insufficient_privilege';
    end if;

    -- WHO the call is for is looked up, never passed in. This is the whole safety
    -- property of the function: there is no argument that can name another teacher.
    select t.id into v_teacher_id
      from public.teachers t
     where t.user_id = v_actor
     limit 1;

    if v_teacher_id is null then
        raise exception 'No teacher record is linked to this account'
            using errcode = 'no_data_found';
    end if;

    -- The school day is defined in Malaysia, so "today" must be too: a teacher
    -- checking in early from overseas should land on the day the SCHOOL is having.
    v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;

    select * into v_existing
      from public.teacher_attendance ta
     where ta.teacher_id = v_teacher_id
       and ta.attendance_date = v_today;

    if found then
        -- ALREADY RECORDED BY THE OFFICE → REFUSE.
        --
        -- `recorded_by` being someone other than the teacher means the office has
        -- already made an entry: a leave approval, a medical certificate, an
        -- official duty. A self check-in must not overwrite that. This is the one
        -- case where "let the teacher fix their own row" would quietly erase a
        -- decision an administrator made.
        -- `recorded_by` holds an auth USER id (`references auth.users`), which is why
        -- this compares against the actor and not the teacher row. Comparing the two
        -- different id spaces would have silently never matched, so the office's
        -- leave approval would have been overwritten by a self check-in.
        if v_existing.recorded_by is not null and v_existing.recorded_by <> v_actor then
            raise exception
                'The office has already recorded your attendance for today (%). '
                'Ask them to change it.', v_existing.status
                using errcode = 'check_violation';
        end if;

        -- Already checked in today: keep the FIRST check-in time. Re-opening the
        -- screen must not move someone''s arrival later, which is the difference
        -- between an honest record and a convenient one.
        update public.teacher_attendance
           set status    = p_status,
               remark    = coalesce(p_remark, remark),
               -- set only when the office has not already stamped it
               check_in  = coalesce(check_in, now()),
               recorded_by = v_actor,
               updated_at = now()
         where id = v_existing.id
        returning * into v_row;

        return jsonb_build_object(
            'recorded', true,
            'created',  false,
            'id',       v_row.id,
            'date',     v_row.attendance_date,
            'status',   v_row.status,
            'check_in', v_row.check_in
        );
    end if;

    insert into public.teacher_attendance
        (teacher_id, attendance_date, check_in, status, remark, recorded_by)
    values
        (v_teacher_id, v_today, now(), p_status, p_remark, v_actor)
    returning * into v_row;

    return jsonb_build_object(
        'recorded', true,
        'created',  true,
        'id',       v_row.id,
        'date',     v_row.attendance_date,
        'status',   v_row.status,
        'check_in', v_row.check_in
    );
end;
$$;

comment on function public.record_my_attendance(public.teacher_attendance_status, text) is
    'Records the signed-in teacher''s own attendance for today. The teacher is '
    'resolved from the session, so it cannot write a row for anyone else. Refuses '
    'to overwrite a day the office has already recorded.';


-- ---------------------------------------------------------------------------
-- 2. Check out
-- ---------------------------------------------------------------------------
create or replace function public.record_my_checkout()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_teacher_id uuid;
    v_today      date;
    v_row        public.teacher_attendance;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if not public.is_active_user() then
        raise exception 'This account is not active'
            using errcode = 'insufficient_privilege';
    end if;

    select t.id into v_teacher_id
      from public.teachers t
     where t.user_id = v_actor
     limit 1;

    if v_teacher_id is null then
        raise exception 'No teacher record is linked to this account'
            using errcode = 'no_data_found';
    end if;

    v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;

    -- You cannot leave a day you never arrived on.
    select * into v_row
      from public.teacher_attendance ta
     where ta.teacher_id = v_teacher_id
       and ta.attendance_date = v_today;

    if not found then
        raise exception 'You have not checked in today'
            using errcode = 'no_data_found';
    end if;

    if v_row.check_out is not null then
        return jsonb_build_object('recorded', false, 'reason', 'already-checked-out',
                                  'check_out', v_row.check_out);
    end if;

    update public.teacher_attendance
       set check_out = now(), updated_at = now()
     where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
        'recorded', true,
        'id',       v_row.id,
        'check_in', v_row.check_in,
        'check_out', v_row.check_out
    );
end;
$$;

comment on function public.record_my_checkout() is
    'Stamps the signed-in teacher''s check-out for today. Refuses when there is no '
    'check-in, so a check-out can never exist without an arrival.';


-- ---------------------------------------------------------------------------
-- 3. Read your own month
-- ---------------------------------------------------------------------------
create or replace function public.my_attendance_history(p_days integer default 30)
returns table (
    attendance_date date,
    status          public.teacher_attendance_status,
    check_in        timestamptz,
    check_out       timestamptz,
    remark          text
)
language sql
stable
security definer
set search_path = ''
as $$
    select ta.attendance_date, ta.status, ta.check_in, ta.check_out, ta.remark
      from public.teacher_attendance ta
      join public.teachers t on t.id = ta.teacher_id
     where t.user_id = auth.uid()
       and public.is_active_user()
       and ta.attendance_date >= ((now() at time zone 'Asia/Kuala_Lumpur')::date
                                   - greatest(coalesce(p_days, 30), 1))
     order by ta.attendance_date desc;
$$;

comment on function public.my_attendance_history(integer) is
    'The signed-in teacher''s own attendance for the last N days, newest first. '
    'Resolved from the session, so it cannot read a colleague''s record.';


-- ---------------------------------------------------------------------------
-- 4. Grants — after every definition, because `create or replace` resets them
-- ---------------------------------------------------------------------------
revoke all on function public.record_my_attendance(public.teacher_attendance_status, text) from public, anon;
revoke all on function public.record_my_checkout() from public, anon;
revoke all on function public.my_attendance_history(integer) from public, anon;

grant execute on function public.record_my_attendance(public.teacher_attendance_status, text) to authenticated;
grant execute on function public.record_my_checkout() to authenticated;
grant execute on function public.my_attendance_history(integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Guard
-- ---------------------------------------------------------------------------
do $$
declare
    v_body text;
begin
    -- The safety property: no argument can name another teacher.
    select p.prosrc into v_body
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'record_my_attendance'
       and pg_get_function_identity_arguments(p.oid)
           = 'p_status teacher_attendance_status, p_remark text';

    if v_body is null then
        raise exception 'F27 guard: record_my_attendance is missing';
    end if;

    if v_body like '%p_teacher_id%' then
        raise exception
            'F27 guard: record_my_attendance takes a teacher id. It must resolve the '
            'teacher from the session, so one teacher cannot mark another present';
    end if;

    if v_body not like '%t.user_id = v_actor%' then
        raise exception
            'F27 guard: record_my_attendance does not resolve the teacher from the '
            'signed-in user';
    end if;

    -- The office''s decision must survive, compared in the RIGHT id space:
    -- `recorded_by` is an auth user id, so comparing it to the teacher id would
    -- never match and the protection would be decorative.
    if v_body not like '%v_existing.recorded_by%' then
        raise exception
            'F27 guard: record_my_attendance does not protect a day the office has '
            'already recorded';
    end if;

    if v_body like '%recorded_by <> v_teacher_id%' then
        raise exception
            'F27 guard: record_my_attendance compares recorded_by (an auth user id) to '
            'the teacher id. The two id spaces never match, so an office record would '
            'be overwritten without the check ever firing';
    end if;

    -- Malaysia, not the server''s timezone.
    if v_body not like '%Asia/Kuala_Lumpur%' then
        raise exception
            'F27 guard: record_my_attendance does not resolve today in Malaysia time';
    end if;

    if has_function_privilege('anon', 'public.record_my_attendance(teacher_attendance_status, text)', 'execute')
       or has_function_privilege('anon', 'public.record_my_checkout()', 'execute')
       or has_function_privilege('anon', 'public.my_attendance_history(integer)', 'execute') then
        raise exception 'F27 guard: an anonymous caller can execute a self-attendance function';
    end if;
end;
$$;
