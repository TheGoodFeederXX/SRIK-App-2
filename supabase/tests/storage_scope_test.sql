-- Guard test for audit finding F37 — stored files are read under the SAME rules as
-- the document rows.
--
-- THE DEFECT. There were two functions named `can_read_document`, and they
-- disagreed:
--
--   can_read_document(uuid)  — added for F10. A teacher reaches a child's document
--                              only if they teach that child; a guardian only if it
--                              is their child; the office sees everything.
--   can_read_document(text)  — the Storage policy's copy. It returned TRUE for
--                              anybody holding `documents.view`, BEFORE examining
--                              the path at all.
--
-- `documents.view` is held by ADMIN *and* TEACHER. So a teacher could open any
-- family's stored file, while the very same file's database row was correctly
-- hidden from them. The row was protected and the bytes were not.
--
-- The fix is not a second rule but no second rule: the text version resolves the
-- path to a document id and asks the uuid version. These checks exercise that
-- delegation, from the outside, through the function Storage itself calls.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e600-' || lpad(p_label, 12, '0'))::uuid;
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

-- Storage is not part of the application schema; the policies live on it and the
-- bucket must exist for the checks below to mean anything.
create schema if not exists storage;

reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.f37@srik.test', now()),
    (test_id('2'), 'guru.f37@srik.test', now()),
    (test_id('3'), 'guru.lain.f37@srik.test', now()),
    (test_id('4'), 'penjaga.f37@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Pentadbir F37', 'ACTIVE', false),
    (test_id('2'), 'Guru F37', 'ACTIVE', false),
    (test_id('3'), 'Guru Lain F37', 'ACTIVE', false),
    (test_id('4'), 'Penjaga F37', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status,
        must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('2'), 'TEACHER'),
    (test_id('3'), 'TEACHER'),
    (test_id('4'), 'GUARDIAN')
on conflict do nothing;

-- Teacher 2 has a profile row; link it so `current_teacher_id()` can find it.
insert into public.teachers (id, user_id, staff_code, full_name, status) values
    (test_id('20'), test_id('2'), 'F37-T1', 'Guru F37', 'ACTIVE'),
    (test_id('21'), test_id('3'), 'F37-T2', 'Guru Lain F37', 'ACTIVE')
on conflict (id) do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), 'F37-2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

create temporary table y37 as select id from public.academic_years where status = 'CURRENT' limit 1;

insert into public.classes (id, academic_year_id, year_level, name, code, status)
values (test_id('800'), (select id from y37), 1, 'Kelas F37', 'F371', 'ACTIVE')
on conflict (id) do nothing;

insert into public.subjects (id, code, name, status)
values (test_id('810'), 'F37S', 'Subjek F37', 'ACTIVE')
on conflict (id) do nothing;

-- Two children in TWO different classes: one the caller teaches, one they do not.
insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'F37-401', 'Murid Diajar', 'MALE', 'ACTIVE'),
    (test_id('402'), 'F37-402', 'Murid Tidak Diajar', 'FEMALE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments
    (id, student_id, class_id, academic_year_id, status, enrolled_at)
values
    (test_id('501'), test_id('401'), test_id('800'), (select id from y37), 'ACTIVE', '2026-01-05'),
    (test_id('502'), test_id('402'), test_id('800'), (select id from y37), 'ACTIVE', '2026-01-05')
on conflict (id) do nothing;

-- Teacher 2 teaches this class; teacher 3 teaches nothing.
-- `assignment_type` and `effective_from` are NOT NULL; the fixture must supply
-- them or the insert fails and every check below runs against no data.
insert into public.teaching_assignments
    (id, teacher_id, class_id, subject_id, academic_year_id, assignment_type,
     periods_per_week, effective_from, status)
values (test_id('601'), test_id('20'), test_id('800'), test_id('810'),
        (select id from y37), 'SUBJECT_TEACHER', 4, '2026-01-05', 'ACTIVE')
on conflict (id) do nothing;

-- The caller's own child is 401; 402 belongs to someone else.
insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('701'), test_id('4'), 'Penjaga F37', '017'),
    (test_id('702'), null, 'Penjaga Lain F37', '016')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary) values
    (test_id('401'), test_id('701'), 'FATHER', true),
    (test_id('402'), test_id('702'), 'FATHER', true)
on conflict do nothing;

-- A document row for each child, so the path can resolve to a row.
-- The column is `storage_key` — the same name the Storage policy resolves against.
-- `file_path`/`file_size_bytes` do not exist, and a document row whose key does not
-- match the object's name is a document nobody can read.
insert into public.documents
    (id, title, owner_type, student_id, category, storage_key, size_bytes,
     mime_type, uploaded_by)
values
    (test_id('801'), 'Fail Anak Diajar', 'STUDENT', test_id('401'), 'REPORT',
     'STUDENT/' || test_id('401') || '/fail-anak-diajar.pdf', 1024,
     'application/pdf', test_id('1')),
    (test_id('802'), 'Fail Anak Lain', 'STUDENT', test_id('402'), 'REPORT',
     'STUDENT/' || test_id('402') || '/fail-anak-lain.pdf', 1024,
     'application/pdf', test_id('1'))
on conflict (id) do nothing;

-- The fixture's own precondition, asserted where it is made: a path that resolves
-- to nothing would make every check below pass for the wrong reason.
do $$
declare
    v_owner uuid;
begin
    -- A `returns table` function is read with SELECT, not by dotting into the call:
    -- `public.storage_path_owner(x).owner_id` is a syntax error in Postgres. This
    -- suite also asserts the DOCUMENT ROW exists, because the whole fix is that a
    -- path is authorised through its row — a path with no row is refused by design,
    -- and would make the checks below pass for the wrong reason.
    select owner_id into v_owner
      from public.storage_path_owner(
               'STUDENT/' || test_id('401') || '/fail-anak-diajar.pdf'
           );

    if v_owner is null
       or not exists (select 1 from public.documents where id = test_id('801')) then
        raise exception
            'F37 test setup: the document path does not resolve to a document row, '
            'so the checks below cannot distinguish a rule from a parse failure'
            using errcode = 'raise_exception';
    end if;
end
$$;

-- ===========================================================================
-- F37a: a TEACHER must NOT reach the file of a child they do not teach.
--
-- THIS IS THE FINDING. The old text version returned true here, because the caller
-- holds `documents.view`.
-- ===========================================================================
select test_as(test_id('3'));  -- teacher with no assignments

do $$
begin
    if public.can_read_stored_file('STUDENT/' || test_id('402') || '/fail-anak-lain.pdf') then
        raise exception
            'FAIL F37: a teacher who does not teach this child can read their stored '
            'file — the Storage rule is weaker than the row rule it is supposed to '
            'match'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher cannot reach a file belonging to a child they do not teach';
end
$$;

-- ===========================================================================
-- F37b: and a GUARDIAN must not reach another family's child either.
-- ===========================================================================
reset role;
select test_as(test_id('4'));

do $$
begin
    if public.can_read_stored_file('STUDENT/' || test_id('402') || '/fail-anak-lain.pdf') then
        raise exception
            'FAIL F37: a guardian can read another family''s stored file'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a guardian cannot reach another family''s file';
end
$$;

-- ===========================================================================
-- F37c: the legitimate paths must still work, or the fix has broken storage.
--
-- Both halves again: a rule that refuses everything is not a rule that works.
-- ===========================================================================
do $$
begin
    if not public.can_read_stored_file('STUDENT/' || test_id('401') || '/fail-anak-diajar.pdf') then
        raise exception
            'FAIL F37: a guardian cannot read their OWN child''s file'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a guardian reaches their own child''s file';
end
$$;

reset role;
select test_as(test_id('1'));  -- office

do $$
begin
    if not public.can_read_stored_file('STUDENT/' || test_id('402') || '/fail-anak-lain.pdf') then
        raise exception
            'FAIL F37: the office cannot read a child''s file'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the office reaches every child''s file';
end
$$;

reset role;
select test_as(test_id('2'));  -- teacher who DOES teach this class

do $$
begin
    if not public.can_read_stored_file('STUDENT/' || test_id('401') || '/fail-anak-diajar.pdf') then
        raise exception
            'FAIL F37: a teacher cannot read the file of a child they DO teach — the '
            'scope was narrowed too far'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher reaches the file of a child they teach';
end
$$;

-- ===========================================================================
-- F37d: a school-level file has no document row.
--
-- The office manages these; nobody else reads them. This also proves the fallback
-- for a path with no row is not simply "allow".
-- ===========================================================================
reset role;
select test_as(test_id('1'));

do $$
begin
    if not public.can_read_stored_file('SCHOOL/pekeling-sekolah.pdf') then
        raise exception
            'FAIL F37: the office cannot read a school-level file'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the office reaches school-level files';
end
$$;

reset role;
select test_as(test_id('3'));

do $$
begin
    if public.can_read_stored_file('SCHOOL/pekeling-sekolah.pdf') then
        raise exception
            'FAIL F37: a teacher can read a school-level file that is the office''s'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher cannot reach school-level files';
end
$$;

-- ===========================================================================
-- F37e: a malformed path must fail CLOSED.
--
-- An unparseable name is not a licence to read. This is the check that would have
-- caught the old version's early `true`.
-- ===========================================================================
reset role;
select test_as(test_id('2'));

do $$
begin
    if public.can_read_stored_file('not-a-real-path') then
        raise exception
            'FAIL F37: a path that resolves to nothing is readable, so an odd name is '
            'a way in'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: an unresolvable path is refused';
end
$$;

-- ===========================================================================
-- F37f: a signed-in but INACTIVE account must not read anything.
-- ===========================================================================
reset role;
update public.profiles set status = 'DISABLED' where id = test_id('2');
select test_as(test_id('2'));

do $$
begin
    if public.can_read_stored_file('STUDENT/' || test_id('401') || '/fail-anak-diajar.pdf') then
        raise exception
            'FAIL F37: a disabled account can still read stored files'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a disabled account reads nothing';
end
$$;

rollback;
