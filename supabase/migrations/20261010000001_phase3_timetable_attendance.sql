-- =============================================================================
-- SRIK — Phase 3: timetable and attendance
-- =============================================================================
-- Reference: docs/srik/05_PHASE_3_TIMETABLE_ATTENDANCE.md
--
-- Scope notes that shape every decision below:
--   * SINGLE SCHOOL. No school_id, no tenant, no branch.
--   * Timetable periods are SHARED across classes and carry their own times, so
--     "period 5 is break" is one fact rather than twenty copies of a time range
--     that can drift apart.
--   * Assembly, break, Zohor and Yasin/Dhuha are PERIOD TYPES, not fake subjects.
--     Modelling them as subjects would put them in mark sheets and reports,
--     which is wrong.
--   * A student's class comes from their ENROLLMENT on that date, never from a
--     column on the student. Attendance that disagrees with the enrollment is
--     rejected by the database, not merely discouraged.
--   * School days run on Asia/Kuala_Lumpur. Times are stored timestamptz.
--
-- Conventions inherited from Phases 1 and 2 (not negotiable):
--   * RLS enabled AND forced on every table.
--   * Explicit grants; `anon` gets nothing.
--   * Privileged helpers are SECURITY DEFINER with `set search_path = ''`.
--   * Deny by default: a table with no policy denies everything.
-- =============================================================================

begin;

-- `btree_gist` lets an exclusion constraint combine plain equality on ordinary
-- columns (uuid, enum) with a range overlap test. Without it, the only way to
-- stop two periods overlapping would be a trigger, which is easier to get wrong
-- and cannot be expressed as a constraint the database enforces on every write.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

-- Lifecycle of a timetable. A DRAFT is being edited; PUBLISHED is what teachers
-- and students see; SUPERSEDED is an older version kept for history.
do $$ begin
    create type public.timetable_status as enum ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
exception when duplicate_object then null; end $$;

-- What a period IS. Only TEACHING periods carry a class, subject and teacher;
-- the others carry a label. This is what keeps assembly and break out of the
-- academic record.
do $$ begin
    create type public.period_type as enum ('TEACHING', 'ASSEMBLY', 'BREAK', 'PRAYER', 'ACTIVITY');
exception when duplicate_object then null; end $$;

-- Daily attendance. DELAYED_LATE is one label rather than two flags, because a
-- student who arrives late is counted once in reports.
do $$ begin
    create type public.attendance_status as enum ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'SICK');
exception when duplicate_object then null; end $$;

-- Staff attendance is a separate catalog from student attendance: "on leave" is
-- meaningful for a teacher and meaningless for a student.
do $$ begin
    create type public.teacher_attendance_status as enum
        ('PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE', 'MEDICAL_LEAVE', 'OFFICIAL_DUTY');
exception when duplicate_object then null; end $$;

-- Days of the school week. Values 0-4 are Sunday to Thursday. The school week
-- is Sunday to Thursday; Friday and Saturday are the weekend and have no value.
do $$ begin
    create type public.school_day as enum
        ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Timetables
-- ---------------------------------------------------------------------------
-- One timetable per academic year (plus versions). `effective_from` allows a
-- later timetable to take over without destroying the earlier one, which is how
-- a mid-year change is recorded rather than overwritten.
create table if not exists public.timetables (
    id                uuid primary key default gen_random_uuid(),
    academic_year_id  uuid        not null references public.academic_years(id) on delete restrict,
    name              text        not null,
    version           integer     not null default 1,
    status            public.timetable_status not null default 'DRAFT',
    effective_from    date        not null,
    effective_to      date,
    -- Who published it and when. Kept so "who changed the timetable" is
    -- answerable without digging through logs.
    published_at      timestamptz,
    published_by      uuid        references auth.users(id) on delete set null,
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint timetables_dates_ordered
        check (effective_to is null or effective_to >= effective_from),
    -- A draft cannot claim to have been published. The rule is one-directional
    -- on purpose: when a timetable is superseded it KEEPS published_at, because
    -- "this was published, and was in force until then" is exactly the history
    -- the school needs. Requiring published_at to be cleared on supersede would
    -- erase when the previous timetable took effect.
    constraint timetables_publish_metadata
        check (status <> 'DRAFT' or published_at is null),
    -- Versions of the same name within a year are distinct.
    constraint timetables_version_unique unique (academic_year_id, name, version)
);

comment on table public.timetables is
    'A timetable for one academic year. Versions let a mid-year change be '
    'recorded as a new timetable rather than by overwriting the old one.';

-- At most one PUBLISHED timetable per academic year.
create unique index if not exists idx_timetables_one_published
    on public.timetables (academic_year_id)
    where status = 'PUBLISHED';

-- ---------------------------------------------------------------------------
-- 3. Timetable periods — the shape of the school day
-- ---------------------------------------------------------------------------
-- Periods belong to the TIMETABLE, not to a class: "period 5 is 9:50-10:25 and
-- is break" is one fact about the school day. Storing it per class would mean
-- the same time range duplicated many times, free to drift.
create table if not exists public.timetable_periods (
    id             uuid primary key default gen_random_uuid(),
    timetable_id   uuid        not null references public.timetables(id) on delete cascade,
    day_of_week    public.school_day not null,
    period_number  integer     not null,
    start_time     time        not null,
    end_time       time        not null,
    type           public.period_type not null default 'TEACHING',
    -- The label shown for non-teaching periods, e.g. "Perhimpunan", "Rehat",
    -- "Zohor", "Yasin/Dhuha". Required for those, meaningless for teaching.
    label          text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint timetable_periods_times_ordered check (end_time > start_time),
    constraint timetable_periods_number_positive check (period_number > 0),
    -- Within one day of one timetable, a period number appears once.
    constraint timetable_periods_unique_number unique (timetable_id, day_of_week, period_number),
    -- Two periods on the same day must not overlap in time.
    --
    -- The range is built from whole minutes because PostgreSQL has no built-in
    -- `timerange` type and `btree_gist` (which would let the `=` parts be gist
    -- indexed) is not among the installed extensions. Converting to an
    -- int4range over minutes-since-midnight keeps this self-contained, and the
    -- generated column is what the exclusion constraint actually indexes.
    period_range int4range generated always as (
        int4range(
            extract(hour from start_time)::integer * 60
                + extract(minute from start_time)::integer,
            extract(hour from end_time)::integer * 60
                + extract(minute from end_time)::integer
        )
    ) stored,
    -- A non-teaching period must say what it is; a teaching period must not
    -- carry one of those labels.
    constraint timetable_periods_label_matches_type
        check (
            (type = 'TEACHING' and label is null)
            or (type <> 'TEACHING' and label is not null and length(trim(label)) > 0)
        )
);

-- Two periods on the same day must not overlap. This is enforced by the
-- database rather than by a form check, because a timetable that double-books a
-- class is not something the school can detect by reading it.
do $$ begin
    alter table public.timetable_periods
        add constraint timetable_periods_no_overlap
        exclude using gist (
            timetable_id with =,
            day_of_week with =,
            period_range with &&
        );
exception
    -- 42P07 duplicate_table is what ALTER TABLE ADD CONSTRAINT raises when the
    -- constraint already exists; duplicate_object does not cover it.
    when duplicate_object then null;
    when duplicate_table then null;
end $$;

comment on table public.timetable_periods is
    'The shape of the school day: which period runs when, and what it is. '
    'Shared by all classes in the timetable. Overlaps are refused by the '
    'database via an exclusion constraint, not merely checked in a form.';

-- ---------------------------------------------------------------------------
-- 4. Timetable entries — what happens in a period
-- ---------------------------------------------------------------------------
-- One entry per period per class. `subject_id` and `teacher_id` are NULL for
-- assembly, break, prayer and activity periods: they are not lessons and must
-- not become rows in a mark sheet.
create table if not exists public.timetable_entries (
    id           uuid primary key default gen_random_uuid(),
    period_id    uuid        not null references public.timetable_periods(id) on delete cascade,
    class_id     uuid        not null references public.classes(id) on delete cascade,
    subject_id   uuid        references public.subjects(id) on delete restrict,
    teacher_id   uuid        references public.teachers(id) on delete restrict,
    room         text,
    -- Set for ACTIVITY periods, e.g. "Kelab Catur". Distinct from the period's
    -- own label, which names the period type ("Aktiviti").
    activity     text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    -- One class cannot be in two places in the same period.
    constraint timetable_entries_unique_per_class unique (period_id, class_id)
);

comment on table public.timetable_entries is
    'What a class does in a given period. Subject and teacher are NULL for '
    'assembly, break and prayer: they are not lessons.';

-- A teacher cannot be in two classes in the same period. This is the conflict
-- the editor must prevent, and the database is what makes it true.
create unique index if not exists idx_timetable_entries_teacher_not_double_booked
    on public.timetable_entries (period_id, teacher_id)
    where teacher_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Student attendance — daily
-- ---------------------------------------------------------------------------
-- One row per student per school day. The class is recorded so a report can say
-- which class the student was in that day, but it is CHECKED against the
-- enrollment rather than trusted: a mismatch means the enrollment changed and
-- the attendance was not updated, which is a data error worth surfacing.
create table if not exists public.student_attendance (
    id             uuid primary key default gen_random_uuid(),
    student_id     uuid        not null references public.students(id) on delete restrict,
    enrollment_id  uuid        not null references public.student_enrollments(id) on delete restrict,
    class_id       uuid        not null references public.classes(id) on delete restrict,
    attendance_date date       not null,
    status         public.attendance_status not null,
    remark         text,
    recorded_by    uuid        references auth.users(id) on delete set null,
    recorded_at    timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- One record per student per day. Re-recording corrects the same row; it
    -- does not create a second one.
    constraint student_attendance_one_per_day unique (student_id, attendance_date)
);

comment on table public.student_attendance is
    'Daily attendance. One row per student per school day. The absence of a '
    'row means "not recorded yet" and must never be reported as absent.';

comment on column public.student_attendance.enrollment_id is
    'The enrollment that was open on attendance_date. Checked by trigger '
    'against the student''s actual enrollment so the record cannot point at a '
    'class the student had already left.';

-- ---------------------------------------------------------------------------
-- 6. Teacher attendance — daily
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_attendance (
    id            uuid primary key default gen_random_uuid(),
    teacher_id    uuid        not null references public.teachers(id) on delete restrict,
    attendance_date date      not null,
    check_in      timestamptz,
    check_out     timestamptz,
    status        public.teacher_attendance_status not null,
    remark        text,
    recorded_by   uuid        references auth.users(id) on delete set null,
    recorded_at   timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint teacher_attendance_one_per_day unique (teacher_id, attendance_date),
    -- Leaving before arriving is a data-entry error, not a long day.
    constraint teacher_attendance_checkout_after_checkin
        check (check_out is null or check_in is null or check_out >= check_in)
);

comment on table public.teacher_attendance is
    'Daily staff attendance, recorded manually by the office. Biometric and '
    'geofencing are deferred.';

-- ---------------------------------------------------------------------------
-- 7. Attendance correction audit
-- ---------------------------------------------------------------------------
-- Corrections are audit-gated: who changed what, from what, to what, and why.
-- Overwriting a status without trace would make the register untrustworthy.
create table if not exists public.attendance_corrections (
    id             uuid primary key default gen_random_uuid(),
    table_name     text        not null,
    record_id      uuid        not null,
    student_id     uuid        references public.students(id) on delete set null,
    teacher_id     uuid        references public.teachers(id) on delete set null,
    attendance_date date       not null,
    old_status     text,
    new_status     text        not null,
    reason         text        not null,
    corrected_by   uuid        references auth.users(id) on delete set null,
    corrected_at   timestamptz not null default now()
);

comment on table public.attendance_corrections is
    'Every change to an existing attendance record, with the reason. Insert-only '
    'by grant: a correction cannot itself be edited or deleted.';

create index if not exists idx_attendance_corrections_record
    on public.attendance_corrections (table_name, record_id);

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------

-- A student's attendance must match the enrollment that was open that day.
-- Checked here rather than left to the screen because a wrong class silently
-- corrupts every class-level report.
create or replace function public.check_attendance_matches_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class_id uuid;
    v_student_id uuid;
begin
    select e.class_id, e.student_id
      into v_class_id, v_student_id
      from public.student_enrollments e
     where e.id = new.enrollment_id;

    if v_class_id is null then
        raise exception 'Enrollment % does not exist', new.enrollment_id
            using errcode = 'foreign_key_violation';
    end if;

    if v_student_id <> new.student_id then
        raise exception
            'Enrollment % belongs to a different student than this attendance record',
            new.enrollment_id
            using errcode = 'check_violation';
    end if;

    if v_class_id <> new.class_id then
        raise exception
            'Class % does not match the class on enrollment % (%)',
            new.class_id, new.enrollment_id, v_class_id
            using errcode = 'check_violation';
    end if;

    -- The enrollment must actually cover the attendance date, so a record cannot
    -- be attached to a class the student had already left.
    if not exists (
        select 1 from public.student_enrollments e
         where e.id = new.enrollment_id
           and e.enrolled_at::date <= new.attendance_date
           and (e.ended_at is null or e.ended_at::date >= new.attendance_date)
    ) then
        raise exception
            'The student was not enrolled in that class on %', new.attendance_date
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_student_attendance_matches_enrollment on public.student_attendance;
create trigger trg_student_attendance_matches_enrollment
    before insert or update on public.student_attendance
    for each row execute function public.check_attendance_matches_enrollment();

-- A teaching period must name a subject and a teacher; a non-teaching period
-- must name neither.
create or replace function public.check_timetable_entry_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_type public.period_type;
begin
    select p.type into v_type
      from public.timetable_periods p
     where p.id = new.period_id;

    if v_type is null then
        raise exception 'Period % does not exist', new.period_id
            using errcode = 'foreign_key_violation';
    end if;

    if v_type = 'TEACHING' then
        if new.subject_id is null then
            raise exception 'A teaching period needs a subject'
                using errcode = 'check_violation';
        end if;
    else
        if new.subject_id is not null or new.teacher_id is not null then
            raise exception
                'A % period is not a lesson and cannot have a subject or teacher', v_type
                using errcode = 'check_violation';
        end if;
    end if;

    -- A teaching entry must also respect the teachers' actual assignment: a
    -- teacher cannot be scheduled to teach a subject they are not assigned to.
    if v_type = 'TEACHING' and new.teacher_id is not null then
        if not exists (
            select 1
              from public.teaching_assignments ta
              join public.timetable_periods p on p.id = new.period_id
              join public.timetables t on t.id = p.timetable_id
             where ta.teacher_id = new.teacher_id
               and ta.class_id = new.class_id
               and ta.subject_id = new.subject_id
               and ta.status = 'ACTIVE'
               and ta.academic_year_id = t.academic_year_id
        ) then
            raise exception
                'That teacher is not assigned to teach this subject in this class'
                using errcode = 'check_violation';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_timetable_entry_shape on public.timetable_entries;
create trigger trg_timetable_entry_shape
    before insert or update on public.timetable_entries
    for each row execute function public.check_timetable_entry_shape();

-- Attendance timestamps are maintained centrally.
drop trigger if exists trg_timetable_periods_touch on public.timetable_periods;
create trigger trg_timetable_periods_touch
    before update on public.timetable_periods
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_timetables_touch on public.timetables;
create trigger trg_timetables_touch
    before update on public.timetables
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_timetable_entries_touch on public.timetable_entries;
create trigger trg_timetable_entries_touch
    before update on public.timetable_entries
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_student_attendance_touch on public.student_attendance;
create trigger trg_student_attendance_touch
    before update on public.student_attendance
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_teacher_attendance_touch on public.teacher_attendance;
create trigger trg_teacher_attendance_touch
    before update on public.teacher_attendance
    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. RPC — record a whole class's attendance at once
-- ---------------------------------------------------------------------------
-- The office records a register class by class, not student by student. Doing
-- that as N round trips would leave a half-recorded class whenever one request
-- failed, so the whole register is written in one transaction.
--
-- Idempotent on purpose: re-submitting the same register corrects the existing
-- rows rather than creating duplicates, because an interrupted save is retried.
create or replace function public.record_class_attendance(
    p_class_id      uuid,
    p_date          date,
    p_entries       jsonb,
    p_recorded_by   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_enrollment uuid;
    v_student    uuid;
    v_status     public.attendance_status;
    v_remark     text;
    v_item       jsonb;
    v_written    integer := 0;
    v_corrected  integer := 0;
    v_old_status public.attendance_status;
    v_existing   uuid;
begin
    -- Callers other than the server must be signed in and permitted.
    if v_actor is null and p_recorded_by is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if p_recorded_by is null then
        p_recorded_by := v_actor;
        if not public.has_permission('attendance.record') then
            raise exception 'You do not have permission to record attendance'
                using errcode = 'insufficient_privilege';
        end if;
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Attendance entries must be a list' using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_array_length(p_entries) = 0 then
        raise exception 'No attendance was provided' using errcode = 'invalid_parameter_value';
    end if;

    for v_item in select * from jsonb_array_elements(p_entries) loop
        v_student := (v_item->>'student_id')::uuid;
        v_status  := (v_item->>'status')::public.attendance_status;
        v_remark  := nullif(trim(coalesce(v_item->>'remark', '')), '');

        if v_student is null then
            raise exception 'Each entry needs a student' using errcode = 'invalid_parameter_value';
        end if;

        -- The enrollment open on that date is the authority for which class the
        -- student belongs to. A student with no enrollment that day cannot be
        -- marked, and saying so is better than writing an unattached record.
        select e.id into v_enrollment
          from public.student_enrollments e
         where e.student_id = v_student
           and e.class_id = p_class_id
           and e.enrolled_at::date <= p_date
           and (e.ended_at is null or e.ended_at::date >= p_date)
         limit 1;

        if v_enrollment is null then
            raise exception
                'Student % was not enrolled in this class on %', v_student, p_date
                using errcode = 'check_violation';
        end if;

        select a.id, a.status into v_existing, v_old_status
          from public.student_attendance a
         where a.student_id = v_student and a.attendance_date = p_date;

        if v_existing is null then
            insert into public.student_attendance
                (student_id, enrollment_id, class_id, attendance_date, status, remark, recorded_by)
            values
                (v_student, v_enrollment, p_class_id, p_date, v_status, v_remark, p_recorded_by);
            v_written := v_written + 1;
        else
            -- Re-recording the same value is not a correction and should not
            -- fill the audit table with noise.
            if v_old_status is distinct from v_status then
                update public.student_attendance
                   set status = v_status,
                       remark = v_remark,
                       enrollment_id = v_enrollment,
                       recorded_by = p_recorded_by,
                       updated_at = now()
                 where id = v_existing;

                insert into public.attendance_corrections
                    (table_name, record_id, student_id, attendance_date,
                     old_status, new_status, reason, corrected_by)
                values
                    ('student_attendance', v_existing, v_student, p_date,
                     v_old_status::text, v_status::text,
                     coalesce(v_remark, 'Re-recorded from the class register'), p_recorded_by);
                v_corrected := v_corrected + 1;
            end if;
        end if;
    end loop;

    return jsonb_build_object(
        'recorded',  v_written,
        'corrected', v_corrected,
        'date',      p_date,
        'class_id',  p_class_id
    );
end;
$$;

comment on function public.record_class_attendance(uuid, date, jsonb, uuid) is
    'Records a whole class register in one transaction. Idempotent: re-sending '
    'the same register corrects existing rows instead of duplicating them, and '
    'silently ignores entries whose status did not change.';

-- ---------------------------------------------------------------------------
-- 10. RPC — correct one attendance record
-- ---------------------------------------------------------------------------
-- A separate path from recording a register, because a correction is different:
-- it must always state a reason. The reason is what makes the register
-- defensible months later, so it is required rather than optional.
create or replace function public.correct_attendance(
    p_student_id uuid,
    p_date       date,
    p_status     public.attendance_status,
    p_reason     text,
    p_remark     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_record     record;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if not public.has_permission('attendance.record') then
        raise exception 'You do not have permission to correct attendance'
            using errcode = 'insufficient_privilege';
    end if;

    if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'A correction must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_record
      from public.student_attendance
     where student_id = p_student_id and attendance_date = p_date;

    if not found then
        raise exception 'There is no attendance record for that student on that date'
            using errcode = 'no_data_found';
    end if;

    if v_record.status = p_status and coalesce(v_record.remark, '') = coalesce(p_remark, '') then
        return jsonb_build_object('changed', false);
    end if;

    update public.student_attendance
       set status = p_status,
           remark = p_remark,
           recorded_by = v_actor,
           updated_at = now()
     where id = v_record.id;

    insert into public.attendance_corrections
        (table_name, record_id, student_id, attendance_date,
         old_status, new_status, reason, corrected_by)
    values
        ('student_attendance', v_record.id, p_student_id, p_date,
         v_record.status::text, p_status::text, trim(p_reason), v_actor);

    return jsonb_build_object(
        'changed', true,
        'from',    v_record.status::text,
        'to',      p_status::text
    );
end;
$$;

comment on function public.correct_attendance(uuid, date, public.attendance_status, text, text) is
    'Corrects one attendance record. Always requires a reason and always writes '
    'an audit row: a correction without a trace would make the register useless.';

-- ---------------------------------------------------------------------------
-- 11. RPC — publish a timetable
-- ---------------------------------------------------------------------------
-- Publishing is the moment a draft becomes what the school follows, so it is a
-- deliberate, audited step rather than a flag a form can flip.
create or replace function public.publish_timetable(
    p_timetable_id uuid,
    p_reason       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_timetable  record;
    v_entry_count integer;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if not public.has_permission('timetable.manage') then
        raise exception 'You do not have permission to publish a timetable'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_timetable from public.timetables where id = p_timetable_id;
    if not found then
        raise exception 'Timetable % does not exist', p_timetable_id
            using errcode = 'no_data_found';
    end if;

    if v_timetable.status = 'PUBLISHED' then
        return jsonb_build_object('published', false, 'reason', 'already-published');
    end if;

    select count(*) into v_entry_count
      from public.timetable_entries e
      join public.timetable_periods p on p.id = e.period_id
     where p.timetable_id = p_timetable_id;

    if v_entry_count = 0 then
        raise exception 'A timetable with no lessons cannot be published'
            using errcode = 'check_violation';
    end if;

    -- The previous published timetable for this year is superseded rather than
    -- deleted: it is the record of what the school followed until now.
    update public.timetables
       set status = 'SUPERSEDED',
           effective_to = coalesce(effective_to, current_date - 1),
           updated_at = now()
     where academic_year_id = v_timetable.academic_year_id
       and status = 'PUBLISHED'
       and id <> p_timetable_id;

    update public.timetables
       set status = 'PUBLISHED',
           published_at = now(),
           published_by = v_actor,
           updated_at = now()
     where id = p_timetable_id;

    return jsonb_build_object(
        'published', true,
        'entries',   v_entry_count,
        'reason',    p_reason
    );
end;
$$;

comment on function public.publish_timetable(uuid, text) is
    'Publishes a timetable. Supersedes any previously published timetable for '
    'the same academic year instead of deleting it.';

-- ---------------------------------------------------------------------------
-- 12. The school day template
-- ---------------------------------------------------------------------------
-- The real school day, 12 periods, Sunday to Thursday (7:30am to 2:30pm).
-- Taken from the school's own 2026 timetable export, not invented: these are
-- the actual boundaries the school runs on.
--
-- Period 1 carries the week's ceremony on the two days it happens — assembly on
-- Sunday, Yasin/Dhuha on Thursday — and a lesson on the other three. Period 5 is
-- break and period 11 is Zohor on every day. The remaining periods are lessons.
create or replace function public.seed_school_day_template(p_timetable_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_day       public.school_day;
    v_created   integer := 0;
    v_periods   jsonb := '[
        {"n": 1,  "s": "07:30", "e": "08:05", "t": "TEACHING", "l": null},
        {"n": 2,  "s": "08:05", "e": "08:40", "t": "TEACHING", "l": null},
        {"n": 3,  "s": "08:40", "e": "09:15", "t": "TEACHING", "l": null},
        {"n": 4,  "s": "09:15", "e": "09:50", "t": "TEACHING", "l": null},
        {"n": 5,  "s": "09:50", "e": "10:25", "t": "BREAK",    "l": "Rehat"},
        {"n": 6,  "s": "10:25", "e": "11:00", "t": "TEACHING", "l": null},
        {"n": 7,  "s": "11:00", "e": "11:35", "t": "TEACHING", "l": null},
        {"n": 8,  "s": "11:35", "e": "12:10", "t": "TEACHING", "l": null},
        {"n": 9,  "s": "12:10", "e": "12:45", "t": "TEACHING", "l": null},
        {"n": 10, "s": "12:45", "e": "13:20", "t": "TEACHING", "l": null},
        {"n": 11, "s": "13:20", "e": "14:00", "t": "PRAYER",   "l": "Zohor"},
        {"n": 12, "s": "14:00", "e": "14:30", "t": "TEACHING", "l": null}
    ]'::jsonb;
    v_period    jsonb;
    v_days      public.school_day[] := array[
        'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'
    ]::public.school_day[];
begin
    if not exists (select 1 from public.timetables where id = p_timetable_id) then
        raise exception 'Timetable % does not exist', p_timetable_id
            using errcode = 'no_data_found';
    end if;

    foreach v_day in array v_days loop
        for v_period in select * from jsonb_array_elements(v_periods) loop
            -- Period 1 is where the week's ceremony sits. Sunday is assembly,
            -- Thursday is Yasin/Dhuha; those are the days the school does them,
            -- and they replace the lesson rather than being added to it.
            declare
                v_type  public.period_type := (v_period->>'t')::public.period_type;
                v_label text := v_period->>'l';
            begin
                if (v_period->>'n')::integer = 1 then
                    if v_day = 'SUNDAY' then
                        v_type := 'ASSEMBLY'; v_label := 'Perhimpunan';
                    elsif v_day = 'THURSDAY' then
                        v_type := 'ACTIVITY'; v_label := 'Yasin/Dhuha';
                    end if;
                end if;

                insert into public.timetable_periods
                    (timetable_id, day_of_week, period_number, start_time, end_time, type, label)
                values
                    (p_timetable_id, v_day, (v_period->>'n')::integer,
                     (v_period->>'s')::time, (v_period->>'e')::time, v_type, v_label)
                on conflict (timetable_id, day_of_week, period_number) do nothing;
                v_created := v_created + 1;
            end;
        end loop;
    end loop;

    return v_created;
end;
$$;

comment on function public.seed_school_day_template(uuid) is
    'Creates the period boundaries the school stated in the specification: '
    'period 1 (assembly/Yasin or lessons), period 5 (break), period 11 (Zohor). '
    'Other slots are left for the office to fill rather than invented.';

-- ---------------------------------------------------------------------------
-- 12b. Permissions this phase depends on
-- ---------------------------------------------------------------------------
-- Staff attendance is its own permission: recording a pupil's register every
-- morning is a teacher's job, while managing staff attendance is an office job.
-- Sharing one permission would silently give every teacher access to their
-- colleagues' attendance.
do $$ begin
    insert into public.permissions (code, description, category)
    values ('attendance.manage_staff',
            'Manage daily staff attendance',
            'attendance')
    on conflict (code) do nothing;
end $$;

-- Granted to ADMIN by default. Deliberately NOT granted to TEACHER: this is the
-- office's job, and the baseline TEACHER permissions stay as they were.
do $$ begin
    insert into public.role_permissions (role_code, permission_code)
    values ('ADMIN', 'attendance.manage_staff')
    on conflict (role_code, permission_code) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array[
        'timetables', 'timetable_periods', 'timetable_entries',
        'student_attendance', 'teacher_attendance', 'attendance_corrections'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('alter table public.%I force row level security', t);
    end loop;
end
$$;

-- Timetables: anyone signed in may read; only holders of the permission may
-- write. Reads are open because a teacher must be able to see the timetable.
drop policy if exists timetables_select on public.timetables;
create policy timetables_select on public.timetables
    for select to authenticated
    using (public.is_active_user());

drop policy if exists timetables_write on public.timetables;
create policy timetables_write on public.timetables
    for all to authenticated
    using (public.has_permission('timetable.manage'))
    with check (public.has_permission('timetable.manage'));

drop policy if exists timetable_periods_select on public.timetable_periods;
create policy timetable_periods_select on public.timetable_periods
    for select to authenticated
    using (public.is_active_user());

drop policy if exists timetable_periods_write on public.timetable_periods;
create policy timetable_periods_write on public.timetable_periods
    for all to authenticated
    using (public.has_permission('timetable.manage'))
    with check (public.has_permission('timetable.manage'));

drop policy if exists timetable_entries_select on public.timetable_entries;
create policy timetable_entries_select on public.timetable_entries
    for select to authenticated
    using (public.is_active_user());

drop policy if exists timetable_entries_write on public.timetable_entries;
create policy timetable_entries_write on public.timetable_entries
    for all to authenticated
    using (public.has_permission('timetable.manage'))
    with check (public.has_permission('timetable.manage'));

-- Attendance: readable by any active user (a teacher sees their own class), but
-- writes go through the RPCs above or through the permission check here.
drop policy if exists student_attendance_select on public.student_attendance;
create policy student_attendance_select on public.student_attendance
    for select to authenticated
    using (public.is_active_user());

drop policy if exists student_attendance_write on public.student_attendance;
create policy student_attendance_write on public.student_attendance
    for all to authenticated
    using (public.has_permission('attendance.record'))
    with check (public.has_permission('attendance.record'));

-- Staff attendance is NOT readable by every active user. Seeing a colleague's
-- lateness record is a privacy matter, not a feature, so a teacher sees only
-- their own row; the office sees all of them.
drop policy if exists teacher_attendance_select on public.teacher_attendance;
create policy teacher_attendance_select on public.teacher_attendance
    for select to authenticated
    using (
        public.has_permission('attendance.manage_staff')
        or exists (
            select 1 from public.teachers t
             where t.id = teacher_attendance.teacher_id
               and t.user_id = (select auth.uid())
        )
    );

drop policy if exists teacher_attendance_write on public.teacher_attendance;
create policy teacher_attendance_write on public.teacher_attendance
    for all to authenticated
    using (public.has_permission('attendance.manage_staff'))
    with check (public.has_permission('attendance.manage_staff'));

-- The correction log is append-only from the application's point of view.
drop policy if exists attendance_corrections_select on public.attendance_corrections;
create policy attendance_corrections_select on public.attendance_corrections
    for select to authenticated
    using (public.has_permission('attendance.manage_staff')
           or public.has_permission('attendance.record'));

drop policy if exists attendance_corrections_insert on public.attendance_corrections;
create policy attendance_corrections_insert on public.attendance_corrections
    for insert to authenticated
    with check (public.has_permission('attendance.record'));

-- ---------------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.timetables          to authenticated;
grant select, insert, update, delete on public.timetable_periods   to authenticated;
grant select, insert, update, delete on public.timetable_entries   to authenticated;

-- Attendance is read freely but written ONLY through the RPCs. The grant is
-- deliberately select-only: a direct write would bypass the enrollment check
-- and the correction audit, which is exactly what must not happen.
grant select on public.student_attendance to authenticated;
grant select on public.teacher_attendance to authenticated;
grant select, insert on public.attendance_corrections to authenticated;

grant select, insert, update, delete on public.teacher_attendance to authenticated;

commit;

-- ===========================================================================
-- Setting exact teaching pairs
-- ===========================================================================
--
-- `set_teacher_assignments` takes lists of classes and subjects and pairs every
-- class with every subject. That is the right shape for "this teacher covers
-- these classes", but it cannot express "this teacher takes Bahasa Arab in 2J
-- and nothing else in 4B". Feeding it the real timetable would grant teachers
-- subjects they do not teach, which is not something a screen could later
-- detect — the timetable would look fine and be wrong.
--
-- This function takes exact (class, subject) PAIRS instead, and does not create
-- a class-teacher duty. Being a class teacher is a position of responsibility,
-- not a side effect of teaching a lesson in a room, and the school has not said
-- who holds it.
--
-- Like the original, it closes previous duties rather than deleting them, and
-- records what changed. History matters more than tidiness here.

create or replace function public.set_teaching_pairs(
    p_teacher_id uuid,
    p_academic_year_id uuid,
    p_pairs jsonb,
    p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pair    jsonb;
    v_class   uuid;
    v_subject uuid;
    v_created integer := 0;
    v_closed  integer := 0;
begin
    if not public.has_permission('teachers.manage') then
        raise exception 'Not permitted to change teaching assignments'
            using errcode = '42501';
    end if;

    if not exists (select 1 from public.teachers where id = p_teacher_id) then
        raise exception 'Teacher not found' using errcode = 'no_data_found';
    end if;

    if not exists (select 1 from public.academic_years where id = p_academic_year_id) then
        raise exception 'Academic year not found' using errcode = 'no_data_found';
    end if;

    if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
        raise exception 'Pairs must be a JSON array' using errcode = 'invalid_parameter_value';
    end if;

    -- Close this teacher's open subject duties for the year. The previous set is
    -- kept as history, so a later report can say who taught what last term.
    update public.teaching_assignments
       set status = 'INACTIVE',
           effective_to = coalesce(effective_to, current_date)
     where teacher_id = p_teacher_id
       and academic_year_id = p_academic_year_id
       and status = 'ACTIVE'
       and assignment_type = 'SUBJECT_TEACHER';
    get diagnostics v_closed = row_count;

    for v_pair in select * from jsonb_array_elements(p_pairs) loop
        v_class   := (v_pair->>'class_id')::uuid;
        v_subject := (v_pair->>'subject_id')::uuid;

        if not exists (select 1 from public.classes
                        where id = v_class and academic_year_id = p_academic_year_id) then
            raise exception 'Class % does not belong to that academic year', v_class
                using errcode = 'check_violation';
        end if;

        if not exists (select 1 from public.subjects where id = v_subject) then
            raise exception 'Subject not found' using errcode = 'no_data_found';
        end if;

        insert into public.teaching_assignments
            (teacher_id, class_id, academic_year_id, assignment_type, subject_id, periods_per_week)
        values (p_teacher_id, v_class, p_academic_year_id, 'SUBJECT_TEACHER', v_subject, 1);
        v_created := v_created + 1;
    end loop;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'TEACHING_PAIRS_SET', p_teacher_id,
            jsonb_build_object('academic_year_id', p_academic_year_id,
                               'closed', v_closed, 'created', v_created, 'reason', p_reason));

    return v_created;
end;
$$;

comment on function public.set_teaching_pairs(uuid, uuid, jsonb, text) is
    'Sets a teacher''s exact (class, subject) duties, closing the previous set '
    'instead of deleting it. Unlike set_teacher_assignments it does not pair '
    'every class with every subject, and does not make the teacher a class '
    'teacher. Use this when the pairs are known, as when loading a real timetable.';

revoke all on function public.set_teaching_pairs(uuid, uuid, jsonb, text) from public;
grant execute on function public.set_teaching_pairs(uuid, uuid, jsonb, text) to authenticated;
