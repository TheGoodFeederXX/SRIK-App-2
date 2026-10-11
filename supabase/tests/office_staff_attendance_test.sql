-- AUDIT F27 — the office's staff register.
--
-- WHAT WAS WRONG. The office's teacher-attendance screens read and wrote through an
-- Express endpoint that is not deployed, so the register was empty and marking
-- someone present did nothing. The screen looked like it worked: the buttons moved,
-- and the change was silently gone by the next load.
--
-- The interesting checks are about WHO may read it and about a second entry
-- CORRECTING the first rather than doubling the day.

\set ON_ERROR_STOP on

begin;

create temp table actors as
select
    (select p.id from public.profiles p join public.user_roles ur on ur.user_id = p.id
      where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1) as admin_id,
    (select p.id from public.profiles p join public.user_roles ur on ur.user_id = p.id
      where ur.role_code = 'TEACHER' and p.status = 'ACTIVE' limit 1) as teacher_id,
    (select t.id from public.teachers t order by t.staff_code limit 1) as teacher_row;

-- F27o1: the office records a day, and recording it AGAIN corrects it.
do $o1$
declare
    v_admin uuid;
    v_teacher uuid;
    v_n integer;
    v_status public.teacher_attendance_status;
begin
    select admin_id, teacher_row into v_admin, v_teacher from actors;
    if v_admin is null then
        raise exception 'F27o1: no active admin';
    end if;
    if v_teacher is null then
        raise exception 'F27o1: no teacher row';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    perform public.record_staff_attendance(v_teacher, current_date, 'PRESENT', 'pagi');
    perform public.record_staff_attendance(v_teacher, current_date, 'LATE', 'lewat');

    select count(*) into v_n from public.teacher_attendance
     where teacher_id = v_teacher and attendance_date = current_date;
    if v_n <> 1 then
        raise exception 'F27o1: % rows for one teacher on one day — a day must be correctable, not duplicated', v_n;
    end if;

    select status into v_status from public.teacher_attendance
     where teacher_id = v_teacher and attendance_date = current_date;
    if v_status <> 'LATE' then
        raise exception 'F27o1: the second entry did not correct the first (status is %)', v_status;
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27o1] a second entry corrects the day instead of duplicating it';
end;
$o1$;

-- F27o2: a teacher cannot read the whole staff register.
do $o2$
declare
    v_teacher_user uuid;
begin
    select teacher_id into v_teacher_user from actors;
    if v_teacher_user is null then
        raise notice 'SKIP: [F27o2] no teacher account to test with';
        return;
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_teacher_user), true);

    begin
        perform * from public.list_staff_attendance(current_date);
        perform set_config('role', 'postgres', true);
        raise exception 'F27o2: a teacher read the whole staff register';
    exception
        when insufficient_privilege then
            perform set_config('role', 'postgres', true);
            raise notice 'PASS: [F27o2] a teacher cannot read the staff register';
    end;
end;
$o2$;

-- F27o3: the office cannot record a day for a teacher who does not exist, and an
-- anonymous caller cannot reach either function.
do $o3$
declare
    v_admin uuid;
begin
    select admin_id into v_admin from actors;

    if has_function_privilege('anon', 'public.list_staff_attendance(date)', 'execute')
       or has_function_privilege('anon', 'public.record_staff_attendance(uuid, date, public.teacher_attendance_status, text)', 'execute')
       or has_function_privilege('anon', 'public.list_staff_attendance_range(uuid, date, date)', 'execute') then
        raise exception 'F27o3: anon can reach the staff attendance functions';
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    begin
        perform public.record_staff_attendance(
            '00000000-0000-0000-0000-000000000000'::uuid, current_date, 'PRESENT');
        perform set_config('role', 'postgres', true);
        raise exception 'F27o3: attendance was recorded for a teacher who does not exist';
    exception
        when invalid_parameter_value then
            perform set_config('role', 'postgres', true);
            raise notice 'PASS: [F27o3] anon is refused and a non-existent teacher cannot be recorded';
    end;
end;
$o3$;

-- F27o4: the range read is bounded, and refuses a backwards range rather than
-- returning something plausible.
do $o4$
declare
    v_admin uuid;
    v_teacher uuid;
begin
    select admin_id, teacher_row into v_admin, v_teacher from actors;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    begin
        perform * from public.list_staff_attendance_range(
            v_teacher, current_date, current_date - 30);
        perform set_config('role', 'postgres', true);
        raise exception 'F27o4: a backwards range was accepted';
    exception
        when invalid_parameter_value then
            perform set_config('role', 'postgres', true);
            raise notice 'PASS: [F27o4] a backwards date range is refused, not silently empty';
    end;
end;
$o4$;

rollback;
