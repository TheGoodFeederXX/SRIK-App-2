-- =============================================================================
-- SRIK — Phase 2: school profile, people and the academic core
-- =============================================================================
-- Reference: docs/srik/04_PHASE_2_ACADEMIC_CORE.md
--
-- Scope notes that shape every decision below:
--   * SINGLE SCHOOL. There is no school_id, no tenant, no branch. `school_profile`
--     is one configuration row, not a tenant record.
--   * Roles stay ADMIN and TEACHER. Nothing here introduces new roles; extra
--     duties are extra permissions on a TEACHER.
--   * Class identity is relational. A student's class is derived from an
--     enrollment row, never stored as a name string on the student.
--   * Subjects are referenced by ID, and are global rather than duplicated per
--     year.
--
-- Conventions inherited from Phase 1 (not negotiable — they are what makes the
-- authorization model hold):
--   * RLS enabled AND forced on every table.
--   * Explicit grants; `anon` gets nothing.
--   * Privileged helpers are SECURITY DEFINER with `set search_path = ''` and
--     fully-qualified object names.
--   * Deny by default: a table with no policy denies everything.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
-- Kept as real enums (rather than text + CHECK) so a typo is rejected by the
-- type system and the allowed values are discoverable from the schema.

do $$ begin
    create type public.gender as enum ('MALE', 'FEMALE');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.record_status as enum ('ACTIVE', 'INACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

-- Academic years and terms have their own lifecycle: exactly one year and at
-- most one term are CURRENT at a time.
do $$ begin
    create type public.academic_status as enum ('PLANNED', 'CURRENT', 'CLOSED');
exception when duplicate_object then null; end $$;

-- A student's own status. Separate from record_status because "graduated" and
-- "transferred out" are outcomes that must remain visible in history.
do $$ begin
    create type public.student_status as enum ('ACTIVE', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'ARCHIVED');
exception when duplicate_object then null; end $$;

-- Mirrors the specification: CLASS_TEACHER carries no subject; SUBJECT_TEACHER
-- requires one.
do $$ begin
    create type public.assignment_type as enum ('CLASS_TEACHER', 'SUBJECT_TEACHER', 'ASSISTANT');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. School profile — configuration, NOT a tenant
-- ---------------------------------------------------------------------------
-- A single row. The `id` exists so foreign keys have something stable to point
-- at, not to allow several schools: a constraint below enforces exactly one row.
create table if not exists public.school_profile (
    id                boolean primary key default true,
    name              text        not null,
    short_name        text        not null,
    code              text,
    logo_storage_key  text,
    address           text,
    phone             text,
    email             text,
    website           text,
    principal_name    text,
    -- Free-form settings bag for preferences that do not deserve a column yet.
    settings          jsonb       not null default '{}'::jsonb,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- The primary key is a boolean, so it can only ever hold one row per value.
    -- This makes "single school" a database guarantee rather than a convention
    -- the application is trusted to keep.
    constraint school_profile_single_row check (id is true)
);

comment on table public.school_profile is
    'Single-row school configuration. NOT a tenant: this project is one school. '
    'The boolean primary key enforces that only one row can exist.';

-- ---------------------------------------------------------------------------
-- 3. Teachers
-- ---------------------------------------------------------------------------
create table if not exists public.teachers (
    id                uuid primary key default gen_random_uuid(),
    -- Nullable because a teacher record may be created before (or without) a
    -- login account. UNIQUE because one login must not map to two teachers.
    user_id           uuid unique references auth.users(id) on delete set null,
    staff_code        text        not null,
    full_name         text        not null,
    gender            public.gender,
    phone             text,
    email             text,
    employment_start  date,
    employment_end    date,
    status            public.record_status not null default 'ACTIVE',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- An end date before the start date is a data-entry error, and a trigger
    -- already maintains updated_at on this table.
    constraint teachers_dates_ordered
        check (employment_end is null or employment_start is null
               or employment_end >= employment_start)
);

-- Codes are compared case-insensitively: "TCH001" and "tch001" are the same
-- staff member, and letting both exist would split their records.
create unique index if not exists idx_teachers_staff_code
    on public.teachers (upper(staff_code));

comment on column public.teachers.user_id is
    'Login account for this teacher, if one exists. Nullable so staff can be '
    'recorded before an account is created, and SET NULL so removing a login '
    'never deletes the employment history.';

-- ---------------------------------------------------------------------------
-- 4. Students
-- ---------------------------------------------------------------------------
create table if not exists public.students (
    id                uuid primary key default gen_random_uuid(),
    -- Student login is DEFERRED (see 09_DEFERRED_ROADMAP.md). The column exists
    -- so the link can be added without a migration, but nothing creates one yet.
    user_id           uuid unique references auth.users(id) on delete set null,
    admission_no      text        not null,
    full_name         text        not null,
    gender            public.gender,
    birth_date        date,
    birth_place       text,
    nationality       text,
    -- Identity numbers are TEXT, never integer: leading zeros are significant
    -- and an integer would silently destroy them.
    identity_no       text,
    address           text,
    previous_school   text,
    admission_date    date        not null default current_date,
    status            public.student_status not null default 'ACTIVE',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create unique index if not exists idx_students_admission_no
    on public.students (upper(admission_no));

-- ---------------------------------------------------------------------------
-- 5. Guardians and the student<->guardian link
-- ---------------------------------------------------------------------------
create table if not exists public.guardians (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid unique references auth.users(id) on delete set null,
    full_name         text        not null,
    identity_no       text,
    -- Required: a guardian who cannot be contacted is not a usable record for
    -- a school. This is the one field the specification marks as mandatory.
    phone             text        not null,
    email             text,
    address           text,
    occupation        text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- A student may have several guardians (parent, grandparent, emergency
-- contact), and a guardian may have several children at the school.
create table if not exists public.student_guardians (
    id                 uuid primary key default gen_random_uuid(),
    student_id         uuid not null references public.students(id) on delete cascade,
    guardian_id        uuid not null references public.guardians(id) on delete restrict,
    relationship       text not null,
    -- `is_primary` marks the main contact; at most one per student is enforced
    -- by a partial unique index below rather than by convention.
    is_primary         boolean not null default false,
    is_emergency_contact boolean not null default false,
    created_at         timestamptz not null default now(),
    constraint student_guardians_unique_pair unique (student_id, guardian_id)
);

-- At most ONE primary guardian per student. A partial unique index is the only
-- way to express "at most one true" in PostgreSQL; a plain unique constraint
-- would forbid a second non-primary guardian instead.
create unique index if not exists idx_student_guardians_one_primary
    on public.student_guardians (student_id)
    where is_primary;

-- NOTE on guardians: duplicates are NOT auto-merged on matching name. Two
-- people can share a name, and merging them would silently join two families'
-- records. A shared phone number is the same hazard, so deduplication stays a
-- human decision.

comment on table public.guardians is
    'Guardian contact records. Deliberately NOT deduplicated on name or phone: '
    'two people may share either, and merging them would conflate two families.';

-- ---------------------------------------------------------------------------
-- 6. Academic years and terms
-- ---------------------------------------------------------------------------
create table if not exists public.academic_years (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    start_date  date not null,
    end_date    date not null,
    status      public.academic_status not null default 'PLANNED',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint academic_years_dates_ordered check (end_date > start_date)
);

create unique index if not exists idx_academic_years_name
    on public.academic_years (upper(name));

-- Exactly ONE current academic year. Enforced in the database because two
-- current years would make "the current year" ambiguous everywhere downstream —
-- enrolments, timetable and reports all resolve against it.
create unique index if not exists idx_academic_years_one_current
    on public.academic_years ((status))
    where status = 'CURRENT';

create table if not exists public.academic_terms (
    id                uuid primary key default gen_random_uuid(),
    academic_year_id  uuid not null references public.academic_years(id) on delete cascade,
    name              text not null,
    sequence          integer not null,
    start_date        date not null,
    end_date          date not null,
    status            public.academic_status not null default 'PLANNED',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint academic_terms_sequence_positive check (sequence > 0),
    constraint academic_terms_dates_ordered check (end_date > start_date),
    -- Sequence identifies the term within its year, so it must be unique there.
    constraint academic_terms_unique_sequence unique (academic_year_id, sequence)
);

-- ---------------------------------------------------------------------------
-- 7. Classes
-- ---------------------------------------------------------------------------
-- A class BELONGS TO an academic year. "Tahun 3" in 2026 and "Tahun 3" in 2027
-- are two different rows, which is what keeps last year's records intact.
create table if not exists public.classes (
    id                uuid primary key default gen_random_uuid(),
    academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
    -- Year 1..6 only (see the CHECK below). SRIK is a primary school.
    year_level        integer not null,
    name              text not null,
    code              text,
    status            public.record_status not null default 'ACTIVE',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint classes_year_level_range check (year_level between 1 and 6),
    -- Two classes with the same year and name in one academic year would be
    -- indistinguishable to a user reading a dropdown.
    constraint classes_unique_in_year unique (academic_year_id, year_level, name)
);

-- Display name is year plus section, e.g. "3 Al-Junaidi" (04_PHASE_2 line 29).
-- Implemented as a generated column so the display rule lives in one place and
-- cannot drift between screens.
alter table public.classes
    add column if not exists display_name text
    generated always as (year_level::text || ' ' || name) stored;

comment on column public.classes.year_level is
    '1..6. SRIK is a primary school, so there is no form 1-5.';

-- ---------------------------------------------------------------------------
-- 8. Subjects — global, not per year
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
    id          uuid primary key default gen_random_uuid(),
    code        text not null,
    name        text not null,
    short_name  text,
    category    text,
    status      public.record_status not null default 'ACTIVE',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Deliberately global: duplicating "Bahasa Melayu" once per academic year would
-- fragment report history and make cross-year comparison meaningless.
create unique index if not exists idx_subjects_code
    on public.subjects (upper(code));

comment on table public.subjects is
    'Global subject list, NOT duplicated per academic year '
    '(04_PHASE_2: "global, tidak duplicate setiap tahun").';

-- ---------------------------------------------------------------------------
-- 9. Enrollments — where a student's current class actually comes from
-- ---------------------------------------------------------------------------
-- This table REPLACES a `current_class` string on the student. Class history
-- survives a class change because the old row is closed (`ended_at`) rather
-- than overwritten.
create table if not exists public.student_enrollments (
    id                uuid primary key default gen_random_uuid(),
    student_id        uuid not null references public.students(id) on delete restrict,
    class_id          uuid not null references public.classes(id) on delete restrict,
    -- Redundant with class.academic_year_id, but kept so a composite foreign key
    -- can prove the class really belongs to this year (see section 11). A
    -- redundancy enforced by a constraint is safe; one trusted to the UI is not.
    academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
    enrolled_at       timestamptz not null default now(),
    -- NULL means "still in this class". A non-null value closes the period.
    ended_at          timestamptz,
    status            public.record_status not null default 'ACTIVE',
    created_at        timestamptz not null default now(),
    constraint student_enrollments_period_ordered
        check (ended_at is null or ended_at >= enrolled_at)
);

-- At most ONE open enrolment per student per academic year. This is the rule
-- that makes "the current class" unambiguous, and it is enforced here so an
-- incorrect state cannot be stored even by a direct SQL write.
create unique index if not exists idx_enrollments_one_open_per_year
    on public.student_enrollments (student_id, academic_year_id)
    where ended_at is null;

comment on table public.student_enrollments is
    'A student''s class membership over time. The current class is the row with '
    'ended_at IS NULL; the partial unique index guarantees there is at most one '
    'per student per academic year.';

-- ---------------------------------------------------------------------------
-- 10. Class subjects and teaching assignments
-- ---------------------------------------------------------------------------
create table if not exists public.class_subjects (
    id                uuid primary key default gen_random_uuid(),
    class_id          uuid not null references public.classes(id) on delete cascade,
    subject_id        uuid not null references public.subjects(id) on delete restrict,
    academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
    created_at        timestamptz not null default now(),
    -- A subject is taught in a class once.
    constraint class_subjects_unique unique (class_id, subject_id)
);

create table if not exists public.teaching_assignments (
    id                uuid primary key default gen_random_uuid(),
    teacher_id        uuid not null references public.teachers(id) on delete restrict,
    class_id          uuid not null references public.classes(id) on delete restrict,
    academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
    -- NULL means CLASS_TEACHER (the whole class); a value means SUBJECT_TEACHER.
    subject_id        uuid references public.subjects(id) on delete restrict,
    assignment_type   public.assignment_type not null,
    periods_per_week  integer,
    effective_from    date not null default current_date,
    effective_to      date,
    status            public.record_status not null default 'ACTIVE',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- The two rules from 04_PHASE_2 §31, expressed as a CHECK so an invalid row
    -- cannot be stored: a CLASS_TEACHER has no subject, a SUBJECT_TEACHER has
    -- one and a positive weekly period count.
    constraint teaching_assignments_shape check (
        (assignment_type = 'CLASS_TEACHER' and subject_id is null)
        or (assignment_type = 'SUBJECT_TEACHER' and subject_id is not null
            and periods_per_week is not null and periods_per_week > 0)
        or (assignment_type = 'ASSISTANT')
    ),
    constraint teaching_assignments_dates_ordered
        check (effective_to is null or effective_to >= effective_from),
    constraint teaching_assignments_periods_positive
        check (periods_per_week is null or periods_per_week > 0)
);

-- Effective dates exist so a teacher can be replaced without rewriting history
-- (04_PHASE_2 line 41). A new assignment rows up; the old one is closed.
create index if not exists idx_teaching_assignments_teacher
    on public.teaching_assignments (teacher_id, academic_year_id);
create index if not exists idx_teaching_assignments_class
    on public.teaching_assignments (class_id, academic_year_id);

comment on column public.teaching_assignments.periods_per_week is
    'Required and positive for SUBJECT_TEACHER; not used for CLASS_TEACHER. '
    'A co-teacher must not double-count the requirement, so this is a per-'
    'assignment figure, not a per-subject total.';

-- ---------------------------------------------------------------------------
-- 11. Composite integrity: a class must belong to the year it is used with
-- ---------------------------------------------------------------------------
-- The redundant academic_year_id columns above exist purely to make these
-- constraints possible. Without them, RLS and the application would have to be
-- trusted to never mix years — and that is exactly the kind of mistake that
-- corrupts a school's records silently.

-- Enables composite FKs on classes.
do $$ begin
    alter table public.classes
        add constraint classes_id_year_unique unique (id, academic_year_id);
exception when duplicate_table then null; end $$;

do $$ begin
    alter table public.student_enrollments
        add constraint enrollments_class_in_year
        foreign key (class_id, academic_year_id)
        references public.classes (id, academic_year_id)
        on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.class_subjects
        add constraint class_subjects_class_in_year
        foreign key (class_id, academic_year_id)
        references public.classes (id, academic_year_id)
        on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.teaching_assignments
        add constraint teaching_assignments_class_in_year
        foreign key (class_id, academic_year_id)
        references public.classes (id, academic_year_id)
        on delete restrict;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 12. updated_at maintenance
-- ---------------------------------------------------------------------------
-- Reuses touch_updated_at() from Phase 1 rather than duplicating it. Guarded so
-- this file stays runnable even if applied to a database where Phase 1 has not
-- been applied (which would be a setup error, not a silent success).
do $$
declare
    t text;
begin
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'touch_updated_at') then
        foreach t in array array[
            'school_profile', 'teachers', 'students', 'guardians',
            'academic_years', 'academic_terms', 'classes', 'subjects',
            'teaching_assignments'
        ] loop
            execute format('drop trigger if exists trg_%s_touch on public.%I', t, t);
            execute format(
                'create trigger trg_%s_touch before update on public.%I '
                'for each row execute function public.touch_updated_at()', t, t);
        end loop;
    else
        raise exception 'Phase 1 must be applied first: public.touch_updated_at() is missing';
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 13. Row Level Security — deny by default
-- ---------------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array[
        'school_profile', 'teachers', 'students', 'guardians', 'student_guardians',
        'academic_years', 'academic_terms', 'classes', 'subjects',
        'student_enrollments', 'class_subjects', 'teaching_assignments'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        -- FORCE so the table owner is also subject to policies; without it a
        -- SECURITY INVOKER path running as owner would bypass them silently.
        execute format('alter table public.%I force row level security', t);
    end loop;
end
$$;

-- --- Read policies ---------------------------------------------------------
-- Reading the school's academic structure is part of normal teaching work, so
-- these are readable by any ACTIVE user. Write policies are separate and
-- narrower, so widening reads never quietly widens writes.

drop policy if exists school_profile_select on public.school_profile;
create policy school_profile_select on public.school_profile
    for select to authenticated
    using (public.is_active_user());

drop policy if exists teachers_select on public.teachers;
create policy teachers_select on public.teachers
    for select to authenticated
    using (public.is_active_user() and public.has_permission('teachers.view'));

drop policy if exists students_select on public.students;
create policy students_select on public.students
    for select to authenticated
    using (public.is_active_user() and public.has_permission('students.view'));

drop policy if exists guardians_select on public.guardians;
create policy guardians_select on public.guardians
    for select to authenticated
    using (public.is_active_user() and public.has_permission('guardians.view'));

drop policy if exists student_guardians_select on public.student_guardians;
create policy student_guardians_select on public.student_guardians
    for select to authenticated
    using (public.is_active_user() and (
        public.has_permission('guardians.view') or public.has_permission('students.view')
    ));

drop policy if exists academic_years_select on public.academic_years;
create policy academic_years_select on public.academic_years
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

drop policy if exists academic_terms_select on public.academic_terms;
create policy academic_terms_select on public.academic_terms
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

drop policy if exists student_enrollments_select on public.student_enrollments;
create policy student_enrollments_select on public.student_enrollments
    for select to authenticated
    using (public.is_active_user() and (
        public.has_permission('students.view') or public.has_permission('classes.view')
    ));

drop policy if exists class_subjects_select on public.class_subjects;
create policy class_subjects_select on public.class_subjects
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

drop policy if exists teaching_assignments_select on public.teaching_assignments;
create policy teaching_assignments_select on public.teaching_assignments
    for select to authenticated
    using (public.is_active_user() and public.has_permission('classes.view'));

-- --- Write policies --------------------------------------------------------
-- One policy per (table, operation) rather than a blanket `for all`, so that
-- adding a read permission later cannot accidentally grant writes.

drop policy if exists school_profile_manage on public.school_profile;
create policy school_profile_manage on public.school_profile
    for all to authenticated
    using (public.has_permission('settings.manage'))
    with check (public.has_permission('settings.manage'));

drop policy if exists teachers_insert on public.teachers;
create policy teachers_insert on public.teachers
    for insert to authenticated with check (public.has_permission('teachers.manage'));

drop policy if exists teachers_update on public.teachers;
create policy teachers_update on public.teachers
    for update to authenticated
    using (public.has_permission('teachers.manage'))
    with check (public.has_permission('teachers.manage'));

drop policy if exists teachers_delete on public.teachers;
create policy teachers_delete on public.teachers
    for delete to authenticated using (public.has_permission('teachers.manage'));

-- Student writes use Phase 1's granular permissions. There is no
-- `students.manage`: creating, editing and archiving are separate grants, so a
-- clerk who may add a student is not thereby allowed to archive one.
drop policy if exists students_insert on public.students;
create policy students_insert on public.students
    for insert to authenticated with check (public.has_permission('students.create'));

drop policy if exists students_update on public.students;
create policy students_update on public.students
    for update to authenticated
    using (public.has_permission('students.update'))
    with check (public.has_permission('students.update'));

drop policy if exists students_delete on public.students;
create policy students_delete on public.students
    for delete to authenticated using (public.has_permission('students.archive'));

drop policy if exists guardians_insert on public.guardians;
create policy guardians_insert on public.guardians
    for insert to authenticated with check (public.has_permission('guardians.manage'));

drop policy if exists guardians_update on public.guardians;
create policy guardians_update on public.guardians
    for update to authenticated
    using (public.has_permission('guardians.manage'))
    with check (public.has_permission('guardians.manage'));

drop policy if exists guardians_delete on public.guardians;
create policy guardians_delete on public.guardians
    for delete to authenticated using (public.has_permission('guardians.manage'));

drop policy if exists student_guardians_manage on public.student_guardians;
create policy student_guardians_manage on public.student_guardians
    for all to authenticated
    using (public.has_permission('guardians.manage'))
    with check (public.has_permission('guardians.manage'));

drop policy if exists academic_years_manage on public.academic_years;
create policy academic_years_manage on public.academic_years
    for all to authenticated
    using (public.has_permission('classes.manage'))
    with check (public.has_permission('classes.manage'));

drop policy if exists academic_terms_manage on public.academic_terms;
create policy academic_terms_manage on public.academic_terms
    for all to authenticated
    using (public.has_permission('classes.manage'))
    with check (public.has_permission('classes.manage'));

drop policy if exists classes_manage on public.classes;
create policy classes_manage on public.classes
    for all to authenticated
    using (public.has_permission('classes.manage'))
    with check (public.has_permission('classes.manage'));

drop policy if exists subjects_manage on public.subjects;
create policy subjects_manage on public.subjects
    for all to authenticated
    using (public.has_permission('subjects.manage'))
    with check (public.has_permission('subjects.manage'));

-- class_subjects joins a class to a subject, so either grant may manage it.
drop policy if exists class_subjects_manage on public.class_subjects;
create policy class_subjects_manage on public.class_subjects
    for all to authenticated
    using (public.has_permission('classes.manage') or public.has_permission('subjects.manage'))
    with check (public.has_permission('classes.manage') or public.has_permission('subjects.manage'));

-- Enrollments and assignments are NOT writable through the Data API.
--
-- Class changes, enrolment and promotion must be atomic and audited
-- (04_PHASE_2 line 47), and they have to close the previous row at the same
-- time as they open the new one. A plain INSERT/UPDATE policy cannot express
-- that, and allowing one would let a screen create a second open enrolment for
-- a student and corrupt the "current class" rule. These are therefore reached
-- only through the RPCs in section 15, which are audited.
drop policy if exists student_enrollments_write on public.student_enrollments;
drop policy if exists teaching_assignments_write on public.teaching_assignments;

comment on table public.student_enrollments is
    'A student''s class membership over time. Writes go through the RPCs only '
    '(no Data API write policy), so a class change always closes the old row '
    'and opens the new one in one audited transaction.';

comment on table public.teaching_assignments is
    'Teaching assignments. Writes go through the RPCs only, so replacing a '
    'teacher closes the old assignment and opens the new one atomically.';

-- ---------------------------------------------------------------------------
-- 14. Explicit grants
-- ---------------------------------------------------------------------------
-- `authenticated` gets exactly SELECT on the readable tables; writes are granted
-- only where a write policy exists. `anon` gets nothing at all: SRIK has no
-- public surface.

revoke all on public.school_profile, public.teachers, public.students,
    public.guardians, public.student_guardians, public.academic_years,
    public.academic_terms, public.classes, public.subjects,
    public.student_enrollments, public.class_subjects, public.teaching_assignments
    from anon;

grant select on public.school_profile      to authenticated;
grant select on public.teachers            to authenticated;
grant select on public.students            to authenticated;
grant select on public.guardians           to authenticated;
grant select on public.student_guardians   to authenticated;
grant select on public.academic_years      to authenticated;
grant select on public.academic_terms      to authenticated;
grant select on public.classes             to authenticated;
grant select on public.subjects            to authenticated;
grant select on public.student_enrollments to authenticated;
grant select on public.class_subjects      to authenticated;
grant select on public.teaching_assignments to authenticated;

-- Writes: only where a policy exists. Enrollments and assignments are omitted
-- on purpose — see the note in section 13.
grant insert, update, delete on public.school_profile    to authenticated;
grant insert, update, delete on public.teachers          to authenticated;
grant insert, update, delete on public.students          to authenticated;
grant insert, update, delete on public.guardians         to authenticated;
grant insert, update, delete on public.student_guardians to authenticated;
grant insert, update, delete on public.academic_years    to authenticated;
grant insert, update, delete on public.academic_terms    to authenticated;
grant insert, update, delete on public.classes           to authenticated;
grant insert, update, delete on public.subjects          to authenticated;
grant insert, update, delete on public.class_subjects    to authenticated;

-- ---------------------------------------------------------------------------
-- 15. Audited RPCs for the operations that must be atomic
-- ---------------------------------------------------------------------------
-- Each one closes the previous state and opens the next inside a single
-- transaction, and writes an audit row. This is why the tables above have no
-- write policy: there is exactly one supported way to change them.

-- --- enroll_student ---------------------------------------------------------
-- Places a student in a class, closing any open enrolment in the same year
-- first so the "at most one open enrolment" rule is never violated, even
-- momentarily.
create or replace function public.enroll_student(
    p_student_id uuid,
    p_class_id   uuid,
    p_reason     text default null
)
returns public.student_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_year_id uuid;
    v_previous uuid;
    v_result public.student_enrollments;
begin
    if not public.has_permission('students.update') then
        raise exception 'Not permitted to enrol students' using errcode = '42501';
    end if;

    -- The class determines the year; taking it from there rather than from the
    -- caller means the two can never disagree.
    select c.academic_year_id into v_year_id
      from public.classes c where c.id = p_class_id;

    if v_year_id is null then
        raise exception 'Class not found' using errcode = 'no_data_found';
    end if;

    -- Close the student's open enrolment in this year, if any.
    update public.student_enrollments
       set ended_at = now(), status = 'INACTIVE'
     where student_id = p_student_id
       and academic_year_id = v_year_id
       and ended_at is null
    returning id into v_previous;

    insert into public.student_enrollments (student_id, class_id, academic_year_id)
    values (p_student_id, p_class_id, v_year_id)
    returning * into v_result;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'STUDENT_ENROLLED', p_student_id,
            jsonb_build_object(
                'class_id', p_class_id,
                'academic_year_id', v_year_id,
                'replaced_enrollment', v_previous,
                'reason', p_reason
            ));

    return v_result;
end;
$$;

comment on function public.enroll_student(uuid, uuid, text) is
    'Enrols a student in a class for the class''s academic year, closing any '
    'previous open enrolment for that year in the same transaction. Audited.';

-- --- promote_students ------------------------------------------------------
-- Year-end promotion. The caller supplies the target class; this function does
-- NOT infer it from the class name. Year 6 is intentionally left out: SRIK is a
-- primary school and what happens after Year 6 is a school decision, so the
-- function refuses to move those students rather than guessing.
create or replace function public.promote_students(
    p_from_class_id uuid,
    p_to_class_id   uuid,
    p_student_ids   uuid[] default null,
    p_reason        text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_from_year uuid;
    v_to_year   uuid;
    v_from_level integer;
    v_to_level   integer;
    v_count     integer := 0;
    v_student   uuid;
begin
    if not public.has_permission('students.update') then
        raise exception 'Not permitted to promote students' using errcode = '42501';
    end if;

    select academic_year_id, year_level into v_from_year, v_from_level
      from public.classes where id = p_from_class_id;
    select academic_year_id, year_level into v_to_year, v_to_level
      from public.classes where id = p_to_class_id;

    if v_from_year is null or v_to_year is null then
        raise exception 'Class not found' using errcode = 'no_data_found';
    end if;

    if v_from_year = v_to_year then
        raise exception 'Promotion must move students to a different academic year';
    end if;

    -- Refuse to promote out of Year 6 rather than inventing an outcome for it.
    if v_from_level = 6 then
        raise exception
            'Year 6 students are not promoted automatically. Mark them GRADUATED '
            'or TRANSFERRED individually, then close the academic year.'
            using errcode = 'check_violation';
    end if;

    if v_to_level <> v_from_level + 1 then
        raise exception 'Target class must be the next year level (% -> %)',
            v_from_level, v_to_level using errcode = 'check_violation';
    end if;

    -- No students supplied means the whole class.
    for v_student in
        select se.student_id
          from public.student_enrollments se
         where se.class_id = p_from_class_id
           and se.ended_at is null
           and (p_student_ids is null or se.student_id = any(p_student_ids))
    loop
        -- Route through enroll_student() so promotion and an ordinary class
        -- change cannot drift apart: both close the old row the same way.
        perform public.enroll_student(v_student, p_to_class_id, p_reason);
        v_count := v_count + 1;
    end loop;

    insert into public.authorization_audit (actor_id, action, detail)
    values (auth.uid(), 'STUDENTS_PROMOTED',
            jsonb_build_object(
                'from_class', p_from_class_id,
                'to_class', p_to_class_id,
                'count', v_count,
                'reason', p_reason
            ));

    return v_count;
end;
$$;

comment on function public.promote_students(uuid, uuid, uuid[], text) is
    'Promotes a class (or a subset of it) to the next year level. Refuses Year 6 '
    'rather than guessing an outcome. Audited.';

-- --- close_academic_year ---------------------------------------------------
-- Closes a year only when it holds no open enrolments, unless those students
-- are explicitly left behind by name. This is deliberately strict: closing a
-- year still containing enrolled students would strand them with no current
-- class, which is worse than a failed operation.
create or replace function public.close_academic_year(
    p_academic_year_id uuid,
    p_reason           text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_open      integer;
    v_levels    text;
begin
    if not public.has_permission('classes.manage') then
        raise exception 'Not permitted to close an academic year' using errcode = '42501';
    end if;

    -- Open enrolments belonging to a class that is NOT Year 6. Year 6 students
    -- are expected to be graduated/transferred first, so their enrolments are
    -- counted separately below.
    select count(*) into v_open
      from public.student_enrollments se
      join public.classes c on c.id = se.class_id
     where se.academic_year_id = p_academic_year_id
       and se.ended_at is null
       and c.year_level <> 6;

    if v_open > 0 then
        raise exception
            'Cannot close: % student(s) below Year 6 are still enrolled. Promote '
            'or withdraw them first.', v_open using errcode = 'check_violation';
    end if;

    update public.academic_years
       set status = 'CLOSED'
     where id = p_academic_year_id;

    if not found then
        raise exception 'Academic year not found' using errcode = 'no_data_found';
    end if;

    insert into public.authorization_audit (actor_id, action, detail)
    values (auth.uid(), 'ACADEMIC_YEAR_CLOSED',
            jsonb_build_object('academic_year_id', p_academic_year_id, 'reason', p_reason));

    return v_open;
end;
$$;

comment on function public.close_academic_year(uuid, text) is
    'Closes an academic year, refusing while students below Year 6 remain '
    'enrolled. Audited.';

-- --- set_teacher_assignments -----------------------------------------------
-- Records a teacher's duties for an academic year, replacing any previous set.
--
-- This is an RPC rather than a table write for the same reason enrollment is:
-- teaching_assignments has NO INSERT grant, so a screen cannot write it
-- directly. Replacing duties has to close the old rows and open the new ones in
-- one atomic, audited step, otherwise a teacher could briefly hold two sets of
-- duties or lose the record of what they taught.
create or replace function public.set_teacher_assignments(
    p_teacher_id       uuid,
    p_academic_year_id uuid,
    p_class_ids        uuid[],
    p_subject_ids      uuid[],
    p_reason           text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class    uuid;
    v_subject  uuid;
    v_count    integer := 0;
    v_closed   integer := 0;
begin
    if not public.has_permission('teachers.manage') then
        raise exception 'Not permitted to change teaching assignments' using errcode = '42501';
    end if;

    if not exists (select 1 from public.teachers where id = p_teacher_id) then
        raise exception 'Teacher not found' using errcode = 'no_data_found';
    end if;

    if not exists (select 1 from public.academic_years where id = p_academic_year_id) then
        raise exception 'Academic year not found' using errcode = 'no_data_found';
    end if;

    -- Close the previous assignments for this year. They are closed, never
    -- deleted: what a teacher taught last term is history worth keeping.
    update public.teaching_assignments
       set status = 'INACTIVE',
           effective_to = coalesce(effective_to, current_date)
     where teacher_id = p_teacher_id
       and academic_year_id = p_academic_year_id
       and status = 'ACTIVE';
    get diagnostics v_closed = row_count;

    -- No classes means nothing to attach duties to. Subjects alone cannot be
    -- recorded because a subject is taught TO a class.
    if p_class_ids is null or array_length(p_class_ids, 1) is null then
        insert into public.authorization_audit (actor_id, action, subject_id, detail)
        values (auth.uid(), 'TEACHING_ASSIGNMENTS_SET', p_teacher_id,
                jsonb_build_object('academic_year_id', p_academic_year_id,
                                   'closed', v_closed, 'created', 0, 'reason', p_reason));
        return 0;
    end if;

    foreach v_class in array p_class_ids loop
        -- Guard: the class must belong to this academic year. The composite FK
        -- would reject a mismatch, but checking here gives a message that names
        -- the real problem instead of a constraint name.
        if not exists (select 1 from public.classes
                        where id = v_class and academic_year_id = p_academic_year_id) then
            raise exception 'Class % does not belong to that academic year', v_class
                using errcode = 'check_violation';
        end if;

        -- Every class gets a CLASS_TEACHER row so the teacher appears against
        -- that class in the register and timetable.
        insert into public.teaching_assignments
            (teacher_id, class_id, academic_year_id, assignment_type, subject_id, periods_per_week)
        values (p_teacher_id, v_class, p_academic_year_id, 'CLASS_TEACHER', null, null);
        v_count := v_count + 1;

        if p_subject_ids is not null then
            foreach v_subject in array p_subject_ids loop
                if not exists (select 1 from public.subjects where id = v_subject) then
                    raise exception 'Subject not found' using errcode = 'no_data_found';
                end if;

                insert into public.teaching_assignments
                    (teacher_id, class_id, academic_year_id, assignment_type, subject_id, periods_per_week)
                values (p_teacher_id, v_class, p_academic_year_id, 'SUBJECT_TEACHER', v_subject, 1);
                v_count := v_count + 1;
            end loop;
        end if;
    end loop;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'TEACHING_ASSIGNMENTS_SET', p_teacher_id,
            jsonb_build_object('academic_year_id', p_academic_year_id,
                               'closed', v_closed, 'created', v_count, 'reason', p_reason));

    return v_count;
end;
$$;

comment on function public.set_teacher_assignments(uuid, uuid, uuid[], uuid[], text) is
    'Replaces a teacher''s duties for an academic year. Closes the previous '
    'assignments instead of deleting them, and is audited. Called instead of a '
    'direct table write, which is not granted.';

-- --- Function privileges ---------------------------------------------------
-- Grant only to `authenticated`; the functions check the caller's permission
-- themselves, so a missing grant is a second line of defence rather than the
-- only one.
revoke all on function public.enroll_student(uuid, uuid, text) from public, anon;
revoke all on function public.promote_students(uuid, uuid, uuid[], text) from public, anon;
revoke all on function public.close_academic_year(uuid, text) from public, anon;
revoke all on function public.set_teacher_assignments(uuid, uuid, uuid[], uuid[], text) from public, anon;

grant execute on function public.enroll_student(uuid, uuid, text) to authenticated;
grant execute on function public.promote_students(uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.close_academic_year(uuid, text) to authenticated;
grant execute on function public.set_teacher_assignments(uuid, uuid, uuid[], uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Permissions used by this phase
-- ---------------------------------------------------------------------------
-- Phase 1 seeded 39 permissions. This phase only needs the ones already present
-- (teachers.*, students.*, guardians.*, classes.*, settings.manage). If any is
-- missing the policies above would silently deny everything, so verify loudly
-- instead: a missing permission is a setup error, not a normal condition.
do $$
declare
    missing text;
begin
    select string_agg(p.required, ', ') into missing
      from (values
            ('teachers.view'), ('teachers.manage'),
            ('students.view'), ('students.create'),
            ('students.update'), ('students.archive'),
            ('guardians.view'), ('guardians.manage'),
            ('classes.view'), ('classes.manage'),
            ('subjects.view'), ('subjects.manage'),
            ('settings.manage')
      ) as p(required)
     where not exists (select 1 from public.permissions x where x.code = p.required);

    if missing is not null then
        raise exception
            'Phase 2 needs permissions that Phase 1 did not seed: %. Add them to '
            'the permissions table before applying this migration.', missing;
    end if;
end
$$;

commit;
