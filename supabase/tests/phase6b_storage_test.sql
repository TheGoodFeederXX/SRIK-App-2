-- =============================================================================
-- SRIK Phase 6b — the private bucket, and who may reach a child's file
-- =============================================================================
-- The document TABLE was proved in Phase 6. This suite proves the BUCKET: that
-- it is private, that a path is checked against the family record, and that the
-- path cannot be used to file one child's document under another.
--
-- The rules proved below:
--   * the bucket is not public, and neither is any object in it;
--   * a guardian can read their own child's file and no other family's;
--   * a guardian cannot read the office's internal file, whatever its path;
--   * a guardian cannot upload, replace or delete anything;
--   * a malformed path grants nothing rather than raising;
--   * a file cannot be attached to a document belonging to a different child.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-9b00-' || lpad(p_label, 12, '0'))::uuid;
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

-- ---------------------------------------------------------------------------
-- Fixtures: two families, plus an office user
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p6b@srik.test', now()),
    (test_id('10'), 'bapa.a.p6b@srik.test', now()),
    (test_id('11'), 'bapa.b.p6b@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'), (test_id('10'), 'GUARDIAN'), (test_id('11'), 'GUARDIAN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P6B-A', 'Anak Keluarga A', 'ACTIVE'),
    (test_id('402'), 'P6B-B', 'Anak Keluarga B', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('401'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('501'), test_id('10'), 'Bapa Keluarga A', '0111111111'),
    (test_id('502'), test_id('11'), 'Bapa Keluarga B', '0222222222')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
    (test_id('401'), test_id('501'), 'FATHER', true),
    (test_id('402'), test_id('502'), 'FATHER', true)
on conflict do nothing;

-- Document rows, one per family, and one belonging to the school.
insert into public.documents (id, owner_type, student_id, category, title, storage_key)
values
    (test_id('600'), 'STUDENT', test_id('401'), 'REPORT', 'Kad A',
     'STUDENT/' || test_id('401')::text || '/kad.pdf'),
    (test_id('601'), 'STUDENT', test_id('402'), 'REPORT', 'Kad B',
     'STUDENT/' || test_id('402')::text || '/kad.pdf'),
    (test_id('602'), 'SCHOOL', null, 'POLICY', 'Polisi Dalaman',
     'SCHOOL/dasar.pdf')
on conflict (id) do nothing;

-- The files themselves, in the bucket.
--
-- `reset role` is repeated here deliberately. The storage policies are live from
-- the moment the migration runs, so a fixture inserted while any non-owner role
-- is still in effect is REFUSED — and `on conflict do nothing` would then hide
-- the refusal as a missing row. That is exactly how this suite first reported a
-- guardian deleting a file that was never there.
reset role;

insert into storage.objects (bucket_id, name) values
    ('srik-documents', 'STUDENT/' || test_id('401')::text || '/kad.pdf'),
    ('srik-documents', 'STUDENT/' || test_id('402')::text || '/kad.pdf'),
    ('srik-documents', 'SCHOOL/dasar.pdf'),
    ('srik-documents', 'STUDENT/not-a-uuid/kad.pdf');

-- If the bucket did not receive all four, say so now rather than letting a later
-- count fail for a reason that looks like something else.
do $$
declare v_count integer;
begin
    select count(*) into v_count from storage.objects;
    if v_count <> 4 then
        raise exception 'FAIL: fixture expected 4 stored files, found %', v_count;
    end if;
end
$$;

-- ===========================================================================
-- TEST 1: THE RULE — the bucket is private
-- ===========================================================================
reset role;

do $$
declare
    v_public boolean;
begin
    select public into v_public from storage.buckets where id = 'srik-documents';

    if v_public is null then
        raise exception 'FAIL: the bucket srik-documents does not exist';
    end if;
    if v_public then
        raise exception 'FAIL: the bucket is PUBLIC — a child''s file would be '
            'readable by anyone with the URL';
    end if;

    raise notice 'PASS: the bucket is private, so no URL works on its own';
end
$$;

-- ===========================================================================
-- TEST 2: the bucket has a size and a type ceiling
-- ===========================================================================
do $$
declare
    v_size  bigint;
    v_types text[];
begin
    select file_size_limit, allowed_mime_types into v_size, v_types
      from storage.buckets where id = 'srik-documents';

    if v_size is null or v_size <> 26214400 then
        raise exception 'FAIL: the bucket size limit is %, expected 25 MB', v_size;
    end if;
    if v_types is null or array_length(v_types, 1) is null then
        raise exception 'FAIL: the bucket accepts any file type';
    end if;

    raise notice 'PASS: the ceiling is on the bucket itself, not only in the screen';
end
$$;

-- ===========================================================================
-- TEST 3: THE RULE — a guardian reads their own child's file
-- ===========================================================================
select test_as(test_id('10'));   -- guardian A

do $$
declare
    v_names text;
begin
    select coalesce(string_agg(name, ' | ' order by name), '') into v_names
      from storage.objects;

    -- Exactly one file: their own child's.
    if v_names <> 'STUDENT/' || test_id('401')::text || '/kad.pdf' then
        raise exception 'FAIL: guardian A can read: %', v_names;
    end if;

    raise notice 'PASS: a guardian reads their own child''s file and no other family''s';
end
$$;

-- ===========================================================================
-- TEST 4: THE RULE — a guardian cannot read the office's internal file
-- ===========================================================================
do $$
begin
    if exists (select 1 from storage.objects where name = 'SCHOOL/dasar.pdf') then
        raise exception 'FAIL: a guardian can read a school-only document';
    end if;

    raise notice 'PASS: a guardian cannot reach a school-only document';
end
$$;

-- ===========================================================================
-- TEST 5: THE RULE — a guardian cannot upload, replace or delete
-- ===========================================================================
do $$
begin
    -- An upload is refused loudly: the INSERT policy names documents.manage,
    -- which a guardian does not hold.
    begin
        insert into storage.objects (bucket_id, name)
        values ('srik-documents', 'STUDENT/' || test_id('401')::text || '/palsu.pdf');
        raise exception 'FAIL: a guardian uploaded a file'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    -- A guardian cannot even see another family's rows, so a delete here matches
    -- nothing. That is the policy working, not a gap: the rows are invisible, so
    -- there is nothing to remove. `DELETE 0` is the expected result.
    raise notice 'PASS: a guardian cannot upload a file';
end
$$;

-- The delete is attempted at the TOP LEVEL, in the guardian's own session, and
-- then counted at the top level as the office. Switching identity twice INSIDE
-- one plpgsql block does not reliably change which role the block's later
-- statements run as, and an earlier version of this test was fooled by exactly
-- that into reporting a leak the policy does not have.
select test_as(test_id('10'));   -- guardian A

delete from storage.objects where bucket_id = 'srik-documents';

select test_as(test_id('1'));   -- back to the office, where every row is visible

do $$
declare
    v_remaining integer;
    v_names     text;
begin
    select count(*), coalesce(string_agg(name, ' | ' order by name), '')
      into v_remaining, v_names
      from storage.objects;

    -- Counted as the office, where every row is visible. This is what "the
    -- guardian removed nothing" actually means; from inside a guardian's own
    -- session the rows are invisible, so a count there proves nothing. The
    -- names are reported so a failure says WHICH file went missing.
    if v_remaining <> 4 then
        raise exception 'FAIL: % of 4 files remain: %', v_remaining, v_names;
    end if;

    raise notice 'PASS: the guardian''s delete attempt removed nothing — all 4 files remain';
end
$$;

-- ===========================================================================
-- TEST 6: a malformed path grants a guardian nothing, and does not raise
-- ===========================================================================
select test_as(test_id('10'));   -- guardian A
do $$
declare
    v_result boolean;
begin
    -- A path whose second segment is not a uuid must be refused quietly. If it
    -- raised, one stray object in the bucket would break the policy for every
    -- request in the system.
    v_result := public.can_read_stored_file('STUDENT/not-a-uuid/kad.pdf');
    if v_result then
        raise exception 'FAIL: a guardian was granted a malformed path';
    end if;

    v_result := public.can_read_stored_file('');
    if v_result then
        raise exception 'FAIL: a guardian was granted an empty path';
    end if;

    raise notice 'PASS: a malformed path grants a guardian nothing and breaks nothing';
end
$$;

-- ===========================================================================
-- TEST 7: the office can read every document
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_count integer;
begin
    select count(*) into v_count from storage.objects;

    if v_count <> 4 then
        raise exception 'FAIL: the office sees % of 4 files', v_count;
    end if;

    raise notice 'PASS: the office reaches every file, its own and the families''';
end
$$;

-- ===========================================================================
-- TEST 8: THE RULE — a file cannot be filed under a different child
-- ===========================================================================
do $$
begin
    begin
        -- Document 600 belongs to child 401, but the path names 402. Without
        -- this check, a mistyped path silently files one child's report under
        -- another — a data leak that no screen would show.
        perform public.attach_document_file(
            test_id('600'),
            'STUDENT/' || test_id('402')::text || '/kad.pdf'
        );
        raise exception 'FAIL: a file was attached to the wrong child'
            using errcode = 'raise_exception';
    exception
        when sqlstate '22023' then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a file cannot be filed under a different child';
end
$$;

-- ===========================================================================
-- TEST 9: a file cannot be attached under a different owner TYPE
-- ===========================================================================
do $$
begin
    begin
        perform public.attach_document_file(test_id('602'), 'STUDENT/anything/kad.pdf');
        raise exception 'FAIL: a school document accepted a student path'
            using errcode = 'raise_exception';
    exception
        when sqlstate '22023' then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a file cannot be attached under a different owner type';
end
$$;

-- ===========================================================================
-- TEST 10: a matching path is accepted
-- ===========================================================================
do $$
declare
    v_result jsonb;
begin
    v_result := public.attach_document_file(
        test_id('600'),
        'STUDENT/' || test_id('401')::text || '/kad-baharu.pdf',
        'application/pdf',
        12345
    );

    if v_result->>'storage_key' <> 'STUDENT/' || test_id('401')::text || '/kad-baharu.pdf' then
        raise exception 'FAIL: the file was not recorded: %', v_result;
    end if;

    raise notice 'PASS: a correctly addressed file is recorded against its document';
end
$$;

-- ===========================================================================
-- TEST 11: attaching is audited
-- ===========================================================================
do $$
declare
    v_logged integer;
begin
    select count(*) into v_logged
      from public.audit_log
     where entity_type = 'documents' and entity_id = test_id('600')::text;

    if v_logged = 0 then
        raise exception 'FAIL: attaching a file was not audited';
    end if;

    raise notice 'PASS: attaching a file is recorded in the audit trail';
end
$$;

-- ===========================================================================
-- TEST 12: a guardian cannot attach a file either
-- ===========================================================================
select test_as(test_id('10'));

do $$
begin
    begin
        perform public.attach_document_file(
            test_id('600'), 'STUDENT/' || test_id('401')::text || '/x.pdf');
        raise exception 'FAIL: a guardian attached a file'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a guardian cannot record a file attachment';
end
$$;

-- ===========================================================================
-- Summary
-- ===========================================================================
reset role;
do $$
begin
    raise notice '';
    raise notice '==========================================';
    raise notice '  ALL PHASE 6B STORAGE TESTS PASSED';
    raise notice '==========================================';
end
$$;

rollback;
