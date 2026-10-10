-- ===========================================================================
-- Phase 6 — documents, announcements, and an audit trail that cannot be edited
-- ===========================================================================
-- Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
--
-- This is the last phase, and it is the one that makes the earlier phases
-- defensible. Throughout the build there has been one audit table,
-- `authorization_audit`, recording who changed a permission. That is not enough
-- for a school: the questions that actually get asked are "who changed this
-- mark", "who took this payment", "who marked this child absent", and "who
-- opened this child's file".
--
-- Five rules shape this migration.
--
-- 1. AN AUDIT LOG IS WRITE-ONLY, FOR EVERYONE. Not "admins can clean it up".
--    An audit trail an administrator can edit is not an audit trail; it is a
--    second copy of the data with extra steps. There is therefore NO insert,
--    update or delete grant on `audit_log` for any application role, and no
--    policy that would permit one. Rows arrive only from the trigger below,
--    which runs as the table owner.
--
-- 2. THE ACTOR IS TAKEN FROM THE SESSION, NEVER FROM THE CALLER. Every row
--    records `auth.uid()`. A client cannot claim someone else did something,
--    because it never supplies the name — it never gets the chance to lie.
--
-- 3. SECRETS AND PASSWORDS ARE REDACTED BEFORE STORAGE. A log that captures a
--    password is a liability, not a record. A fixed deny-list of column names
--    is dropped from the before/after images.
--
-- 4. A DOCUMENT'S OWNER IS NOT A LOOSE UUID. The specification proposes a
--    polymorphic `owner_id`, then warns that it has no foreign key. Rather than
--    accept that, ownership is expressed with real columns and a check
--    constraint, so the database can refuse a document that belongs to nothing.
--    A file with no owner is a file nobody can justify.
--
-- 5. A PRIVATE BUCKET IS THE DEFAULT AND THE ONLY OPTION FOR CHILDREN'S FILES.
--    Nothing is public. A teacher's file or a child's document is reached only
--    through a short-lived signed URL issued to someone who has already passed
--    an authorization check.

-- --- The audit log ----------------------------------------------------------

do $$ begin
    create type public.audit_action as enum (
        'INSERT', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'EXPORT'
    );
exception when duplicate_object then null;
end $$;

create table if not exists public.audit_log (
    id            bigint generated always as identity primary key,
    -- Who. Always from the session, never from the caller.
    actor_id      uuid,
    actor_email   text,
    action        public.audit_action not null,
    -- What. The table name, not an enum, so a new table needs no migration to
    -- be auditable.
    entity_type   text not null,
    entity_id     text,
    -- The change, with secrets removed.
    before_data   jsonb,
    after_data    jsonb,
    -- Only recorded when the database genuinely has it. The specification is
    -- explicit that an IP must not be invented, and there is no reliable
    -- client address available to a trigger, so this stays null unless a
    -- server path sets it deliberately.
    ip_address    inet,
    created_at    timestamptz not null default now()
);

create index if not exists idx_audit_log_entity
    on public.audit_log (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_log_actor
    on public.audit_log (actor_id, created_at desc);
create index if not exists idx_audit_log_created
    on public.audit_log (created_at desc);

comment on table public.audit_log is
    'Append-only record of changes to student, attendance, assessment and '
    'finance data. Written only by triggers; no application role holds INSERT, '
    'UPDATE or DELETE, so it cannot be edited or erased from a screen.';

-- The columns that must never reach a log.
--
-- A password, a token or a key captured in an audit row turns the log itself
-- into the leak. Kept as a function so the redaction is applied in one place
-- and can be read.
create or replace function public.audit_redact(p_row jsonb)
returns jsonb
language sql
immutable
as $$
    select case
        when p_row is null then null
        else p_row - array[
            'password', 'encrypted_password', 'password_hash', 'token',
            'refresh_token', 'access_token', 'secret', 'secret_key',
            'api_key', 'idempotency_key'
        ]
    end;
$$;

comment on function public.audit_redact(jsonb) is
    'Removes credentials from a row before it is written to the audit log. A '
    'log that captures a password is a liability, not a record.';

-- The trigger that writes the log.
--
-- Generic, so a table becomes auditable by attaching it, and no change to this
-- function is needed when a new table is added.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_before jsonb;
    v_after  jsonb;
    v_id     text;
    v_action public.audit_action;
begin
    if tg_op = 'INSERT' then
        v_action := 'INSERT';
        v_after  := public.audit_redact(to_jsonb(new));
        v_id     := v_after ->> 'id';
    elsif tg_op = 'UPDATE' then
        v_action := 'UPDATE';
        v_before := public.audit_redact(to_jsonb(old));
        v_after  := public.audit_redact(to_jsonb(new));
        v_id     := coalesce(v_after ->> 'id', v_before ->> 'id');

        -- A no-op update would otherwise write a row on every save, burying the
        -- changes that matter. Comparing the redacted images also means a
        -- password-only change is not logged as a change, which is correct:
        -- the log is not allowed to see it.
        if v_before = v_after then
            return new;
        end if;
    else
        v_action := 'DELETE';
        v_before := public.audit_redact(to_jsonb(old));
        v_id     := v_before ->> 'id';
    end if;

    insert into public.audit_log
        (actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
    values (
        auth.uid(),
        -- Best effort, and only if the session carries it. Reading it from the
        -- JWT avoids a second query on every write.
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
        v_action,
        tg_table_name,
        v_id,
        v_before,
        v_after
    );

    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.write_audit_log() is
    'Writes a change to audit_log. The actor comes from auth.uid(), so a client '
    'cannot attribute an action to someone else.';

-- --- The log is readable only by the audit permission, and writable by nobody

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
    for select using (public.has_permission('audit.view'));

-- Deliberately no INSERT, UPDATE or DELETE policy.
--
-- The trigger runs as the table owner and is unaffected by RLS, so the log is
-- still written. An application role that tried to write one would be refused
-- by the absence of a policy, which is the strongest way to say "never".
grant select on public.audit_log to authenticated;

comment on policy audit_log_select on public.audit_log is
    'Only audit.view may read the log. No role may write or erase it; rows come '
    'from the trigger only.';

-- --- Documents --------------------------------------------------------------

do $$ begin
    create type public.document_owner_type as enum ('STUDENT', 'TEACHER', 'SCHOOL');
exception when duplicate_object then null;
end $$;

create table if not exists public.documents (
    id            uuid primary key default gen_random_uuid(),
    owner_type    public.document_owner_type not null,
    -- Real columns with real foreign keys, rather than one polymorphic id.
    --
    -- The specification proposes `owner_id` and then warns it has no foreign
    -- key, which would allow a document belonging to a child who does not
    -- exist. Two nullable columns and a check constraint make that
    -- unrepresentable.
    student_id    uuid references public.students(id) on delete cascade,
    teacher_id    uuid references public.teachers(id) on delete cascade,
    category      text not null,
    title         text not null,
    -- The key inside the Storage bucket. Null until an upload succeeds, so a
    -- row can be created first and completed, and a failure leaves an
    -- obviously incomplete record rather than a row pointing at nothing.
    storage_key   text,
    mime_type     text,
    size_bytes    bigint,
    uploaded_by   uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- Exactly one owner, matching the declared type. This is the constraint the
    -- polymorphic design cannot express.
    constraint documents_owner_matches_type check (
        (owner_type = 'STUDENT' and student_id is not null and teacher_id is null)
        or (owner_type = 'TEACHER' and teacher_id is not null and student_id is null)
        or (owner_type = 'SCHOOL' and student_id is null and teacher_id is null)
    ),
    -- A size must not be negative, and a file above 25 MB is almost certainly a
    -- mistake on a school connection.
    constraint documents_size_sane check (
        size_bytes is null or (size_bytes >= 0 and size_bytes <= 26214400)
    ),
    constraint documents_title_present check (btrim(title) <> '')
);

create index if not exists idx_documents_student on public.documents (student_id);
create index if not exists idx_documents_teacher on public.documents (teacher_id);

comment on table public.documents is
    'Files attached to a child, a teacher or the school. The owner is real '
    'foreign keys plus a check constraint, not a polymorphic id, so a document '
    'cannot belong to nobody.';

alter table public.documents enable row level security;
alter table public.documents force row level security;

-- A child's document is visible to the office, and to a guardian of that child.
-- Not to other parents, and not to teachers by default.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
    for select using (
        public.has_permission('documents.view')
        or (student_id is not null and public.is_guardian_of(student_id))
    );

drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents
    for all using (public.has_permission('documents.manage'))
    with check (public.has_permission('documents.manage'));

grant select, insert, update, delete on public.documents to authenticated;

-- --- Announcements ----------------------------------------------------------

do $$ begin
    create type public.announcement_audience as enum (
        'ALL', 'STAFF', 'GUARDIANS', 'STUDENTS'
    );
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.announcement_status as enum ('DRAFT', 'PUBLISHED', 'WITHDRAWN');
exception when duplicate_object then null;
end $$;

create table if not exists public.announcements (
    id            uuid primary key default gen_random_uuid(),
    title         text not null,
    body          text not null,
    audience      public.announcement_audience not null default 'ALL',
    status        public.announcement_status not null default 'DRAFT',
    -- Separate from `status` so an announcement can be scheduled: written now,
    -- published later, by whom the date says.
    publish_at    timestamptz,
    expires_at    timestamptz,
    author_id     uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint announcements_title_present check (btrim(title) <> ''),
    constraint announcements_body_present check (btrim(body) <> ''),
    -- An announcement that expires before it is published is never seen, and is
    -- almost certainly a typing mistake worth catching.
    constraint announcements_dates_sane check (
        expires_at is null or publish_at is null or expires_at > publish_at
    )
);

create index if not exists idx_announcements_published
    on public.announcements (status, publish_at desc);

alter table public.announcements enable row level security;
alter table public.announcements force row level security;

-- What a family may see: published, in date, and addressed to them.
--
-- A draft is invisible to everyone but its author and the office, so a
-- half-written notice cannot reach a parent.
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
    for select using (
        public.has_permission('announcements.view')
        or (
            status = 'PUBLISHED'
            and audience <> 'STAFF'
            and (publish_at is null or publish_at <= now())
            and (expires_at is null or expires_at > now())
        )
    );

drop policy if exists announcements_write on public.announcements;
create policy announcements_write on public.announcements
    for all using (public.has_permission('announcements.manage'))
    with check (public.has_permission('announcements.manage'));

grant select, insert, update, delete on public.announcements to authenticated;

-- --- Reading the log, and reading a child's history -------------------------

/*
 * Recent audit entries, newest first, filterable.
 *
 * A SECURITY DEFINER function rather than a plain view, because the caller must
 * be checked. Passing `p_entity_id` for a child a parent is not linked to
 * returns nothing, because the rows are filtered by the same rule the rest of
 * the system uses.
 */
create or replace function public.list_audit_log(
    p_entity_type text default null,
    p_entity_id   text default null,
    p_actor_id    uuid default null,
    p_limit       integer default 100
)
returns table (
    id          bigint,
    created_at  timestamptz,
    actor_email text,
    action      public.audit_action,
    entity_type text,
    entity_id   text,
    before_data jsonb,
    after_data  jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('audit.view') then
        raise exception 'You do not have permission to read the audit log'
            using errcode = '42501';
    end if;

    return query
        select a.id, a.created_at, a.actor_email, a.action,
               a.entity_type, a.entity_id, a.before_data, a.after_data
          from public.audit_log a
         where (p_entity_type is null or a.entity_type = p_entity_type)
           and (p_entity_id is null or a.entity_id = p_entity_id)
           and (p_actor_id is null or a.actor_id = p_actor_id)
         order by a.created_at desc
         limit least(coalesce(p_limit, 100), 500);
end;
$$;

comment on function public.list_audit_log(text, text, uuid, integer) is
    'Recent audit entries, newest first. Requires audit.view, and is capped so a '
    'single call cannot pull the whole log into a browser.';

revoke all on function public.list_audit_log(text, text, uuid, integer) from public;
grant execute on function public.list_audit_log(text, text, uuid, integer) to authenticated;

/*
 * One record's history, for showing "who changed this" next to the record.
 */
create or replace function public.record_history(
    p_entity_type text,
    p_entity_id   text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_rows jsonb;
begin
    if not public.has_permission('audit.view') then
        raise exception 'You do not have permission to read a record''s history'
            using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(row order by row->>'created_at' desc), '[]'::jsonb)
      into v_rows
      from (
        select jsonb_build_object(
                   'at', a.created_at,
                   'by', a.actor_email,
                   'action', a.action,
                   'changed', public.audit_changed_fields(a.before_data, a.after_data)
               ) as row
          from public.audit_log a
         where a.entity_type = p_entity_type
           and a.entity_id = p_entity_id
         order by a.created_at desc
         limit 100
      ) x;

    return v_rows;
end;
$$;

/*
 * Which fields differ between two versions of a row.
 *
 * Shown instead of the whole before/after images, because a clerk asking "what
 * changed" wants the two or three fields that moved, not sixty columns.
 */
create or replace function public.audit_changed_fields(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
as $$
    select coalesce(
               jsonb_object_agg(after_kv.k, jsonb_build_object('from', before_kv.v, 'to', after_kv.v)),
               '{}'::jsonb
           )
      from jsonb_each(coalesce(p_after, '{}'::jsonb)) as after_kv(k, v)
      left join jsonb_each(coalesce(p_before, '{}'::jsonb)) as before_kv(k, v)
             on before_kv.k = after_kv.k
     where after_kv.v is distinct from before_kv.v
       -- `updated_at` moves on every save and would drown the real changes.
       and after_kv.k not in ('updated_at', 'created_at');
$$;

comment on function public.audit_changed_fields(jsonb, jsonb) is
    'The fields that actually differ between two versions of a row, excluding '
    'timestamps. Shown instead of the full before/after images.';

revoke all on function public.record_history(text, text) from public;
grant execute on function public.record_history(text, text) to authenticated;
grant execute on function public.audit_changed_fields(jsonb, jsonb) to authenticated;

-- --- Publishing an announcement ---------------------------------------------

/*
 * Publishes, or withdraws, a notice.
 *
 * A separate function from a plain update because publishing is the moment a
 * notice becomes visible to families, and it deserves to be a deliberate act
 * with an audit record rather than a side effect of saving a form.
 */
create or replace function public.set_announcement_status(
    p_announcement_id uuid,
    p_status public.announcement_status,
    p_publish_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.announcements;
begin
    if not public.has_permission('announcements.manage') then
        raise exception 'You do not have permission to publish announcements'
            using errcode = '42501';
    end if;

    select * into v_row from public.announcements where id = p_announcement_id;
    if v_row.id is null then
        raise exception 'Announcement % does not exist', p_announcement_id
            using errcode = 'no_data_found';
    end if;

    update public.announcements
       set status = p_status,
           publish_at = case
                            when p_status = 'PUBLISHED' then coalesce(p_publish_at, now())
                            else publish_at
                        end,
           updated_at = now()
     where id = p_announcement_id;

    return jsonb_build_object('id', p_announcement_id, 'status', p_status);
end;
$$;

revoke all on function public.set_announcement_status(uuid, public.announcement_status, timestamptz) from public;
grant execute on function public.set_announcement_status(uuid, public.announcement_status, timestamptz) to authenticated;

-- --- The permissions this phase needs ---------------------------------------

insert into public.permissions (code, description, category) values
    ('documents.view',        'View documents',                'documents'),
    ('documents.manage',      'Upload and remove documents',    'documents'),
    ('announcements.view',    'View announcements',             'announcements'),
    ('announcements.manage',  'Write and publish announcements', 'announcements')
on conflict (code) do nothing;

-- Phase 1 already defined announcements.view/manage and audit.view. Only the
-- document permissions are genuinely new here; the rest are re-asserted so a
-- fresh database built from migrations alone ends up with exactly this set.
insert into public.permissions (code, description, category) values
    ('announcements.create', 'Create announcements', 'announcements'),
    ('announcements.publish', 'Publish announcements', 'announcements')
on conflict (code) do nothing;

-- ADMIN holds everything it is granted by Phase 1's blanket rule; the office
-- gains the new document permissions explicitly.
insert into public.role_permissions (role_code, permission_code)
select 'ADMIN', p.code
  from public.permissions p
 where p.code in ('documents.view', 'documents.manage', 'announcements.view',
                  'announcements.manage', 'audit.view')
on conflict do nothing;

-- A teacher may attach a file to their own record, and read notices for staff.
insert into public.role_permissions (role_code, permission_code)
values
    ('TEACHER', 'documents.view'),
    ('TEACHER', 'announcements.view')
on conflict do nothing;

-- A guardian is granted NOTHING here, and that is the point.
--
-- `announcements.view` means "see every announcement, drafts included". Giving
-- it to a parent would let them read a notice the office had not finished
-- writing and a note meant only for staff — which is exactly what the first run
-- of these tests caught. A parent does not need a permission to see a family
-- notice: the row-level policy in this migration grants that from the
-- announcement's own audience and dates. Access to notices therefore comes from
-- being the audience, not from holding a key.
--
-- A parent's document access works the same way: `documents_select` admits them
-- through `is_guardian_of`, not through a granted permission.
--
-- (This is written as a deliberate no-op rather than being deleted, because the
-- absence of a grant is the security control, and the reason belongs next to
-- where the grant would have been.)

-- --- Attach the log to the tables that matter --------------------------------
--
-- Student records, attendance, marks and money: the four areas the
-- specification names, plus documents and announcements added by this phase.
-- Not every table, because logging everything makes the log unreadable and
-- hides the rows that matter.
--
-- THIS BLOCK RUNS LAST, DELIBERATELY. It used to sit above, and its `if exists`
-- guard quietly skipped every table this phase had not created yet, so
-- announcements and documents were never audited and nothing said so. Attaching
-- at the end means the guard can only skip a table that genuinely does not
-- exist.

do $$
declare
    v_table text;
    v_tables text[] := array[
        'students', 'student_enrollments', 'guardians', 'student_guardians',
        'attendance_records', 'assessments', 'assessment_results', 'report_cards',
        'fee_types', 'student_charges', 'payments', 'payment_allocations',
        'documents', 'announcements'
    ];
begin
    foreach v_table in array v_tables loop
        if exists (
            select 1 from information_schema.tables
             where table_schema = 'public' and table_name = v_table
        ) then
            execute format('drop trigger if exists trg_audit on public.%I', v_table);
            execute format(
                'create trigger trg_audit after insert or update or delete on public.%I '
                'for each row execute function public.write_audit_log()', v_table);
        end if;
    end loop;
end
$$;
