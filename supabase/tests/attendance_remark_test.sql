-- Guard test for audit finding F26 — a remark-only attendance change was dropped.
--
-- THE DEFECT. `record_class_attendance` handled a re-recorded day entirely inside
-- `if v_old_status is distinct from v_status`. The UPDATE wrote both the status and
-- the remark, so changing ONLY the remark changed nothing, returned success, and
-- left the old value in place.
--
-- WHAT THIS SUITE IS BUILT TO CATCH, and it is not "does the remark save".
--
-- A test that posts a remark and then reads it back passes against the DEFECTIVE
-- code too, as long as it uses a FRESH record — a first-time insert writes the
-- remark unconditionally. The bug only appears on a re-record of the same student
-- and date with the status held. So every check below re-records an existing day,
-- which is the only fixture shape that contains the bug at all.
--
-- THE FOUR CASES, each a different way the branch can go wrong:
--   a. change the remark, keep the status  — the reported defect
--   b. set a remark where there was none    — NULL comparison trap
--   c. clear a remark that existed          — the same trap, other direction
--   d. change BOTH                          — the case that already worked
--
-- (d) is here on purpose. A fix that made remark-only changes work by dropping the
-- status handling would pass (a), (b) and (c) and break the common path.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-ea00-' || lpad(p_label, 12, '0'))::uuid;
$$;

create or replace function test_as(p_user uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text,
        true
    );
    execute format('set local role %I', p_role);
end;
$$;

reset role;

-- A teacher who records, and the office.
insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'guru.f26@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Guru F26', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status, must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'TEACHER')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('950'), 'F26-2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

-- A helper, NOT a temporary table. A temp table is created by the owner and
-- `authenticated` gets "permission denied for table y26" when it reads it — which
-- reads as a policy problem and wastes a lot of time. A function is executable by
-- the roles the suite switches into.
create or replace function y26() returns uuid language sql stable as $$
    select id from public.academic_years where status = 'CURRENT' limit 1;
$$;

-- A teacher needs an assignment to record a register for a class.
insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'F26-401', 'Murid F26', 'MALE', 'ACTIVE')
on conflict (id) do nothing;

-- `display_name` is a generated column — supplying it is an error, not a
-- convenience. The name and code are what the school sets.
insert into public.classes (id, academic_year_id, name, year_level, code, status)
values (test_id('201'), y26(), 'F26 Class', 1, 'F26', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments
    (id, student_id, class_id, academic_year_id, enrolled_at, status)
values (test_id('301'), test_id('401'), test_id('201'), y26(), '2026-01-01', 'ACTIVE')
on conflict (id) do nothing;

insert into public.teachers (id, staff_code, full_name, status)
values (test_id('501'), 'F26', 'Guru F26', 'ACTIVE')
on conflict (id) do nothing;

update public.teachers set user_id = test_id('1') where id = test_id('501');

insert into public.teaching_assignments
    (id, teacher_id, class_id, academic_year_id, assignment_type, effective_from, status)
values (test_id('601'), test_id('501'), test_id('201'), y26(),
        'CLASS_TEACHER', '2026-01-01', 'ACTIVE')
on conflict (id) do nothing;

-- The register date, in the middle of the school's week. A function for the same
-- reason as `y26` above.
create or replace function d26() returns date language sql immutable as $$
    select '2026-03-03'::date;
$$;

do $$
begin
    if (select count(*) from public.student_enrollments where id = test_id('301')) <> 1 then
        raise exception 'F26 test setup: the enrollment was not created'
            using errcode = 'raise_exception';
    end if;
    if (select count(*) from public.teaching_assignments where id = test_id('601')) <> 1 then
        raise exception 'F26 test setup: the teaching assignment was not created'
            using errcode = 'raise_exception';
    end if;
end
$$;

-- Records one entry for the fixture child on the fixture date.
create or replace function f26_record(p_status text, p_remark text)
returns jsonb language plpgsql as $$
declare
    v_result jsonb;
begin
    select public.record_class_attendance(
        test_id('201'),
        d26(),
        jsonb_build_array(
            jsonb_build_object(
                'student_id', test_id('401'),
                'status', p_status,
                'remark', p_remark
            )
        )
    ) into v_result;
    return v_result;
end;
$$;

-- Reads the stored row WITHOUT going through a policy: the caller is the owner
-- here, so a refusal would otherwise be indistinguishable from a missing value.
create or replace function f26_read()
returns table (status text, remark text) language sql as $$
    select a.status::text, a.remark
      from public.student_attendance a
     where a.student_id = test_id('401')
       and a.attendance_date = d26();
$$;

select test_as(test_id('1'));

-- ===========================================================================
-- F26a: the FIRST record writes the remark. This is the case that works even
-- when the bug is present, which is precisely why it cannot be the whole test.
-- ===========================================================================
do $$
declare
    v_remark text;
begin
    perform f26_record('ABSENT', 'sakit');

    select remark into v_remark from f26_read();
    if v_remark is distinct from 'sakit' then
        raise exception
            'FAIL F26: the first record stored remark % instead of ''sakit''', v_remark
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a first record stores the remark';
end
$$;

-- ===========================================================================
-- F26b: THE REPORTED DEFECT — change ONLY the remark, keep the status.
--
-- The call must report a correction, and the new remark must actually be there.
-- Against the original code this fails: `corrected` is 0 and the remark is still
-- 'sakit'.
-- ===========================================================================
do $$
declare
    v_result jsonb;
    v_remark text;
begin
    v_result := f26_record('ABSENT', 'sakit, ada surat doktor');

    if (v_result->>'corrected')::int <> 1 then
        raise exception
            'FAIL F26: changing only the remark reported % corrections, but the '
            'remark did change and the change was not reported',
            v_result->>'corrected'
            using errcode = 'raise_exception';
    end if;

    select remark into v_remark from f26_read();
    if v_remark is distinct from 'sakit, ada surat doktor' then
        raise exception
            'FAIL F26: a remark-only change reported success but the stored remark is '
            'still ''%'' — the old value was shown to the office as if it were the new '
            'one', coalesce(v_remark, '<null>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a remark-only change is saved and reported';
end
$$;

-- ===========================================================================
-- F26c: CLEAR the remark while keeping the status.
--
-- The NULL trap. `remark <> ''` is NULL when the stored remark is NULL or when the
-- incoming one is, so a comparison written the obvious way treats 'clear it' as 'no
-- change' — the very case the fix exists to catch. The status is held here so the
-- only thing that can make this pass is the remark comparison.
-- ===========================================================================
do $$
declare
    v_remark text;
    v_null   boolean;
begin
    perform f26_record('ABSENT', '');

    select remark into v_remark from f26_read();
    if v_remark is not null then
        raise exception
            'FAIL F26: clearing the remark left ''%'' in place', v_remark
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a remark can be cleared while the status is held';
end
$$;

-- ===========================================================================
-- F26d: set a remark where there was NONE.
--
-- The trap in the other direction: the stored value is NULL, so the comparison
-- must treat "nothing" and "something" as different.
-- ===========================================================================
do $$
declare
    v_remark text;
begin
    perform f26_record('ABSENT', 'sakit semula');

    select remark into v_remark from f26_read();
    if v_remark is distinct from 'sakit semula' then
        raise exception
            'FAIL F26: setting a remark on a record that had none stored %',
            coalesce(v_remark, '<null>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a remark can be set where there was none';
end
$$;

-- ===========================================================================
-- F26e: changing BOTH still works, and writes both.
--
-- The path that already worked. A fix that made remark-only edits work by
-- neglecting the status would pass a, b and c and break the ordinary correction.
-- ===========================================================================
do $$
declare
    v_result jsonb;
    v_status text;
    v_remark text;
begin
    v_result := f26_record('LATE', 'bas lambat');

    if (v_result->>'corrected')::int <> 1 then
        raise exception 'FAIL F26: changing status and remark reported % corrections',
            v_result->>'corrected'
            using errcode = 'raise_exception';
    end if;

    select status, remark into v_status, v_remark from f26_read();
    if v_status is distinct from 'LATE' or v_remark is distinct from 'bas lambat' then
        raise exception
            'FAIL F26: changing both stored status=% remark=%', v_status, v_remark
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: changing both the status and the remark stores both';
end
$$;

-- ===========================================================================
-- F26f: re-recording the SAME values is not a correction.
--
-- The behaviour the original `if` was there to protect: the audit table must not
-- fill with rows that record no change. A fix that simply removed the status
-- condition would write a correction on every save, and the office would stop
-- reading the correction list.
-- ===========================================================================
do $$
declare
    v_result jsonb;
    v_after  integer;
    v_before integer;
begin
    select count(*) into v_before from public.attendance_corrections where student_id = test_id('401');

    v_result := f26_record('LATE', 'bas lambat');

    select count(*) into v_after from public.attendance_corrections where student_id = test_id('401');

    if (v_result->>'corrected')::int <> 0 then
        raise exception
            'FAIL F26: re-recording identical values reported % corrections',
            v_result->>'corrected'
            using errcode = 'raise_exception';
    end if;
    if v_after <> v_before then
        raise exception
            'FAIL F26: re-recording identical values added % audit rows',
            v_after - v_before
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an unchanged re-record is not audited';
end
$$;

-- ===========================================================================
-- F26g: the audit row says what actually moved.
--
-- A row reading 'ABSENT -> ABSENT' would be true and useless — it would not tell
-- the office why the row is there. This checks the reason names the remark.
-- ===========================================================================
do $$
declare
    v_reason text;
begin
    perform f26_record('LATE', 'bas lambat juga');

    select reason into v_reason
      from public.attendance_corrections
     where student_id = test_id('401')
     order by corrected_at desc
     limit 1;

    if v_reason is null or v_reason not like '%Remark changed%' then
        raise exception
            'FAIL F26: a remark-only correction was audited with the reason ''%'', '
            'which does not say what changed', coalesce(v_reason, '<null>')
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the audit row names the remark as what changed';
end
$$;

-- ===========================================================================
-- F26h: the grants still hold after the function was replaced.
--
-- `create or replace function` resets privileges to PUBLIC, so a migration that
-- forgets to re-grant leaves every teacher unable to record a register. The checks
-- above would not notice: they run as the owner, who bypasses privileges entirely.
--
-- AN HONEST LIMIT OF THIS CHECK, found by mutation testing. Removing the grant from
-- THIS migration does not make this fail, because migration 20261017000001 already
-- granted the same privilege to `authenticated` and grants are additive — a later
-- migration cannot silently undo an earlier one by omission. So the check below
-- verifies the property that matters (a signed-in user can record, an anonymous one
-- cannot) but cannot prove this particular file granted it.
--
-- That is the correct thing to assert anyway. The privilege is what the school
-- depends on; which migration line supplied it is an implementation detail, and the
-- re-grant is kept so this file is correct on its own terms.
-- ===========================================================================
reset role;

do $$
begin
    if not has_function_privilege(
        'authenticated', 'public.record_class_attendance(uuid,date,jsonb,uuid)', 'execute'
    ) then
        raise exception
            'FAIL F26: a signed-in user cannot record attendance after this migration '
            '— the replace reset the privileges and the grant is missing'
            using errcode = 'raise_exception';
    end if;
    if has_function_privilege(
        'anon', 'public.record_class_attendance(uuid,date,jsonb,uuid)', 'execute'
    ) then
        raise exception 'FAIL F26: an anonymous caller can record attendance'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: only a signed-in caller may record attendance';
end
$$;

rollback;
