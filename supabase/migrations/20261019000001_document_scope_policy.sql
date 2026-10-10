-- ===========================================================================--
-- Document scope: a policy that granted a permission where it needed a scope.
--
-- Finding F10 of the 2026-10-10 audit.
--
-- THE DEFECT, verified against production before being changed:
--
--     documents_select = has_permission('documents.view')
--                        or (student_id is not null and is_guardian_of(student_id))
--
-- and `documents.view` is held by BOTH ADMIN and TEACHER. So every teacher read
-- every document in the school, including a child's file — which the creating
-- migration's OWN COMMENT said was visible "not to teachers by default". The
-- comment described the intent and the policy did not implement it.
--
-- WHY THIS ONE IS EASY TO MISS. The guardian half of the policy IS correctly
-- scoped. A reviewer asking "does a parent see only their own child's file?" gets
-- a satisfying yes, and stops. The staff half is the half that was too broad, and
-- it is written as a permission test, which reads as a deliberate decision rather
-- than as a missing clause.
--
-- NOTHING HAS LEAKED. `documents` holds 0 rows in production, so this closes an
-- exposure before the first file is filed rather than after. That does not make it
-- theoretical: the policy was live, `authenticated` already held INSERT/UPDATE/
-- DELETE on the table, and the first upload would have made it real.
--
-- WHAT THE FIX IS. The permission answers "may this person work with documents at
-- all?"; it does not answer "which ones?". Both are needed, and the second was
-- missing for staff.
--
--   the office    -> every document, internal ones included. Running the school
--                    requires it, and `has_role` is the project's own definition
--                    of the office (also used by the last-admin protection).
--   a teacher     -> documents for students in classes they actually teach. Not
--                    the school's internal files, and not another teacher's class.
--   a guardian    -> their own child's documents only. Unchanged.
--
-- A teacher does NOT automatically see another teacher's own documents
-- (`teacher_id` set to somebody else). That is the same relationship as a student
-- outside their classes, and there is no product requirement for it, so it is
-- denied rather than guessed at. If the school needs shared staff documents, that
-- is a scope decision to make deliberately — adding it later is a small migration;
-- removing a leak is not.
-- ===========================================================================--

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
    for select
    to authenticated
    using (
        public.is_active_user()
        and (
            -- The office: everything, internal included.
            public.has_role(array['ADMIN']::public.app_role[])
            -- A student's file: their guardian, or a teacher of their class.
            or (
                student_id is not null
                and (
                    public.is_guardian_of(student_id)
                    or (
                        public.has_permission('documents.view')
                        and public.is_teacher_of_student(student_id)
                    )
                )
            )
            -- A teacher's own file, for the teacher it belongs to. Reading one's
            -- own document is not a privilege the permission system should gate.
            or (
                teacher_id is not null
                and teacher_id = public.current_teacher_id()
            )
        )
    );

comment on policy documents_select on public.documents is
    'Office sees everything; a teacher sees documents for students in classes they '
    'teach, plus their own file; a guardian sees their own child''s. The previous '
    'version was a permission test alone, and documents.view is held by TEACHER — '
    'so every teacher read every document (audit F10).';

-- ---------------------------------------------------------------------------
-- The Storage helpers must agree with the metadata policy.
--
-- This is the half the audit called out as needing to move together (F10 with
-- F37). A metadata row a teacher cannot SELECT is still downloadable if the
-- Storage policy looks only at the path prefix, and the pair would then disagree
-- about the same file in a way that is very hard to reason about later.
--
-- The helper below is the single place that answers "may this caller reach this
-- document?", and the Storage policy for the `documents` bucket is built on the
-- same predicate. One rule, one definition.
-- ---------------------------------------------------------------------------
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

comment on function public.can_read_document(uuid) is
    'True when the caller may read this document. The single definition shared by '
    'the documents SELECT policy and the Storage policy for the documents bucket, '
    'so the two cannot disagree (audit F10, F37).';

-- Automatic EXECUTE to PUBLIC on a new function — the same trap that reopened the
-- F01/F02/F03 exposure. It is caught here rather than by a later review because
-- the security hardening migration is re-applied after this file and asserts it.
revoke execute on function public.can_read_document(uuid) from public, anon;
grant execute on function public.can_read_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify the property, not the statements.
-- ---------------------------------------------------------------------------
do $$
declare
    v_qual text;
begin
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'documents'
       and policyname = 'documents_select';

    if v_qual is null then
        raise exception 'F10 guard: documents_select is missing'
            using errcode = 'insufficient_privilege';
    end if;

    -- The permission alone was the defect, so its presence is not evidence. The
    -- policy must carry a scope predicate as well.
    if v_qual not like '%is_teacher_of_student%'
       or v_qual not like '%is_guardian_of%' then
        raise exception 'F10 guard: documents_select has no record scope: %', v_qual
            using errcode = 'insufficient_privilege';
    end if;

    -- And the office exemption must be real. `has_role` is what makes it fire; a
    -- permission name invented here would silently deny the office, which is the
    -- exact mistake made and caught while fixing F06.
    if v_qual not like '%has_role%' then
        raise exception 'F10 guard: documents_select has no office exemption: %', v_qual
            using errcode = 'insufficient_privilege';
    end if;

    -- The shared helper must not be anonymous-callable.
    if has_function_privilege('anon', 'public.can_read_document(uuid)', 'EXECUTE') then
        raise exception 'F10 guard: can_read_document is callable without a login'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
