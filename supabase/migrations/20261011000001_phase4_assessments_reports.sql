-- ===========================================================================
-- Phase 4 — Assessments and report cards
-- ===========================================================================
-- Reference: docs/srik/06_PHASE_4_ASSESSMENTS_REPORTS.md
--
-- The decision that shapes this whole migration: A REPORT CARD IS A SNAPSHOT,
-- NOT A VIEW.
--
-- The obvious design is to compute a report card from the results whenever
-- somebody opens it. That design is wrong. A school hands a child a printed
-- report, the parent signs it, and a copy goes in a file. If the report is
-- computed live, then a teacher correcting a mark in March silently changes the
-- April report that the parent already signed. Nobody would be able to tell,
-- because there is nothing to compare against.
--
-- So a published report card stores its own copy of everything it shows: the
-- marks, the attendance, the comments, the child's name, even the class name as
-- it was spelled that day. Changing the source afterwards changes nothing.
-- A correction is a NEW revision with the old one still on file, so the school
-- can always answer "what did this report say, and when did it change?".
--
-- Three smaller rules:
--
-- NULL IS NOT ZERO. A mark that has not been entered, and a child who was away,
-- are different facts from a score of zero. Storing them as 0 would make an
-- absent child look like a failing one. So a result carries a STATUS as well as
-- a score, and the database refuses a score outside 0..max_score.
--
-- TP IS A JUDGEMENT, NOT A CALCULATION. Tahap Penguasaan runs 1 to 6 and a
-- teacher decides it from evidence. Deriving it from a percentage would invent
-- an official judgement the teacher never made, so it is stored, nullable, and
-- never computed here.
--
-- GRADE BOUNDARIES ARE THE SCHOOL'S, NOT MALAYSIA'S. Schools set their own. The
-- boundaries live in a table the school edits, not as constants in code that
-- would need a release to change.

-- --- Enums ------------------------------------------------------------------

-- The kinds of assessment this school actually runs. Kept as an enum because
-- the list is short and the school chose it: exam (mid-year, final/UASA,
-- special), test/quiz, and PBD.
do $$ begin
    create type public.assessment_type as enum (
        'MID_YEAR_EXAM',
        'FINAL_EXAM',        -- UASA
        'SPECIAL_EXAM',
        'TEST',
        'QUIZ',
        'PBD'
    );
exception
    when duplicate_object then null;
end $$;

-- Whether a result counts, and why it might not. Separate from the score so
-- that "not entered" and "absent" never collapse into zero.
do $$ begin
    create type public.result_status as enum (
        'NOT_ENTERED',
        'GRADED',
        'ABSENT',
        'EXEMPT'
    );
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type public.assessment_status as enum (
        'DRAFT',
        'OPEN',
        'CLOSED',
        'PUBLISHED',
        'SUPERSEDED'
    );
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type public.report_status as enum (
        'DRAFT',
        'PUBLISHED',
        'SUPERSEDED'
    );
exception
    when duplicate_object then null;
end $$;

-- --- Grade boundaries -------------------------------------------------------
--
-- Held as data, not as code. A school changing its A boundary should be an edit
-- in a screen, not a database migration.

create table if not exists public.grade_boundaries (
    id              uuid primary key default gen_random_uuid(),
    -- Null means these boundaries apply to every academic year. A school with
    -- one scale sets them once and never thinks about it again.
    academic_year_id uuid references public.academic_years(id) on delete cascade,
    grade           text not null,
    min_percent     numeric(5,2) not null,
    max_percent     numeric(5,2) not null,
    -- For ordering in a report: A before B before C.
    sort_order      integer not null default 0,
    status          public.record_status not null default 'ACTIVE',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint grade_boundaries_range_valid check (
        min_percent >= 0 and max_percent <= 100 and min_percent <= max_percent
    )
);

create index if not exists idx_grade_boundaries_year
    on public.grade_boundaries (academic_year_id, sort_order);

-- --- Assessments ------------------------------------------------------------

create table if not exists public.assessments (
    id                uuid primary key default gen_random_uuid(),
    title             text not null,
    type              public.assessment_type not null,
    -- Both are required: a mark always belongs to one subject taught to one
    -- class in one term, and a loose assessment would not be reportable.
    subject_id        uuid not null references public.subjects(id) on delete restrict,
    class_id          uuid not null references public.classes(id) on delete restrict,
    academic_term_id  uuid not null references public.academic_terms(id) on delete restrict,
    -- The teacher who owns the marks. Kept so "who entered this?" survives even
    -- if assignments change later.
    created_by        uuid references auth.users(id) on delete set null,
    max_score         numeric(6,2) not null,
    weight            numeric(5,2) not null default 100,
    assessment_date   date,
    status            public.assessment_status not null default 'DRAFT',
    published_at      timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- A zero-mark assessment is meaningless: every child would score either
    -- 0/0 or divide by zero.
    constraint assessments_max_score_positive check (max_score > 0),
    constraint assessments_weight_positive check (weight > 0),
    -- A draft has not been published; anything else has. Written one way round
    -- so that superseding a published assessment can keep its published_at as
    -- history rather than being forced to clear it.
    constraint assessments_publish_metadata check (
        status <> 'DRAFT' or published_at is null
    )
);

create index if not exists idx_assessments_class_term
    on public.assessments (class_id, academic_term_id);
create index if not exists idx_assessments_subject
    on public.assessments (subject_id);

-- --- Assessment results -----------------------------------------------------

create table if not exists public.assessment_results (
    id             uuid primary key default gen_random_uuid(),
    assessment_id  uuid not null references public.assessments(id) on delete cascade,
    student_id     uuid not null references public.students(id) on delete cascade,
    -- The enrollment this mark belongs to. Records which class the child was in
    -- when the mark was given, so a later transfer does not rewrite history.
    enrollment_id  uuid references public.student_enrollments(id) on delete set null,
    status         public.result_status not null default 'NOT_ENTERED',
    -- Nullable on purpose. "No mark" is not zero.
    score          numeric(6,2),
    grade          text,
    -- Tahap Penguasaan, 1 to 6. A teacher's judgement, never derived.
    tp             smallint,
    comment        text,
    recorded_by    uuid references auth.users(id) on delete set null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- One mark per child per assessment. Two would make the report ambiguous.
    constraint assessment_results_unique unique (assessment_id, student_id),
    constraint assessment_results_tp_range check (tp is null or tp between 1 and 6),
    -- The rule that keeps a register honest: a graded result must have a score,
    -- and anything that is not graded must NOT have one. An absent child with a
    -- score of 0 would read as a child who failed.
    constraint assessment_results_status_score check (
        (status = 'GRADED' and score is not null)
        or (status <> 'GRADED' and score is null)
    ),
    constraint assessment_results_score_not_negative check (score is null or score >= 0)
);

create index if not exists idx_assessment_results_assessment
    on public.assessment_results (assessment_id);
create index if not exists idx_assessment_results_student
    on public.assessment_results (student_id);

-- A score may not exceed the assessment's maximum. A check constraint cannot
-- reach another table, so this is enforced by a trigger, which is the correct
-- tool rather than a compromise.
create or replace function public.enforce_result_within_max_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_max numeric(6,2);
begin
    select max_score into v_max
      from public.assessments
     where id = new.assessment_id;

    if v_max is null then
        raise exception 'Assessment % does not exist', new.assessment_id
            using errcode = 'no_data_found';
    end if;

    if new.score is not null and new.score > v_max then
        raise exception 'A score of % is above the maximum of % for this assessment',
            new.score, v_max
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_result_within_max_score on public.assessment_results;
create trigger trg_enforce_result_within_max_score
    before insert or update on public.assessment_results
    for each row execute function public.enforce_result_within_max_score();

-- The child must actually be in the class the assessment belongs to. Without
-- this, a mark could be filed against a child who was never in the room, and
-- the report would carry it.
create or replace function public.enforce_result_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class   uuid;
    v_enrolled boolean;
begin
    select class_id into v_class from public.assessments where id = new.assessment_id;

    select exists (
        select 1 from public.student_enrollments e
         where e.student_id = new.student_id
           and e.class_id = v_class
           and e.ended_at is null
    ) into v_enrolled;

    if not v_enrolled then
        raise exception 'Student % is not enrolled in the class this assessment belongs to',
            new.student_id
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_result_enrollment on public.assessment_results;
create trigger trg_enforce_result_enrollment
    before insert or update on public.assessment_results
    for each row execute function public.enforce_result_enrollment();

-- --- Report cards (the snapshot) --------------------------------------------

create table if not exists public.report_cards (
    id                uuid primary key default gen_random_uuid(),
    student_id        uuid not null references public.students(id) on delete cascade,
    academic_term_id  uuid not null references public.academic_terms(id) on delete restrict,
    -- The class the child was in when this report was made, frozen. If the
    -- child moves class, last term's report must still say the old class.
    class_id          uuid references public.classes(id) on delete set null,
    -- Revision number for this child and term. A correction becomes revision 2
    -- while revision 1 stays on file.
    version           integer not null default 1,
    status            public.report_status not null default 'DRAFT',
    -- The frozen copy: names, subjects, marks, attendance, comments, totals.
    -- Stored whole so nothing has to be recomputed from live tables later.
    snapshot          jsonb not null,
    -- Which layout of the snapshot this is, so an old report can still be read
    -- after the shape changes.
    snapshot_schema_version integer not null default 1,
    -- What this revision replaces, if it is a correction.
    supersedes_id     uuid references public.report_cards(id) on delete set null,
    published_at      timestamptz,
    published_by      uuid references auth.users(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- One revision number per child per term: two revision 2s would be
    -- ambiguous about which one is current.
    constraint report_cards_version_unique unique (student_id, academic_term_id, version),
    constraint report_cards_version_positive check (version > 0),
    constraint report_cards_publish_metadata check (
        status <> 'DRAFT' or published_at is null
    )
);

create index if not exists idx_report_cards_term
    on public.report_cards (academic_term_id, status);
create index if not exists idx_report_cards_student
    on public.report_cards (student_id, academic_term_id, version desc);
-- At most one live revision per child per term.
create unique index if not exists idx_report_cards_one_current
    on public.report_cards (student_id, academic_term_id)
    where status = 'PUBLISHED';

-- --- Permissions ------------------------------------------------------------

-- Phase 1 already defined the assessment permissions
-- (assessments.view / .create / .enter_scores / .publish). They are reused
-- rather than redefined: adding near-duplicates under new names would give the
-- school two ways to say "may enter marks", and a role could hold one and not
-- the other, which is a permission bug that is very hard to see.
--
-- Only the capability that did not exist yet is added.
insert into public.permissions (code, description, category)
values ('reports.view', 'reports',
        'View and download published report cards')
on conflict (code) do nothing;

-- The office holds every assessment capability.
insert into public.role_permissions (role_code, permission_code)
select 'ADMIN', p.code
  from public.permissions p
 where p.code in (
    'assessments.view', 'assessments.create',
    'assessments.enter_scores', 'assessments.publish',
    'reports.view'
 )
on conflict do nothing;

-- A TEACHER enters marks and reads reports. They do not create assessments and
-- do not publish report cards: those change what the school tells parents, and
-- that is the office's decision rather than something a subject teacher does
-- while entering marks.
insert into public.role_permissions (role_code, permission_code)
select 'TEACHER', p.code
  from public.permissions p
 where p.code in ('reports.view')
on conflict do nothing;


-- --- A helper that does not depend on the caller's own visibility -------------
--
-- Every scoped policy below needs to answer "which teacher is this?". The
-- obvious way is to look the row up in `teachers`, but that table's own SELECT
-- policy requires `teachers.view`, which a classroom teacher does not hold.
-- Doing the lookup inline therefore returns NOTHING for the very people the
-- policy is meant to identify, and they silently see no assessments.
--
-- This reads the link as the definer instead, so it works for anyone signed in
-- and still only ever returns the caller's own teacher row.

create or replace function public.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select t.id
      from public.teachers t
     where t.user_id = (select auth.uid())
     limit 1;
$$;

comment on function public.current_teacher_id() is
    'The teacher row belonging to the signed-in user, read without depending on '
    'the caller''s permission to list teachers. Returns null for the office.';

grant execute on function public.current_teacher_id() to authenticated;

-- --- Row level security -----------------------------------------------------

alter table public.grade_boundaries   enable row level security;
alter table public.grade_boundaries   force row level security;
alter table public.assessments        enable row level security;
alter table public.assessments        force row level security;
alter table public.assessment_results enable row level security;
alter table public.assessment_results force row level security;
alter table public.report_cards       enable row level security;
alter table public.report_cards       force row level security;

-- Everyone signed in may see the grade scale; it is not secret, and a teacher
-- needs it to understand a mark.
drop policy if exists grade_boundaries_select on public.grade_boundaries;
create policy grade_boundaries_select on public.grade_boundaries
    for select using (public.is_active_user());

drop policy if exists grade_boundaries_write on public.grade_boundaries;
create policy grade_boundaries_write on public.grade_boundaries
    for all using (public.has_permission('assessments.create'))
    with check (public.has_permission('assessments.create'));

-- --- Assessments: scoped to the teacher's own classes ------------------------
--
-- A subject teacher sees the assessments for classes they are assigned to;
-- the office sees everything. Letting every teacher browse every class would
-- expose the whole school's marks for no reason.

drop policy if exists assessments_select on public.assessments;
create policy assessments_select on public.assessments
    for select using (
        public.has_permission('assessments.create')
        or (
            public.has_permission('assessments.view')
            and exists (
                select 1 from public.teaching_assignments ta
                 where ta.class_id = assessments.class_id
                   and ta.teacher_id = public.current_teacher_id()
                   and ta.status = 'ACTIVE'
            )
        )
    );

drop policy if exists assessments_write on public.assessments;
create policy assessments_write on public.assessments
    for all using (public.has_permission('assessments.create'))
    with check (public.has_permission('assessments.create'));

drop policy if exists assessment_results_select on public.assessment_results;
create policy assessment_results_select on public.assessment_results
    for select using (
        public.has_permission('assessments.create')
        or exists (
            select 1 from public.assessments a
             where a.id = assessment_results.assessment_id
               and (
                   public.has_permission('assessments.create')
                   or exists (
                       select 1 from public.teaching_assignments ta
                        where ta.class_id = a.class_id
                          and ta.teacher_id = public.current_teacher_id()
                          and ta.status = 'ACTIVE'
                   )
               )
        )
    );

drop policy if exists assessment_results_write on public.assessment_results;
create policy assessment_results_write on public.assessment_results
    for all using (public.has_permission('assessments.enter_scores'))
    with check (public.has_permission('assessments.enter_scores'));

drop policy if exists report_cards_select on public.report_cards;
create policy report_cards_select on public.report_cards
    for select using (
        public.has_permission('reports.view')
        or public.has_permission('assessments.create')
    );

-- Report cards are written by a function, never by a screen, so there is no
-- insert or update policy here. The RPC runs as its definer and does its own
-- checking. A screen that could insert a report card directly could also invent
-- one.

-- --- Grants -----------------------------------------------------------------
--
-- Report cards and results are read-only to `authenticated`. Results are written
-- through an RPC so the enrollment and max-score checks cannot be skipped, and
-- report cards only ever come from the snapshot function.

grant select on public.grade_boundaries to authenticated;
grant insert, update, delete on public.grade_boundaries to authenticated;
grant select on public.assessments to authenticated;
grant insert, update, delete on public.assessments to authenticated;
grant select on public.assessment_results to authenticated;
grant select on public.report_cards to authenticated;
grant update on public.report_cards to authenticated;

-- ===========================================================================
-- Turn a list of marks into gradable rows
-- ===========================================================================
--
-- Called once per register rather than once per child: a class of thirty saved
-- one row at a time would leave a half-entered assessment whenever a request
-- failed, and the teacher would have no way to tell which half.
--
-- Idempotent, so re-sending after a dropped connection is safe. Rows that are
-- identical to what is already stored are counted as unchanged rather than
-- rewritten, which keeps `updated_at` meaningful.

create or replace function public.save_assessment_marks(
    p_assessment_id uuid,
    p_entries jsonb,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_entry    jsonb;
    v_student  uuid;
    v_status   public.result_status;
    v_score    numeric(6,2);
    v_tp       smallint;
    v_existing public.assessment_results;
    v_max      numeric(6,2);
    v_class    uuid;
    v_assess   public.assessments;
    v_graded   integer := 0;
    v_cleared  integer := 0;
    v_skipped  integer := 0;
    v_enroll   uuid;
begin
    if not public.has_permission('assessments.enter_scores') then
        raise exception 'You do not have permission to enter marks'
            using errcode = '42501';
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Entries must be a JSON array'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_assess from public.assessments where id = p_assessment_id;
    if v_assess.id is null then
        raise exception 'Assessment % does not exist', p_assessment_id
            using errcode = 'no_data_found';
    end if;

    -- A published assessment is the school's record. Changing it silently would
    -- make the report cards already issued disagree with the source.
    if v_assess.status = 'PUBLISHED' then
        raise exception 'This assessment is published. Unpublish it before changing marks.'
            using errcode = 'check_violation';
    end if;

    -- A teacher may only enter marks for classes they are assigned to. Without
    -- this, any teacher could write marks into any class.
    if not public.has_permission('assessments.create') then
        if not exists (
            select 1 from public.teaching_assignments ta
             where ta.class_id = v_assess.class_id
               and ta.teacher_id = public.current_teacher_id()
               and ta.status = 'ACTIVE'
        ) then
            raise exception 'You are not assigned to this class'
                using errcode = '42501';
        end if;
    end if;

    v_max := v_assess.max_score;
    v_class := v_assess.class_id;

    for v_entry in select * from jsonb_array_elements(p_entries) loop
        v_student := (v_entry->>'student_id')::uuid;
        v_status  := coalesce((v_entry->>'status')::public.result_status, 'NOT_ENTERED');
        v_tp      := nullif(v_entry->>'tp', '')::smallint;

        -- JSON numbers arrive as text when the client sends strings, so accept
        -- both rather than failing on a harmless difference in encoding.
        v_score := nullif(v_entry->>'score', '')::numeric(6,2);

        -- The status/score pairing is enforced by a check constraint, but
        -- catching it here produces a message naming the child rather than a
        -- constraint name.
        if v_status = 'GRADED' and v_score is null then
            raise exception 'A graded mark needs a score'
                using errcode = 'check_violation';
        end if;
        if v_status <> 'GRADED' and v_score is not null then
            raise exception 'Only a graded mark may carry a score; status was %', v_status
                using errcode = 'check_violation';
        end if;
        if v_score is not null and v_score > v_max then
            raise exception 'Score % is above the maximum of % for this assessment', v_score, v_max
                using errcode = 'check_violation';
        end if;
        if v_score is not null and v_score < 0 then
            raise exception 'A score cannot be negative'
                using errcode = 'check_violation';
        end if;

        -- Find the child's open enrollment, so the mark records which class they
        -- were in when it was given.
        select e.id into v_enroll
          from public.student_enrollments e
         where e.student_id = v_student
           and e.class_id = v_class
           and e.ended_at is null
         limit 1;

        if v_enroll is null then
            raise exception 'Student % is not enrolled in this class', v_student
                using errcode = 'check_violation';
        end if;

        select * into v_existing
          from public.assessment_results
         where assessment_id = p_assessment_id and student_id = v_student;

        if v_existing.id is null then
            insert into public.assessment_results
                (assessment_id, student_id, enrollment_id, status, score, tp, comment, recorded_by)
            values
                (p_assessment_id, v_student, v_enroll, v_status, v_score, v_tp,
                 v_entry->>'comment', auth.uid());
            v_graded := v_graded + 1;
        else
            -- Nothing changed: leave the row alone so its timestamp stays
            -- meaningful as "when this was last actually changed".
            if v_existing.status = v_status
               and v_existing.score is not distinct from v_score
               and v_existing.tp is not distinct from v_tp
               and v_existing.comment is not distinct from (v_entry->>'comment')
            then
                v_skipped := v_skipped + 1;
            else
                update public.assessment_results
                   set status = v_status,
                       score = v_score,
                       tp = v_tp,
                       comment = v_entry->>'comment',
                       enrollment_id = v_enroll,
                       recorded_by = auth.uid(),
                       updated_at = now()
                 where id = v_existing.id;

                if v_status = 'NOT_ENTERED' then
                    v_cleared := v_cleared + 1;
                else
                    v_graded := v_graded + 1;
                end if;
            end if;
        end if;
    end loop;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'ASSESSMENT_MARKS_SAVED', p_assessment_id,
            jsonb_build_object('graded', v_graded, 'cleared', v_cleared,
                               'unchanged', v_skipped, 'reason', p_reason));

    return jsonb_build_object(
        'graded', v_graded,
        'cleared', v_cleared,
        'unchanged', v_skipped
    );
end;
$$;

comment on function public.save_assessment_marks(uuid, jsonb, text) is
    'Saves a whole assessment register in one atomic, audited step. Rejects a '
    'score outside 0..max_score, a graded row without a score, a non-graded row '
    'with one, and a child who is not enrolled in the class. Idempotent.';

-- ===========================================================================
-- Publishing an assessment
-- ===========================================================================

create or replace function public.publish_assessment(
    p_assessment_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_assess public.assessments;
    v_total  integer;
    v_marked integer;
begin
    if not public.has_permission('assessments.publish') then
        raise exception 'You do not have permission to publish an assessment'
            using errcode = '42501';
    end if;

    select * into v_assess from public.assessments where id = p_assessment_id;
    if v_assess.id is null then
        raise exception 'Assessment % does not exist', p_assessment_id
            using errcode = 'no_data_found';
    end if;

    if v_assess.status = 'PUBLISHED' then
        raise exception 'This assessment is already published'
            using errcode = 'check_violation';
    end if;

    -- Every enrolled child must have a decided result. Publishing with children
    -- still at NOT_ENTERED would put a blank row on a report card and call it
    -- finished.
    select count(*) into v_total
      from public.student_enrollments e
     where e.class_id = v_assess.class_id and e.ended_at is null;

    if v_total = 0 then
        raise exception 'There are no students enrolled in this class'
            using errcode = 'check_violation';
    end if;

    select count(*) into v_marked
      from public.assessment_results r
      join public.student_enrollments e on e.student_id = r.student_id
     where r.assessment_id = p_assessment_id
       and e.class_id = v_assess.class_id
       and e.ended_at is null
       and r.status <> 'NOT_ENTERED';

    if v_marked < v_total then
        raise exception 'Marks are still missing for % of % students',
            (v_total - v_marked), v_total
            using errcode = 'check_violation';
    end if;

    update public.assessments
       set status = 'PUBLISHED',
           published_at = now(),
           updated_at = now()
     where id = p_assessment_id;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'ASSESSMENT_PUBLISHED', p_assessment_id,
            jsonb_build_object('marked', v_marked, 'students', v_total, 'reason', p_reason));

    return jsonb_build_object('published', true, 'students', v_total);
end;
$$;

comment on function public.publish_assessment(uuid, text) is
    'Publishes an assessment, refusing while any enrolled child still has no '
    'mark. Publishing freezes the marks against further silent edits.';

-- ===========================================================================
-- Building a report card snapshot
-- ===========================================================================
--
-- This is the heart of the phase. Everything the printed report will show is
-- copied into one JSON document and stored. From that moment the report is
-- independent of the tables it came from: correcting a mark, renaming a class
-- or moving a child to another class changes nothing about a report already
-- published.
--
-- Attendance is summarised rather than listed: a report shows "108 of 120 days",
-- not every date.

create or replace function public.build_report_snapshot(
    p_student_id uuid,
    p_academic_term_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_term      public.academic_terms;
    v_student   public.students;
    v_enroll    public.student_enrollments;
    v_class     public.classes;
    v_subjects  jsonb;
    v_att_total integer;
    v_att_present integer;
begin
    select * into v_term from public.academic_terms where id = p_academic_term_id;
    if v_term.id is null then
        raise exception 'Academic term % does not exist', p_academic_term_id
            using errcode = 'no_data_found';
    end if;

    select * into v_student from public.students where id = p_student_id;
    if v_student.id is null then
        raise exception 'Student % does not exist', p_student_id
            using errcode = 'no_data_found';
    end if;

    -- The class the child is in NOW. Frozen into the snapshot so a later move
    -- does not rewrite this report.
    select * into v_enroll
      from public.student_enrollments e
     where e.student_id = p_student_id and e.ended_at is null
     limit 1;

    if v_enroll.id is not null then
        select * into v_class from public.classes where id = v_enroll.class_id;
    end if;

    -- Every published assessment for the child's class in this term, with the
    -- child's own mark. Only published ones: a draft is a plan, not a result.
    select coalesce(jsonb_agg(row_data order by sort_key), '[]'::jsonb)
      into v_subjects
      from (
        select
            jsonb_build_object(
                'assessment_id', a.id,
                'title', a.title,
                'type', a.type,
                'subject_id', a.subject_id,
                'subject_code', s.code,
                'subject_name', s.name,
                'max_score', a.max_score,
                'weight', a.weight,
                'status', coalesce(r.status, 'NOT_ENTERED'),
                'score', r.score,
                'percent', case
                    when r.score is not null and a.max_score > 0
                    then round((r.score / a.max_score) * 100, 2)
                    else null
                end,
                'grade', r.grade,
                'tp', r.tp,
                'comment', r.comment
            ) as row_data,
            s.code || '|' || a.title as sort_key
          from public.assessments a
          join public.subjects s on s.id = a.subject_id
          left join public.assessment_results r
                 on r.assessment_id = a.id and r.student_id = p_student_id
         where a.class_id = v_enroll.class_id
           and a.academic_term_id = p_academic_term_id
           and a.status = 'PUBLISHED'
      ) sub;

    -- Attendance over the term, counted as days the school actually recorded.
    select count(*),
           count(*) filter (where sa.status in ('PRESENT', 'LATE'))
      into v_att_total, v_att_present
      from public.student_attendance sa
     where sa.student_id = p_student_id
       and sa.attendance_date between v_term.start_date and v_term.end_date;

    return jsonb_build_object(
        'schema_version', 1,
        'generated_at', now(),
        'term', jsonb_build_object(
            'id', v_term.id,
            'name', v_term.name,
            'start_date', v_term.start_date,
            'end_date', v_term.end_date
        ),
        'student', jsonb_build_object(
            'id', v_student.id,
            'full_name', v_student.full_name,
            'admission_no', v_student.admission_no,
            'gender', v_student.gender
        ),
        'class', case when v_class.id is null then null else jsonb_build_object(
            'id', v_class.id,
            'display_name', v_class.display_name,
            'year_level', v_class.year_level
        ) end,
        'assessments', v_subjects,
        'attendance', jsonb_build_object(
            'days_recorded', coalesce(v_att_total, 0),
            'days_present', coalesce(v_att_present, 0),
            -- Null, not 0, when nothing was recorded. A term with no register
            -- must not present as a child who never attended.
            'rate', case
                when coalesce(v_att_total, 0) = 0 then null
                else round((v_att_present::numeric / v_att_total) * 100, 2)
            end
        )
    );
end;
$$;

comment on function public.build_report_snapshot(uuid, uuid) is
    'Builds the frozen copy of one child''s term: marks, attendance, names and '
    'class as they stand today. Only published assessments are included.';

-- ===========================================================================
-- Publishing a report card (creates the snapshot)
-- ===========================================================================

create or replace function public.publish_report_card(
    p_student_id uuid,
    p_academic_term_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_snapshot jsonb;
    v_previous public.report_cards;
    v_version  integer;
    v_new_id   uuid;
begin
    if not public.has_permission('assessments.publish') then
        raise exception 'You do not have permission to publish a report card'
            using errcode = '42501';
    end if;

    v_snapshot := public.build_report_snapshot(p_student_id, p_academic_term_id);

    -- If a report is already live for this child and term, this is a correction,
    -- not a first issue. The old one becomes SUPERSEDED and a link is kept, so
    -- the chain can be followed backwards.
    select * into v_previous
      from public.report_cards
     where student_id = p_student_id
       and academic_term_id = p_academic_term_id
       and status = 'PUBLISHED';

    select coalesce(max(version), 0) + 1 into v_version
      from public.report_cards
     where student_id = p_student_id and academic_term_id = p_academic_term_id;

    if v_previous.id is not null then
        update public.report_cards
           set status = 'SUPERSEDED', updated_at = now()
         where id = v_previous.id;
    end if;

    insert into public.report_cards
        (student_id, academic_term_id, class_id, version, status, snapshot,
         snapshot_schema_version, supersedes_id, published_at, published_by)
    values
        (p_student_id, p_academic_term_id,
         nullif(v_snapshot->'class'->>'id', '')::uuid,
         v_version, 'PUBLISHED', v_snapshot, 1,
         v_previous.id, now(), auth.uid())
    returning id into v_new_id;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'REPORT_CARD_PUBLISHED', p_student_id,
            jsonb_build_object('term_id', p_academic_term_id, 'version', v_version,
                               'superseded', v_previous.id, 'reason', p_reason));

    return jsonb_build_object(
        'report_card_id', v_new_id,
        'version', v_version,
        'superseded_id', v_previous.id
    );
end;
$$;

comment on function public.publish_report_card(uuid, uuid, text) is
    'Publishes a report card by freezing the child''s term into a snapshot. A '
    'second publication for the same child and term becomes a new revision and '
    'supersedes the previous one, which stays on file.';

-- ===========================================================================
-- The grade scale the school starts with
-- ===========================================================================
--
-- A sensible default so the screens have something to work with. The school
-- edits these in a screen; they are not constants in code.

insert into public.grade_boundaries (academic_year_id, grade, min_percent, max_percent, sort_order)
select null, g.grade, g.lo, g.hi, g.ord
  from (values
        ('A', 80.00, 100.00, 1),
        ('B', 65.00,  79.99, 2),
        ('C', 50.00,  64.99, 3),
        ('D', 35.00,  49.99, 4),
        ('E',  0.00,  34.99, 5)
       ) as g(grade, lo, hi, ord)
 where not exists (select 1 from public.grade_boundaries);
