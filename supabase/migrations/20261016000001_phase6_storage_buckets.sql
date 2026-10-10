-- ===========================================================================
-- Phase 6b — the private bucket children's documents live in
-- ===========================================================================
-- Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
--
-- Phase 6 created the `documents` TABLE, which records that a file exists, who
-- it belongs to and what it is. This migration creates the BUCKET the file
-- itself goes into, and the rules for reaching it.
--
-- WHY THIS IS A SEPARATE MIGRATION. Creating a bucket is an operational act with
-- a cost and a start date, not a schema change. Keeping it apart means the
-- tables can exist and be tested while Storage is still switched off, and the
-- school can turn Storage on deliberately rather than as a side effect of
-- running the previous file. It is written and ready; it is not applied until
-- someone decides the school is ready to store files.
--
-- Four rules.
--
-- 1. THE BUCKET IS PRIVATE. `public = false` means no URL works by itself.
--    There is no world-readable path to a child's report, a teacher's document
--    or a fee statement. A file is reached only by a signed URL that expires.
--
-- 2. A FILE'S NAME CARRIES ITS OWNER, AND THE POLICY READS IT. The path
--    convention is `<owner_type>/<owner_id>/<filename>` for a child or a teacher,
--    and `<owner_type>/<filename>` for the school itself, which has no id. The
--    storage policy decides from the path alone, WITHOUT trusting anything the
--    browser says; a guardian's access is read from the family record at the
--    moment of the request.
--
-- 3. A SIZE AND A TYPE CEILING EXIST ON THE BUCKET, not only in the screen. A
--    limit enforced only in the browser is a limit anyone can remove.
--
-- 4. GUARDIANS READ THEIR OWN CHILD'S FILES AND NOTHING ELSE. Not the office's
--    internal notes, not another family, not the bucket listing.
--
-- Note on path naming: Supabase Storage exposes the object path as `name` in
-- `storage.objects`. The first path segment is the owner TYPE, the second is the
-- owner ID. Both are checked.

-- --- The bucket -------------------------------------------------------------
--
-- 25 MB, matching the check constraint on `documents.size_bytes`. If one is
-- changed the other must follow, or a file will be accepted by one and refused
-- by the other.
-- The bucket is created only if it is absent.
--
-- `storage.buckets` is owned by `supabase_storage_admin`, not by the project owner,
-- so an `on conflict do update` needs a role this migration does not have and the
-- whole file fails with "must be owner of table buckets". The bucket already exists
-- in production (private, 25 MB, right MIME list), and a migration that cannot be
-- re-applied is worse than one that skips work already done — so the guard is a
-- plain existence check.
--
-- What the bucket SHOULD be is asserted immediately below, so the settings are
-- still verified on every run rather than only on the first.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
    'srik-documents',
    'srik-documents',
    false,
    26214400,
    array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where not exists (select 1 from storage.buckets where id = 'srik-documents');

-- Whether this file created the bucket or found it, its shape is checked. A
-- migration that silently accepted a PUBLIC bucket because the row already existed
-- would be the worst outcome here.
do $$
declare
    v_public boolean;
    v_limit  bigint;
    v_mimes  text[];
begin
    select public, file_size_limit, allowed_mime_types
      into v_public, v_limit, v_mimes
      from storage.buckets where id = 'srik-documents';

    if v_public is distinct from false then
        raise exception
            'The srik-documents bucket must be private, but it is %',
            case when v_public is null then 'missing' else 'PUBLIC' end
            using errcode = 'insufficient_privilege';
    end if;

    if v_limit is distinct from 26214400 then
        raise exception
            'The srik-documents bucket limit is % but should be 25 MB (26214400)',
            v_limit
            using errcode = 'insufficient_privilege';
    end if;

    if v_mimes is null or array_length(v_mimes, 1) is null then
        raise exception 'The srik-documents bucket accepts any file type'
            using errcode = 'insufficient_privilege';
    end if;
end
$$;

-- --- Reading a file ---------------------------------------------------------

/*
 * The owner type and id encoded in an object's path.
 *
 * The convention is `<owner_type>/<owner_id>/<filename>`. Reading it here keeps
 * the parsing in one place, so every policy agrees on what a path means.
 */
create or replace function public.storage_path_owner(p_name text)
returns table (owner_type text, owner_id uuid)
language sql
immutable
as $$
    select
        split_part(p_name, '/', 1),
        -- Only attempt the cast if the segment looks like a uuid. A malformed
        -- name yields null rather than raising, so a stray object cannot break
        -- every policy that reads a path.
        case
            when split_part(p_name, '/', 2) ~
                 '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(p_name, '/', 2)::uuid
            else null
        end;
$$;

comment on function public.storage_path_owner(text) is
    'Reads the owner type and id from a storage path of the form '
    '<owner_type>/<owner_id>/<filename>. Returns null rather than raising on a '
    'malformed path.';

/*
 * May the caller read this object?
 *
 * Answered from the same rules the rest of the system uses: a child's file is
 * the office's to read, and a guardian's if the child is theirs. The path is
 * parsed here rather than being taken from anything the caller supplies.
 */
-- ---------------------------------------------------------------------------
-- THE ONE ANSWER, keyed by the document ROW.
--
-- This definition is identical to the one introduced for audit F10. It is repeated
-- here because a migration must stand on its own: this file creates the bucket and
-- the Storage policies, and a policy calling a function the file does not define
-- cannot be applied to a fresh database. `create or replace` is idempotent, so
-- defining it twice with the same text is safe — the risk this actually guards
-- against is DIVERGENCE, which is what F37 was.
--
-- `is_teacher_of_student` is defined here only if it does not already exist. It
-- belongs to the access-scope migration (audit F05/F06) which runs LATER in the
-- sequence; without this guard, applying this file first would fail on a fresh
-- database with "function is_teacher_of_student(uuid) does not exist". The later
-- migration then replaces it with the same body.
-- ---------------------------------------------------------------------------
create or replace function public.is_teacher_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.student_enrollments e
          join public.teaching_assignments ta
            on ta.class_id = e.class_id
           and ta.academic_year_id = e.academic_year_id
          join public.teachers t on t.id = ta.teacher_id
         where e.student_id = p_student_id
           and e.status = 'ACTIVE'
           and t.user_id = auth.uid()
    );
$$;

revoke all on function public.is_teacher_of_student(uuid) from public, anon;
grant execute on function public.is_teacher_of_student(uuid) to authenticated;

create or replace function public.can_read_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.documents d
         where d.id = p_document_id
           and public.is_active_user()
           and (
                public.has_role(array['ADMIN']::public.app_role[])
                or (
                    d.student_id is not null
                    and (
                        public.is_guardian_of(d.student_id)
                        or (
                            public.has_permission('documents.view')
                            and public.is_teacher_of_student(d.student_id)
                        )
                    )
                )
                or (d.teacher_id is not null and d.teacher_id = public.current_teacher_id())
           )
    );
$$;

revoke all on function public.can_read_document(uuid) from public, anon;
grant execute on function public.can_read_document(uuid) to authenticated;

create or replace function public.can_read_stored_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_id    uuid;
    v_type  text;
    v_owner uuid;
begin
    -- A FILE is judged by the ROW it belongs to, and the row is judged in exactly
    -- one place: `can_read_document(uuid)`.
    --
    -- This function used to answer the question itself, and its answer was
    -- WEAKER. It returned true for anyone holding `documents.view` — a permission
    -- BOTH ADMIN AND TEACHER hold — before looking at the path at all. A teacher
    -- could therefore open any family's document. The row-level version, added for
    -- audit F10, restricts a teacher to children they actually teach.
    --
    -- So the storage path now resolves to a document row and hands the decision
    -- over. The two answers cannot drift again, because there is only one answer.
    --
    -- The path is `OWNER_TYPE/OWNER_ID/filename` for STUDENT and TEACHER, and
    -- `SCHOOL/filename` for school-level files, which have no document row to
    -- consult and are readable by the office only.
    -- NOTE the second element of the path is the OWNER ID (a student or teacher
    -- id), not a document id. Passing it straight to `can_read_document(uuid)`
    -- looks up the wrong row and finds nothing, which silently refused a guardian
    -- their own child's file — the fixture caught it, not a reading of the code.
    -- So the path is resolved to the DOCUMENT ROW and that row's id is used.
    -- `storage_path_owner` RETURNS TABLE, so its columns are read with SELECT —
    -- `public.storage_path_owner(x).owner_id` is a syntax error in Postgres. The
    -- function is wrapped in a subquery rather than dotted into.
    begin
        select o.owner_type, o.owner_id
          into v_type, v_owner
          from public.storage_path_owner(p_name) o;
    exception when others then
        return false;
    end;

    if v_owner is null then
        -- `SCHOOL/filename` has no owner id and no document row. School-level files
        -- belong to the office.
        return public.has_permission('documents.manage');
    end if;

    -- The row is found the same way the rest of the system finds it: by the stored
    -- key. If several rows claim the same key, the first is used — the unique
    -- constraint on the key makes that unambiguous.
    select d.id into v_id
      from public.documents d
     where d.storage_key = p_name
     limit 1;

    if v_id is null then
        -- A file with no document row is not a document, and an unknown object
        -- must not become readable merely because it was placed in the bucket.
        return false;
    end if;

    return public.can_read_document(v_id);
end;
$$;

comment on function public.can_read_stored_file(text) is
    'Whether the caller may read a stored file, decided from the path and the '
    'family record. A guardian reaches only their own child''s documents.';

revoke all on function public.can_read_stored_file(text) from public, anon;
grant execute on function public.can_read_stored_file(text) to authenticated;

-- A leftover of the old overloading, if this migration has been applied before:
-- the path-keyed rule used to share the name `can_read_document` with a `uuid`
-- parameter. Two overloads where a text literal can coerce to uuid is a trap, so
-- the old signature is removed rather than left to be chosen by accident.
drop function if exists public.can_read_document(p_name text);

-- --- Storage policies -------------------------------------------------------

drop policy if exists srik_documents_read on storage.objects;
create policy srik_documents_read on storage.objects
    for select using (
        bucket_id = 'srik-documents'
        and public.can_read_stored_file(name)
    );

drop policy if exists srik_documents_write on storage.objects;
create policy srik_documents_write on storage.objects
    for insert with check (
        bucket_id = 'srik-documents'
        and public.has_permission('documents.manage')
    );

-- Changing a file in place is refused: a document that is replaced under the
-- same name has no history, and the audit trail would show an edit to a row
-- whose contents are different. A correction is a new file and a new row.
drop policy if exists srik_documents_update on storage.objects;
create policy srik_documents_update on storage.objects
    for update using (false);

drop policy if exists srik_documents_delete on storage.objects;
create policy srik_documents_delete on storage.objects
    for delete using (
        bucket_id = 'srik-documents'
        and public.has_permission('documents.manage')
    );

-- --- Keeping the table and the bucket honest --------------------------------

/*
 * Records a stored file against a document row.
 *
 * Creating the row and uploading the file are two steps that can each half
 * succeed. This function is the second step: it is given the path the upload
 * actually produced, and refuses if the owner recorded in the path does not
 * match the owner recorded in the row. That is what stops a file being filed
 * against the wrong child by a mistyped path.
 */
create or replace function public.attach_document_file(
    p_document_id uuid,
    p_storage_key text,
    p_mime_type   text default null,
    p_size_bytes  bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_doc     public.documents;
    v_type    text;
    v_id      uuid;
    v_expected text;
begin
    if not public.has_permission('documents.manage') then
        raise exception 'You do not have permission to attach a document'
            using errcode = '42501';
    end if;

    select * into v_doc from public.documents where id = p_document_id;
    if v_doc.id is null then
        raise exception 'Document % does not exist', p_document_id
            using errcode = 'no_data_found';
    end if;

    if p_storage_key is null or btrim(p_storage_key) = '' then
        raise exception 'A storage key is required' using errcode = '22023';
    end if;

    select o.owner_type, o.owner_id into v_type, v_id
      from public.storage_path_owner(p_storage_key) o;

    -- The path must point at the same owner the row does. Without this, a
    -- mistyped path files a child's report under another child.
    v_expected := case v_doc.owner_type
                      when 'STUDENT' then v_doc.student_id::text
                      when 'TEACHER' then v_doc.teacher_id::text
                      else null
                  end;

    if v_type is distinct from v_doc.owner_type::text then
        raise exception 'The file path names owner type % but the document is for %',
            coalesce(v_type, '(none)'), v_doc.owner_type
            using errcode = '22023';
    end if;

    if v_expected is not null and v_id::text is distinct from v_expected then
        raise exception 'The file path names owner % but the document belongs to %',
            coalesce(v_id::text, '(none)'), v_expected
            using errcode = '22023';
    end if;

    update public.documents
       set storage_key = p_storage_key,
           mime_type    = coalesce(p_mime_type, mime_type),
           size_bytes   = coalesce(p_size_bytes, size_bytes),
           updated_at   = now()
     where id = p_document_id;

    return jsonb_build_object(
        'id', p_document_id,
        'storage_key', p_storage_key,
        'owner_type', v_doc.owner_type
    );
end;
$$;

comment on function public.attach_document_file(uuid, text, text, bigint) is
    'Records an uploaded file against a document row, refusing if the path '
    'names a different owner than the row. This is what stops a mistyped path '
    'filing one child''s document under another.';

revoke all on function public.attach_document_file(uuid, text, text, bigint) from public;
grant execute on function public.attach_document_file(uuid, text, text, bigint) to authenticated;
