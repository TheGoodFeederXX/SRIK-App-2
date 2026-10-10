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
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
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
)
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

comment on table storage.buckets is
    'Private storage. srik-documents holds files attached to children and '
    'teachers; it is never public, and every read goes through a signed URL.';

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
create or replace function public.can_read_document(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_type text;
    v_id   uuid;
begin
    select o.owner_type, o.owner_id into v_type, v_id
      from public.storage_path_owner(p_name) o;

    -- A SCHOOL document has no owner id: its path is `SCHOOL/<filename>`, two
    -- segments, so the second is the file name and not a uuid. Treating a null
    -- id as "malformed" made the office unable to read its own school-level
    -- files — a bug this test caught. School files are the office's, so they are
    -- allowed here and go no further.
    -- THE OFFICE IS CHECKED FIRST, before the path is judged at all.
    --
    -- A malformed or unexpected name used to be rejected before this check, so
    -- a single oddly-named object became invisible to the very people
    -- responsible for it — the office. Whether a name makes sense is a question
    -- about how a file is filed; whether the office may read it is a question
    -- about authority, and authority comes first.
    if public.has_permission('documents.view') then
        return true;
    end if;

    -- A school document has no owner id: its path is `SCHOOL/<filename>`, two
    -- segments. A guardian never reaches these.
    if v_type = 'SCHOOL' then
        return false;
    end if;

    if v_type is null or v_id is null then
        return false;
    end if;

    -- A guardian reaches only their own child's files.
    if v_type = 'STUDENT' and public.is_guardian_of(v_id) then
        return true;
    end if;

    return false;
end;
$$;

comment on function public.can_read_document(text) is
    'Whether the caller may read a stored file, decided from the path and the '
    'family record. A guardian reaches only their own child''s documents.';

revoke all on function public.can_read_document(text) from public;
grant execute on function public.can_read_document(text) to authenticated;

-- --- Storage policies -------------------------------------------------------

drop policy if exists srik_documents_read on storage.objects;
create policy srik_documents_read on storage.objects
    for select using (
        bucket_id = 'srik-documents'
        and public.can_read_document(name)
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
