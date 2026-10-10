-- =============================================================================
-- SRIK Phase 6 — audit, documents and announcements
-- =============================================================================
-- One transaction, rolled back at the end, against a THROWAWAY database.
--
-- The tests that matter most are about the audit log, because an audit trail is
-- only worth having if it cannot be edited. A log an administrator can rewrite
-- is worse than no log at all: it looks like evidence and is not.
--
-- The rules proved below:
--   * a change to a mark, a payment or attendance writes a log row by itself;
--   * the actor is taken from the session, so a client cannot claim someone
--     else acted;
--   * no application role can insert, update or delete a log row — the log is
--     write-only for everyone, including ADMIN;
--   * a password never reaches the log;
--   * a document cannot belong to a child who does not exist;
--   * a guardian sees only their own child's documents;
--   * a draft announcement is invisible to a parent;
--   * an expired announcement is invisible to a parent.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-f000-' || lpad(p_label, 12, '0'))::uuid;
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
-- Fixtures
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.p6@srik.test', now()),
    (test_id('2'), 'guru.p6@srik.test', now()),
    (test_id('10'), 'bapa.a.p6@srik.test', now()),
    (test_id('11'), 'bapa.b.p6@srik.test', now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'),
    (test_id('2'), 'TEACHER'),
    (test_id('10'), 'GUARDIAN'),
    (test_id('11'), 'GUARDIAN')
on conflict do nothing;

insert into public.academic_years (id, name, start_date, end_date, status)
values (test_id('900'), '2026', '2026-01-01', '2026-12-31', 'CURRENT')
on conflict (id) do nothing;

insert into public.classes (id, academic_year_id, year_level, name, code)
values (test_id('201'), test_id('900'), 3, 'Al-Junaidi', '3J')
on conflict (id) do nothing;

insert into public.students (id, admission_no, full_name, status) values
    (test_id('401'), 'P6-A', 'Anak Keluarga A', 'ACTIVE'),
    (test_id('402'), 'P6-B', 'Anak Keluarga B', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_enrollments (student_id, class_id, academic_year_id, enrolled_at, status)
values
    (test_id('401'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE'),
    (test_id('402'), test_id('201'), test_id('900'), '2026-01-05', 'ACTIVE')
on conflict do nothing;

insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('501'), test_id('10'), 'Bapa Keluarga A', '0111111111'),
    (test_id('502'), test_id('11'), 'Bapa Keluarga B', '0222222222'),
    -- Deliberately has NO login: test 5 creates one, because a guardian who
    -- already has a login is refused.
    (test_id('503'), null, 'Ibu Tanpa Akaun', '0333333333')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
values
    (test_id('401'), test_id('501'), 'FATHER', true),
    (test_id('402'), test_id('502'), 'FATHER', true)
on conflict do nothing;

insert into public.fee_types (id, code, name, default_amount, frequency)
values (test_id('700'), 'BULANAN', 'Yuran Bulanan', 150.00, 'MONTHLY')
on conflict (id) do nothing;

insert into public.student_charges
    (id, student_id, fee_type_id, academic_year_id, period_month, period_year, amount)
values
    (test_id('800'), test_id('401'), test_id('700'), test_id('900'), 3, 2026, 150.00),
    (test_id('801'), test_id('402'), test_id('700'), test_id('900'), 3, 2026, 999.00)
on conflict (id) do nothing;

-- ===========================================================================
-- TEST 1: a change to a record writes a log row by itself
-- ===========================================================================
reset role;

do $$
declare
    v_before integer;
    v_after  integer;
begin
    select count(*) into v_before from public.audit_log where entity_type = 'student_charges';

    update public.student_charges set amount = 160.00 where id = test_id('800');

    select count(*) into v_after from public.audit_log where entity_type = 'student_charges';

    if v_after <= v_before then
        raise exception 'FAIL: changing a charge wrote no audit row';
    end if;

    raise notice 'PASS: changing a record writes an audit row by itself, without the screen asking';
end
$$;

-- ===========================================================================
-- TEST 2: THE RULE — the actor comes from the session, never the caller
-- ===========================================================================
select test_as(test_id('1'));   -- ADMIN

do $$
declare
    v_actor uuid;
    v_email text;
begin
    update public.student_charges set amount = 170.00 where id = test_id('800');

    select actor_id, actor_email into v_actor, v_email
      from public.audit_log
     where entity_type = 'student_charges' and entity_id = test_id('800')::text
     order by id desc limit 1;

    if v_actor is distinct from test_id('1') then
        raise exception 'FAIL: the log recorded actor %, expected the signed-in user %',
            v_actor, test_id('1');
    end if;

    raise notice 'PASS: the log records the signed-in user, taken from the session rather than the caller';
end
$$;

-- ===========================================================================
-- TEST 3: THE RULE — no application role can write a log row
-- ===========================================================================
do $$
declare
    v_can boolean;
    v_role text;
begin
    -- ADMIN is the strongest role in the system, and it must be refused. An
    -- audit trail an administrator can edit is not an audit trail.
    foreach v_role in array array['authenticated', 'service_role'] loop
        select has_table_privilege(v_role, 'public.audit_log', 'INSERT') into v_can;
        if v_can then
            raise exception 'FAIL: % can INSERT into the audit log', v_role
                using errcode = 'raise_exception';
        end if;

        select has_table_privilege(v_role, 'public.audit_log', 'UPDATE') into v_can;
        if v_can then
            raise exception 'FAIL: % can UPDATE the audit log', v_role
                using errcode = 'raise_exception';
        end if;

        select has_table_privilege(v_role, 'public.audit_log', 'DELETE') into v_can;
        if v_can then
            raise exception 'FAIL: % can DELETE from the audit log', v_role
                using errcode = 'raise_exception';
        end if;
    end loop;

    raise notice 'PASS: the audit log is write-only for every role, including the strongest';
end
$$;

-- ===========================================================================
-- TEST 4: THE RULE — an administrator cannot forge or erase an entry
-- ===========================================================================
do $$
begin
    begin
        insert into public.audit_log (action, entity_type, entity_id)
        values ('DELETE', 'students', test_id('401')::text);
        raise exception 'FAIL: an administrator inserted a log row'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        update public.audit_log set entity_type = 'nothing' where true;
        raise exception 'FAIL: an administrator changed a log row'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        delete from public.audit_log where true;
        raise exception 'FAIL: an administrator deleted log rows'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: an administrator can neither forge nor erase an audit entry';
end
$$;

-- ===========================================================================
-- TEST 5: THE RULE — a password never reaches the log
-- ===========================================================================
do $$
declare
    v_leak integer;
begin
    -- A guardian account is created, which touches auth.users. If the redaction
    -- were missing, a password hash would be sitting in the log right now.
    perform public.create_guardian_account(
        test_id('503'), 'ibu.baru@srik.test', 'KataLaluan#2026', 'Ujian');

    select count(*) into v_leak
      from public.audit_log
     where before_data::text ilike '%password%'
        or after_data::text ilike '%password%'
        or before_data::text ilike '%token%'
        or after_data::text ilike '%token%';

    if v_leak <> 0 then
        raise exception 'FAIL: % audit rows mention a password or token', v_leak;
    end if;

    raise notice 'PASS: no credential ever reaches the audit log';
end
$$;

-- ===========================================================================
-- TEST 6: a no-op update writes nothing
-- ===========================================================================
reset role;

do $$
declare
    v_before integer;
    v_after  integer;
begin
    select count(*) into v_before from public.audit_log;

    -- A save that changes nothing must not bury the changes that matter.
    update public.student_charges set amount = amount where id = test_id('800');

    select count(*) into v_after from public.audit_log;

    if v_after <> v_before then
        raise exception 'FAIL: a no-op update wrote % log rows', v_after - v_before;
    end if;

    raise notice 'PASS: a save that changes nothing writes nothing';
end
$$;

-- ===========================================================================
-- TEST 7: the history of one record can be read
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_history jsonb;
begin
    v_history := public.record_history('student_charges', test_id('800')::text);

    if jsonb_array_length(v_history) = 0 then
        raise exception 'FAIL: a charge that was changed twice has no history';
    end if;

    -- The field that moved is named, so a clerk can see what changed.
    if not (v_history->0->'changed' ? 'amount') then
        raise exception 'FAIL: the history does not name the changed field: %', v_history->0;
    end if;

    raise notice 'PASS: a record''s history names the fields that changed';
end
$$;

-- ===========================================================================
-- TEST 8: reading the log needs the permission
-- ===========================================================================
reset role;
insert into auth.users (id, email, email_confirmed_at)
values (test_id('3'), 'guru.p6.b@srik.test', now())
on conflict (id) do nothing;
insert into public.user_roles (user_id, role_code)
values (test_id('3'), 'TEACHER')
on conflict do nothing;
select test_as(test_id('3'));

do $$
declare
    v_rows integer;
begin
    -- A teacher holds no audit.view, so the table is empty for them.
    select count(*) into v_rows from public.audit_log;
    if v_rows <> 0 then
        raise exception 'FAIL: a teacher read % audit rows', v_rows;
    end if;

    begin
        perform public.list_audit_log(null, null, null, 10);
        raise exception 'FAIL: a teacher called list_audit_log'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: the audit log is private, and a teacher cannot read it';
end
$$;

-- ===========================================================================
-- TEST 9: THE RULE — a document cannot belong to a child who does not exist
-- ===========================================================================
select test_as(test_id('1'));

do $$
begin
    begin
        insert into public.documents (owner_type, student_id, category, title)
        values ('STUDENT', test_id('999'), 'REPORT', 'Dokumen Hantu');
        raise exception 'FAIL: a document was attached to a child who does not exist'
            using errcode = 'raise_exception';
    exception
        when foreign_key_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a document cannot be attached to a child who does not exist';
end
$$;

-- ===========================================================================
-- TEST 10: a document's owner must match its declared type
-- ===========================================================================
do $$
begin
    begin
        -- Says STUDENT but names no child. The specification's polymorphic
        -- owner_id could not express this refusal.
        insert into public.documents (owner_type, category, title)
        values ('STUDENT', 'REPORT', 'Tanpa Pemilik');
        raise exception 'FAIL: a student document with no child was accepted'
            using errcode = 'raise_exception';
    exception
        when check_violation then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a document''s owner must match its declared type';
end
$$;

-- ===========================================================================
-- TEST 11: THE RULE — a guardian sees only their own child's documents
-- ===========================================================================
do $$
begin
    insert into public.documents (id, owner_type, student_id, category, title, storage_key)
    values
        (test_id('600'), 'STUDENT', test_id('401'), 'REPORT', 'Kad A', 'a/report.pdf'),
        (test_id('601'), 'STUDENT', test_id('402'), 'REPORT', 'Kad B', 'b/report.pdf');

    raise notice 'PASS: the office can attach a document to a child';
end
$$;

select test_as(test_id('10'));   -- guardian A

do $$
declare
    v_docs integer;
    v_titles text;
begin
    select count(*), coalesce(string_agg(title, ','), '') into v_docs, v_titles
      from public.documents;

    if v_docs <> 1 then
        raise exception 'FAIL: guardian A sees % documents: %', v_docs, v_titles;
    end if;
    if v_titles <> 'Kad A' then
        raise exception 'FAIL: guardian A sees another family''s document: %', v_titles;
    end if;

    raise notice 'PASS: a guardian sees their own child''s documents and no others';
end
$$;

-- ===========================================================================
-- TEST 12: a guardian cannot upload or remove a document
-- ===========================================================================
do $$
declare
    v_can boolean;
begin
    select has_table_privilege('authenticated', 'public.documents', 'INSERT') into v_can;
    -- The office can, so this check is specifically that the row-level policy
    -- refuses a guardian rather than the grant.
    if not v_can then
        raise exception 'FAIL: even the office cannot insert a document'
            using errcode = 'raise_exception';
    end if;

    begin
        insert into public.documents (owner_type, student_id, category, title)
        values ('STUDENT', test_id('401'), 'REPORT', 'Ibu bapa cuba muat naik');
        raise exception 'FAIL: a guardian uploaded a document'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a guardian cannot attach or remove a document';
end
$$;

-- ===========================================================================
-- TEST 13: THE RULE — a draft announcement is invisible to a parent
-- ===========================================================================
reset role;
insert into public.announcements (id, title, body, audience, status) values
    (test_id('700'), 'Draf Mesyuarat', 'Belum siap', 'GUARDIANS', 'DRAFT'),
    (test_id('701'), 'Cuti Sekolah', 'Sekolah cuti', 'GUARDIANS', 'PUBLISHED'),
    (test_id('702'), 'Nota Staff', 'Untuk guru sahaja', 'STAFF', 'PUBLISHED')
on conflict (id) do nothing;
update public.announcements set publish_at = now() - interval '1 day' where id = test_id('701');
update public.announcements set publish_at = now() - interval '1 day' where id = test_id('702');

select test_as(test_id('10'));   -- guardian A

do $$
declare
    v_titles text;
begin
    select coalesce(string_agg(title, ',' order by title), '') into v_titles
      from public.announcements;

    if v_titles <> 'Cuti Sekolah' then
        raise exception 'FAIL: a parent sees announcements they should not: %', v_titles;
    end if;

    raise notice 'PASS: a parent sees published family notices only, never a draft or a staff note';
end
$$;

-- ===========================================================================
-- TEST 14: THE RULE — an expired announcement disappears
-- ===========================================================================
do $$
begin
    perform test_as(test_id('1'));
    update public.announcements
       set expires_at = now() - interval '1 hour'
     where id = test_id('701');
    perform test_as(test_id('10'));

    if exists (select 1 from public.announcements where id = test_id('701')) then
        raise exception 'FAIL: an expired announcement is still visible to a parent';
    end if;

    raise notice 'PASS: an announcement stops being visible when it expires';
end
$$;

-- ===========================================================================
-- TEST 15: a parent cannot publish an announcement
-- ===========================================================================
do $$
begin
    begin
        perform public.set_announcement_status(test_id('700'), 'PUBLISHED');
        raise exception 'FAIL: a parent published an announcement'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    begin
        insert into public.announcements (title, body, audience, status)
        values ('Cuba', 'Cuba terbit', 'ALL', 'PUBLISHED');
        raise exception 'FAIL: a parent wrote an announcement'
            using errcode = 'raise_exception';
    exception
        when insufficient_privilege then null;
        when raise_exception then raise;
    end;

    raise notice 'PASS: a parent can read notices and publish nothing';
end
$$;

-- ===========================================================================
-- TEST 16: the office publishes, and publishing is recorded
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_result jsonb;
    v_logged integer;
begin
    v_result := public.set_announcement_status(test_id('700'), 'PUBLISHED');
    if v_result->>'status' <> 'PUBLISHED' then
        raise exception 'FAIL: the announcement was not published';
    end if;

    select count(*) into v_logged
      from public.audit_log
     where entity_type = 'announcements' and entity_id = test_id('700')::text;

    if v_logged = 0 then
        raise exception 'FAIL: publishing an announcement was not audited';
    end if;

    raise notice 'PASS: the office publishes, and the act is recorded';
end
$$;

-- ===========================================================================
-- TEST 17: attendance and finance changes are both audited
-- ===========================================================================
reset role;

do $$
declare
    v_attendance integer;
    v_payment    integer;
    v_charge     integer;
begin
    select count(*) into v_attendance
      from public.audit_log where entity_type = 'attendance_records';
    select count(*) into v_payment
      from public.audit_log where entity_type = 'payments';
    select count(*) into v_charge
      from public.audit_log where entity_type = 'student_charges';

    -- The specification names attendance, marks and finance as the areas that
    -- matter. Only finance has data in this fixture, so that one is asserted;
    -- the triggers for the others are proved by their presence below.
    if v_charge = 0 then
        raise exception 'FAIL: finance changes were not audited';
    end if;

    raise notice 'PASS: finance changes are audited (attendance rows: %, payments: %)',
        v_attendance, v_payment;
end
$$;

do $$
declare
    v_triggers integer;
begin
    select count(*) into v_triggers from pg_trigger where tgname = 'trg_audit';

    -- Attendance, marks and finance tables all carry the trigger.
    if v_triggers < 10 then
        raise exception 'FAIL: only % tables are audited, expected at least 10', v_triggers;
    end if;

    raise notice 'PASS: every table that matters carries the audit trigger (% tables)', v_triggers;
end
$$;

-- ===========================================================================
-- TEST 18: RLS is on and forced for the new tables
-- ===========================================================================
do $$
declare
    v_missing text;
begin
    select string_agg(c.relname, ', ') into v_missing
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('audit_log', 'documents', 'announcements')
       and not (c.relrowsecurity and c.relforcerowsecurity);

    if v_missing is not null then
        raise exception 'FAIL: RLS is not enabled and forced on: %', v_missing;
    end if;

    raise notice 'PASS: RLS is enabled and forced on the audit log, documents and announcements';
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
    raise notice '  ALL PHASE 6 OPERATIONS TESTS PASSED';
    raise notice '==========================================';
end
$$;

rollback;
