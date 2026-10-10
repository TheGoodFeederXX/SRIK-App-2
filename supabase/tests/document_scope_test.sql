-- Guard tests for audit finding F10 — internal documents read outside scope.
--
-- THE DEFECT. `documents_select` was:
--
--     has_permission('documents.view') or (student_id is not null and is_guardian_of(student_id))
--
-- and `documents.view` is held by BOTH ADMIN and TEACHER. So every teacher read
-- every document in the school — including a child's file, which the migration's
-- OWN COMMENT said was visible "not to teachers by default". The comment described
-- the intent; the policy did not implement it. That gap is the finding.
--
-- It is worth being precise about WHY this is easy to miss: the guardian half of
-- the policy IS correctly scoped, so a reviewer checking "does a parent see only
-- their own child's file?" gets a satisfying yes. The staff half is the one that
-- was too broad, and it is written as a permission test, which reads as
-- intentional rather than as a missing clause.
--
-- DOCUMENTS ARE EMPTY IN PRODUCTION (0 rows), so nothing has leaked yet. This is
-- a fix applied before the first document is filed rather than after — but the
-- policy was live, and `documents` already had INSERT/UPDATE/DELETE granted to
-- `authenticated`, so the exposure was real and would have taken effect on the
-- first upload. A defect that has not yet caused harm is still a defect.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e100-' || lpad(p_label, 12, '0'))::uuid;
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

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.doc@srik.test', now()),
    (test_id('2'), 'guru.doc@srik.test', now()),
    (test_id('10'), 'bapa.doc@srik.test', now())
on conflict (id) do nothing;

-- `do update` rather than `do nothing`: an earlier suite in the same database may
-- already own this id, and a silently skipped conflicting insert would leave the
-- fixture in the wrong state — which is exactly how an earlier test in this
-- repository passed for the wrong reason.
insert into public.profiles (id, full_name, status) values
    (test_id('1'), 'Pentadbir Dokumen', 'ACTIVE'),
    (test_id('2'), 'Guru Dokumen', 'ACTIVE'),
    (test_id('10'), 'Bapa Dokumen', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'), (test_id('2'), 'TEACHER'), (test_id('10'), 'GUARDIAN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

-- TWO classes, so "teaches this child" and "teaches another child" are different
-- rows rather than the same row read twice.
insert into public.classes (id, academic_year_id, year_level, name, code, status) values
    (test_id('700'), test_id('900'), 1, '1 Al-Junaidi', '1J', 'ACTIVE'),
    (test_id('701'), test_id('900'), 2, '2 Al-Junaidi', '2J', 'ACTIVE')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'D-001', 'Anak Kelas Saya', 'MALE', 'ACTIVE'),
    (test_id('402'), 'D-002', 'Anak Kelas Lain', 'FEMALE', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.student_enrollments
    (id, student_id, class_id, academic_year_id, enrolled_at, status) values
    (test_id('501'), test_id('401'), test_id('700'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('502'), test_id('402'), test_id('701'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

-- The teacher of class 700 only.
insert into public.teachers (id, user_id, staff_code, full_name, status)
values (test_id('801'), test_id('2'), 'G-DOC', 'Guru Dokumen', 'ACTIVE')
on conflict (id) do nothing;

insert into public.teaching_assignments
    (id, teacher_id, class_id, academic_year_id, assignment_type, status)
values (test_id('850'), test_id('801'), test_id('700'), test_id('900'), 'CLASS_TEACHER', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

insert into public.guardians (id, user_id, full_name, phone)
values (test_id('601'), test_id('10'), 'Bapa Dokumen', '019')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values (test_id('401'), test_id('601'), 'FATHER', true)
on conflict do nothing;

-- A document for a child in the teacher's class, one for a child who is not, and
-- one that belongs to the school rather than to any child.
insert into public.documents (id, owner_type, student_id, category, title, storage_key, uploaded_by)
values
    (test_id('901'), 'STUDENT', test_id('401'), 'SIJIL', 'Sijil anak kelas saya',
     'students/' || test_id('401') || '/sijil.pdf', test_id('1')),
    (test_id('902'), 'STUDENT', test_id('402'), 'SIJIL', 'Sijil anak kelas lain',
     'students/' || test_id('402') || '/sijil.pdf', test_id('1')),
    (test_id('903'), 'SCHOOL', null, 'DASAR', 'Dasar dalaman sekolah',
     'school/dasar.pdf', test_id('1'))
on conflict (id) do update set category = excluded.category;

-- ===========================================================================
-- F10a: a teacher must not read a document belonging to a child they do not teach.
-- ===========================================================================
select test_as(test_id('2'));  -- TEACHER of class 700

do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.documents where id = test_id('902');
    if v_seen > 0 then
        raise exception 'FAIL F10: a teacher read a document for a student they do not teach'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher cannot read another class''s student document';
end
$$;

-- ===========================================================================
-- F10b: a teacher must not read school-internal documents either.
-- ===========================================================================
do $$
declare
    v_seen integer;
begin
    select count(*) into v_seen from public.documents where id = test_id('903');
    if v_seen > 0 then
        raise exception 'FAIL F10: a teacher read a school-internal document'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher cannot read a school-internal document';
end
$$;

-- ===========================================================================
-- REQUIRED FOR F10 TO BE A FIX RATHER THAN A LOCKOUT.
--
-- A policy that denied teachers everything would also pass the two checks above —
-- and would break the product. These assert the halves that MUST keep working.
-- ===========================================================================
do $$
declare
    v_seen integer;
begin
    -- Their own class's student: expected.
    select count(*) into v_seen from public.documents where id = test_id('901');
    if v_seen <> 1 then
        raise exception 'FAIL F10: a teacher could not read their own student''s document'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a teacher still reads their own student''s documents';
end
$$;

reset role;
select test_as(test_id('1'));  -- ADMIN

do $$
declare
    v_seen integer;
begin
    -- The office must reach every document, including the internal one: running
    -- the school requires it, and a fix that broke this would be rejected.
    select count(*) into v_seen from public.documents
     where id in (test_id('901'), test_id('902'), test_id('903'));
    if v_seen <> 3 then
        raise exception 'FAIL F10: the admin lost sight of documents (% of 3)', v_seen
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the admin still reaches every document, internal included';
end
$$;

reset role;
select test_as(test_id('10'));  -- GUARDIAN

do $$
declare
    v_seen integer;
begin
    -- Their own child: still visible, unchanged by this fix.
    select count(*) into v_seen from public.documents where id = test_id('901');
    if v_seen <> 1 then
        raise exception 'FAIL F10: a guardian could not read their own child''s document'
            using errcode = 'raise_exception';
    end if;

    -- Another child, and the school-internal file: neither.
    select count(*) into v_seen from public.documents
     where id in (test_id('902'), test_id('903'));
    if v_seen > 0 then
        raise exception 'FAIL F10: a guardian read another family''s or the school''s document'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a guardian reads only their own child''s documents';
end
$$;

rollback;
