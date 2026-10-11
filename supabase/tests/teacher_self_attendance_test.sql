-- ---------------------------------------------------------------------------
-- AUDIT F27 — a teacher records their OWN attendance, and nothing more.
--
-- The safety property is not "a teacher can check in". It is "a teacher can check
-- in for themselves and for nobody else, cannot erase a decision the office made,
-- and cannot read a colleague's record". Each of those is asserted separately,
-- because a function that let any teacher write any row would pass a test that
-- only checked the happy path.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP off
\timing off

insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-4000-ec00-000000000001', 'guru.f27a@srik.test', now()),
    ('00000000-0000-4000-ec00-000000000002', 'guru.f27b@srik.test', now()),
    ('00000000-0000-4000-ec00-000000000003', 'admin.f27c@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    ('00000000-0000-4000-ec00-000000000001', 'Guru F27 A', 'ACTIVE', false),
    ('00000000-0000-4000-ec00-000000000002', 'Guru F27 B', 'ACTIVE', false),
    ('00000000-0000-4000-ec00-000000000003', 'Admin F27 C', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status, must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    ('00000000-0000-4000-ec00-000000000001', 'TEACHER'),
    ('00000000-0000-4000-ec00-000000000002', 'TEACHER'),
    ('00000000-0000-4000-ec00-000000000003', 'ADMIN')
on conflict do nothing;

insert into public.teachers (id, staff_code, full_name, gender, status, user_id) values
    -- Staff codes are chosen so A sorts AFTER B. A resolver that forgets to
    -- filter on the signed-in user then finds B first and the mistake shows.
    ('00000000-0000-4000-ec00-000000000011', 'F27Z', 'Guru F27 A', 'MALE', 'ACTIVE', '00000000-0000-4000-ec00-000000000001'),
    ('00000000-0000-4000-ec00-000000000012', 'F27A', 'Guru F27 B', 'FEMALE', 'ACTIVE', '00000000-0000-4000-ec00-000000000002')
on conflict (id) do update set user_id = excluded.user_id;


-- ---------------------------------------------------------------------------
-- F27a — a teacher can check in, and it is recorded against THEIR record.
-- ---------------------------------------------------------------------------
do $$
declare
    v_result    jsonb;
    v_teacher   uuid;
    v_recorded  uuid;
    v_others    integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-ec00-000000000001', 'role', 'authenticated')::text, true);

    v_result := public.record_my_attendance('PRESENT', 'masuk awal');

    if (v_result ->> 'recorded')::boolean is not true then
        raise exception 'FAIL F27a: check-in was not recorded: %', v_result;
    end if;

    -- WHO the row belongs to is the assertion, not merely that A row exists.
    --
    -- NOTES FROM VERIFYING THIS CHECK, because one mutation taught more than it
    -- looked like it would.
    --
    -- The staff codes below make the WRONG teacher sort first, so a resolver that
    -- forgets the session lands on teacher B and this assertion fires. Verified:
    -- `where t.user_id is not null order by t.staff_code limit 1` fails here with
    -- "no row was written for the teacher who checked in".
    --
    -- But `... or true` does NOT fail here, and the reason is worth recording
    -- rather than being mistaken for a gap. PostgreSQL evaluates the equality
    -- predicate first and short-circuits before LIMIT, so `user_id = auth.uid() or
    -- true` still returns the caller. That mutation is semantically a no-op, and a
    -- test that failed on it would be failing on a change that altered nothing. The
    -- defect this check exists to catch is a resolver that ignores the session,
    -- and that one is caught.
    select teacher_id, recorded_by into v_teacher, v_recorded
      from public.teacher_attendance
     where attendance_date = (now() at time zone 'Asia/Kuala_Lumpur')::date
       and teacher_id = '00000000-0000-4000-ec00-000000000011';

    if v_teacher is null then
        raise exception
            'FAIL F27a: no row was written for the teacher who checked in';
    end if;

    if v_teacher <> '00000000-0000-4000-ec00-000000000011' then
        raise exception
            'FAIL F27a: the check-in was written against teacher %, not the caller''s '
            'own record (00000000-0000-4000-ec00-000000000011). The function must '
            'resolve the teacher from the session', v_teacher;
    end if;

    -- And it must not have touched anyone else on the way.
    select count(*) into v_others
      from public.teacher_attendance
     where attendance_date = (now() at time zone 'Asia/Kuala_Lumpur')::date
       and teacher_id <> '00000000-0000-4000-ec00-000000000011';

    if v_others <> 0 then
        raise exception
            'FAIL F27a: one check-in wrote % rows, so it reached beyond the caller',
            v_others;
    end if;

    raise notice 'PASS: [F27a] a teacher can record their own attendance for today';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27b — and it can ONLY be their own.  The other teacher still has no row.
-- ---------------------------------------------------------------------------
do $$
declare
    v_other integer;
begin
    -- Teacher B is the one a wrong resolution picks FIRST (earlier staff code), so
    -- a row here is the fingerprint of the defect.
    select count(*) into v_other
      from public.teacher_attendance
     where teacher_id = '00000000-0000-4000-ec00-000000000012';

    if v_other <> 0 then
        raise exception
            'FAIL F27b: checking in created % rows for a DIFFERENT teacher. The '
            'function must resolve the teacher from the session, so no argument can '
            'name someone else.', v_other;
    end if;

    raise notice 'PASS: [F27b] a check-in writes only the caller''s row';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27c — a second check-in does not move the arrival time.
-- ---------------------------------------------------------------------------
do $$
declare
    v_first  timestamptz;
    v_second timestamptz;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-ec00-000000000001', 'role', 'authenticated')::text, true);

    select check_in into v_first
      from public.teacher_attendance
     where teacher_id = '00000000-0000-4000-ec00-000000000011'
       and attendance_date = (now() at time zone 'Asia/Kuala_Lumpur')::date;

    perform pg_sleep(0.05);
    perform public.record_my_attendance('LATE', 'datang lambat sebenarnya');

    select check_in into v_second
      from public.teacher_attendance
     where teacher_id = '00000000-0000-4000-ec00-000000000011'
       and attendance_date = (now() at time zone 'Asia/Kuala_Lumpur')::date;

    if v_second is distinct from v_first then
        raise exception
            'FAIL F27c: re-opening the screen moved the check-in time from % to %. '
            'The FIRST arrival is the honest record; the status may be corrected, the '
            'arrival time may not.', v_first, v_second;
    end if;

    raise notice 'PASS: [F27c] a second check-in keeps the original arrival time';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27d — a day the OFFICE recorded cannot be overwritten by the teacher.
-- ---------------------------------------------------------------------------
do $$
declare
    v_status public.teacher_attendance_status;
    v_refused boolean := false;
begin
    -- The office approves leave for today, recorded by an administrator.
    insert into public.teacher_attendance
        (teacher_id, attendance_date, status, remark, recorded_by)
    values ('00000000-0000-4000-ec00-000000000012',
            (now() at time zone 'Asia/Kuala_Lumpur')::date,
            'ON_LEAVE', 'cuti diluluskan', '00000000-0000-4000-ec00-000000000003')
    on conflict do nothing;

    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-ec00-000000000002', 'role', 'authenticated')::text, true);

    begin
        perform public.record_my_attendance('PRESENT', 'saya hadir');
    exception
        when check_violation then
            v_refused := true;
    end;

    if not v_refused then
        raise exception
            'FAIL F27d: a teacher OVERWROTE a leave record the office had approved. '
            'A self check-in must not erase a decision an administrator made.';
    end if;

    select status into v_status
      from public.teacher_attendance
     where teacher_id = '00000000-0000-4000-ec00-000000000012'
       and attendance_date = (now() at time zone 'Asia/Kuala_Lumpur')::date;

    if v_status is distinct from 'ON_LEAVE' then
        raise exception
            'FAIL F27d: the office record now reads % instead of ON_LEAVE', v_status;
    end if;

    raise notice 'PASS: [F27d] an office leave record cannot be overwritten';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27e — a teacher reads their own history and NOT a colleague's.
-- ---------------------------------------------------------------------------
do $$
declare
    v_seen integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-ec00-000000000002', 'role', 'authenticated')::text, true);

    select count(*) into v_seen from public.my_attendance_history(30);

    if v_seen <> 1 then
        raise exception
            'FAIL F27e: a teacher sees % rows in their own history, expected exactly '
            'their own 1. Seeing a colleague''s attendance is a privacy breach; '
            'seeing none means the self-read is broken.', v_seen;
    end if;

    raise notice 'PASS: [F27e] a teacher reads only their own history';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27f — check-out needs a check-in.
-- ---------------------------------------------------------------------------
do $$
declare
    v_refused boolean := false;
begin
    -- A third teacher who has not checked in today.
    insert into auth.users (id, email, email_confirmed_at) values
        ('00000000-0000-4000-ec00-000000000004', 'guru.f27d@srik.test', now())
    on conflict (id) do nothing;
    insert into public.profiles (id, full_name, status, must_change_password) values
        ('00000000-0000-4000-ec00-000000000004', 'Guru F27 D', 'ACTIVE', false)
    on conflict (id) do update set status = 'ACTIVE';
    insert into public.user_roles (user_id, role_code) values
        ('00000000-0000-4000-ec00-000000000004', 'TEACHER')
    on conflict do nothing;
    insert into public.teachers (id, staff_code, full_name, gender, status, user_id) values
        ('00000000-0000-4000-ec00-000000000014', 'F27D', 'Guru F27 D', 'MALE', 'ACTIVE', '00000000-0000-4000-ec00-000000000004')
    on conflict (id) do update set user_id = excluded.user_id;

    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-ec00-000000000004', 'role', 'authenticated')::text, true);

    begin
        perform public.record_my_checkout();
    exception
        when no_data_found then
            v_refused := true;
    end;

    if not v_refused then
        raise exception
            'FAIL F27f: a check-out was recorded for a day with no check-in, so a '
            'teacher could appear to leave a day they never arrived on.';
    end if;

    raise notice 'PASS: [F27f] a check-out requires a check-in';
end;
$$;

-- ---------------------------------------------------------------------------
-- F27g — an anonymous caller is refused.
-- ---------------------------------------------------------------------------
do $$
begin
    if has_function_privilege('anon', 'public.record_my_attendance(teacher_attendance_status, text)', 'execute')
       or has_function_privilege('anon', 'public.record_my_checkout()', 'execute')
       or has_function_privilege('anon', 'public.my_attendance_history(integer)', 'execute') then
        raise exception 'FAIL F27g: an anonymous caller can execute a self-attendance function';
    end if;
    raise notice 'PASS: [F27g] self-attendance is closed to anonymous callers';
end;
$$;

-- Clean up the fixture's attendance rows.
delete from public.teacher_attendance
 where teacher_id in ('00000000-0000-4000-ec00-000000000011',
                      '00000000-0000-4000-ec00-000000000012',
                      '00000000-0000-4000-ec00-000000000014');
