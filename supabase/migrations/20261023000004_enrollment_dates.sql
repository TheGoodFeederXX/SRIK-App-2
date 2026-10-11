-- =============================================================================
-- SRIK — audit findings F23, F24 and F25: which class is a child in, and when.
--
-- All three are the same question asked at different moments, so they are fixed
-- together. Splitting them would leave the database answering the question two
-- ways, which is how the disagreement started.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE OF THE PROBLEM.
--
-- "What class is this student in" is not a field on the student. It is derived from
-- `student_enrollments`: the row covering the date you care about. Everything —
-- the student directory, attendance, the timetable, report cards — asks that
-- question, and until now every caller answered it itself, by filtering
-- `ended_at is null`.
--
-- That filter is wrong in three separate ways.
--
--   F24 — PROMOTION. `enroll_student` closes the child's open enrollment IN THE
--   SAME YEAR only. Promoting a child from 2026 to 2027 therefore leaves the 2026
--   row open and adds a 2027 row, and BOTH have `ended_at is null`. The unique
--   index is `(student_id, academic_year_id) where ended_at is null`, so the
--   database is satisfied — the two rows are in different years. But every reader
--   filtering on `ended_at is null` alone now sees two, and:
--     * the directory shows whichever row the database happened to return,
--     * `getStudent` uses `maybeSingle()`, which ERRORS on two rows, so a promoted
--       child's record fails to open entirely,
--     * attendance resolves the class for "today" against a 2027 placement.
--   Worse, the 2027 row carries `enrolled_at = now()`, i.e. the day the office
--   typed it — before 2027 has begun. The child is placed in next year's class
--   months early, without anyone deciding the cutover date.
--
--   F25 — HISTORICAL ATTENDANCE. `getClassRegister` was fixed to read the
--   enrollment open ON THE DATE, but readers that filter `ended_at is null` still
--   answer for TODAY. Marking a register for a date in the previous term, or
--   reading an old class list, resolves the class of the moment the page was
--   opened rather than of the day in question. A child who moved class in March
--   appears on the wrong register for February.
--
--   F23 — HISTORICAL SNAPSHOTS. A published 2026 report card must keep the class
--   the child was in during 2026 — the whole point of a snapshot. The snapshot
--   builder picked the enrollment by `ended_at is null` with no reference to the
--   term's year or dates, so after promotion a regenerated 2026 report would name
--   the 2027 class. The marks are right; the class named against them is not.
--
-- ---------------------------------------------------------------------------
-- THE FIX, in three parts.
--
-- 1. ONE FUNCTION answers the question, so the readers cannot disagree:
--    `class_on(student, date)`. It resolves in this order:
--      a. the enrollment whose interval COVERS the date, preferred by the
--         academic year that is CURRENT — a real placement;
--      b. failing that, the open enrollment of the CURRENT year — a child enrolled
--         for this year whose dates are looser than the day being asked about;
--      c. failing that, nothing. Not last year's class, not next year's.
--    Returning nothing is deliberate: a child with no placement on that date did
--    not attend, and naming a class they were not in is worse than naming none.
--
-- 2. `enroll_student` takes an EFFECTIVE DATE and closes only what that date
--    actually supersedes. Bringing a child into 2027 no longer touches their 2026
--    row, so the 2026 record stays true for 2026.
--
-- 3. A PROMOTION FUNCTION that plans next year's placement properly:
--    `plan_next_year_enrollment(student, class)` writes the 2027 row with the
--    year's own start date rather than `now()`, so the child is not in 2027's
--    class until 2027 starts.
--
-- WHAT IS NOT DONE HERE, ON PURPOSE. Existing readers are not rewritten by this
-- migration. A SQL migration changing what ten JavaScript files return would be
-- invisible at the point of change and impossible to review. The database now
-- offers the correct answer; the callers are moved to it next, and the guard tests
-- in this suite pin the database behaviour so that move cannot drift.
--
-- WHERE THE MIGRATION ORDER MATTERS. Definitions come BEFORE grants. `create or
-- replace function` resets a function's privileges to the default, so a grant
-- written above its definition is silently undone.
begin;

-- ---------------------------------------------------------------------------
-- 1. The single answer: which class was this student in on this date.
-- ---------------------------------------------------------------------------
create or replace function public.class_on(
    p_student_id uuid,
    p_date date default current_date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    with current_year as (
        select cy.id
          from public.academic_years cy
         where cy.status = 'CURRENT'
         limit 1
    )
    select e.class_id
      from public.student_enrollments e
      -- The enrollment's own year, so its start and end dates are available: a
      -- placement is only authoritative for dates its year actually covers.
      join public.academic_years y on y.id = e.academic_year_id
      left join current_year cy on true
     where e.student_id = p_student_id
       -- NOT filtered on `status = 'ACTIVE'`, and this was a real bug in the first
       -- version of this migration.
       --
       -- A placement that has ENDED is still the answer for the dates it covered. A
       -- child who was in 3J from January to June and 3B from July resolves to 3J
       -- when you ask about March — and that row carries `status = 'INACTIVE'`
       -- precisely because it ended. Filtering on ACTIVE made every historical
       -- question return nothing, which is the F23/F25 defect wearing a different
       -- hat: the 2026 report card would name no class at all.
       --
       -- What makes a row eligible is its DATES, not its status. The interval
       -- conditions below are the whole test. Only ARCHIVED is excluded, as a
       -- deliberate marker that a record was withdrawn and should not be shown.
       and e.status <> 'ARCHIVED'

       -- (a) A placement whose interval covers the date. This is the answer a
       -- school administrator would give: the class the child was actually in.
       --
       -- `enrolled_at` is a timestamp and the question is about a date, so the
       -- comparison is on the DATE. Comparing a timestamp to a date casts the
       -- date to midnight, which would make a child enrolled at 08:00 on their
       -- first morning invisible until the next day — the audit records exactly
       -- this trap (F25).
       and e.enrolled_at::date <= p_date
       and (e.ended_at is null or e.ended_at::date >= p_date)

     order by
       -- 1. A placement inside its OWN year beats one that merely runs past the
       --    date.
       --
       --    This is the ordering that matters, and the first version got it wrong.
       --    It preferred the CURRENT academic year outright — so with 2026 current
       --    and a 2027 placement planned, a question about 2027-01-15 returned the
       --    2026 class, because that row was still open and belonged to the current
       --    year. The child sat in last year's class forever.
       --
       --    A placement is only authoritative for dates the enrollment's year
       --    actually covers. Anything else is a row that happened to be left open.
       --    The test caught this; the reasoning was wrong, not the arithmetic.
       (p_date between y.start_date and y.end_date) desc,
       -- 2. Then the current academic year, for a date two years overlap on — a
       --    child placed in 2027 while 2026 is still current, asked about a date
       --    both could claim.
       (e.academic_year_id = cy.id) desc nulls last,
       -- 3. THE MOST RECENT PLACEMENT WINS, and this is the whole answer for a
       --    mid-year move.
       --
       --    The first version of this migration ordered by `ended_at is not null
       --    desc` here, reasoning that a row deliberately ended is "more specific".
       --    That is backwards and the test caught it. When a child moves from 3J to
       --    3B in April, BOTH rows cover a question about May: the 3J row ran
       --    January to March, the 3B row runs from April. Ordering by "was it
       --    closed" puts the ENDED 3J row first, so the child who moved is reported
       --    as still being in the class they left.
       --
       --    A later start date is the correct tie-break in every case:
       --      * mid-year move  -> the new placement starts later, and wins;
       --      * planned year   -> the future placement starts later, and rule 1 has
       --                          already excluded it for dates outside its year.
       e.enrolled_at desc,
       -- 4. And `id` last, so the order is TOTAL. Two placements with identical
       --    dates can only be a data error, but a query without a deterministic
       --    ORDER BY is not guaranteed to be stable, and "the class shown changes
       --    between reloads" is a bug nobody can reproduce.
       e.id
     limit 1;
$$;

comment on function public.class_on(uuid, date) is
    'The class a student was in on a given date. The single authority for '
    '"current class" — resolves by enrollment interval and academic year rather '
    'than by "ended_at is null", which is ambiguous after a promotion (F24) and '
    'wrong for any date other than today (F23, F25).';

-- ---------------------------------------------------------------------------
-- 2. Enrollment takes an effective date, and closes only what it supersedes.
-- ---------------------------------------------------------------------------
create or replace function public.enroll_student(
    p_student_id uuid,
    p_class_id   uuid,
    p_reason     text default null,
    p_effective_from date default null
)
returns public.student_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_year_id  uuid;
    v_previous uuid;
    v_from     date;
    v_result   public.student_enrollments;
begin
    if not public.has_permission('students.update') then
        raise exception 'Not permitted to enrol students' using errcode = '42501';
    end if;

    -- The class determines the year; reading it from the class rather than from
    -- the caller means the two cannot disagree.
    -- The year's own start date comes with it. A class has no date of its own:
    -- it belongs to a year, and the year says when it begins.
    select c.academic_year_id, y.start_date
      into v_year_id, v_from
      from public.classes c
      join public.academic_years y on y.id = c.academic_year_id
     where c.id = p_class_id;

    if v_year_id is null then
        raise exception 'Class not found' using errcode = 'no_data_found';
    end if;

    -- WHERE THE PLACEMENT TAKES EFFECT.
    --
    -- For a class in the CURRENT year, that is today: the child is in it now.
    -- For a class in a FUTURE year, that is the first day of that year — NOT today.
    --
    -- This is the heart of F24. The old version let `enrolled_at` default to
    -- `now()`, so planning a 2027 placement in October 2026 placed the child in
    -- 2027's class immediately, and every reader asking "where is this child now"
    -- answered with next year's class for two months.
    if p_effective_from is not null then
        v_from := p_effective_from;
    elsif v_from is not null and v_from > current_date then
        -- A class in a year that has NOT STARTED takes effect when that year starts.
        --
        -- NOT `greatest(year_start, today)`, which is what the first version of this
        -- migration wrote and which returns TODAY for a future year — so planning
        -- 2027 in October 2026 still placed the child in 2027 immediately. That is
        -- the exact defect being fixed, dressed up in a date function, and the test
        -- caught it.
        v_from := v_from;
    else
        -- This year's class, or a year that has already started: the child is in it
        -- now, so the placement begins today.
        --
        -- Back-filling history is a deliberate act that supplies `p_effective_from`;
        -- guessing at a past date from the year would silently rewrite the past.
        v_from := current_date;
    end if;

    -- Close every open placement the new one actually supersedes.
    --
    -- TWO RULES, and both are needed.
    --
    -- (1) Same year. Moving a child from 3J to 3B in April must close their 3J row,
    --     or they are in both classes for the rest of the year and every reader
    --     that filters `ended_at is null` sees two rows — which for the student
    --     record means `maybeSingle()` ERRORS and the record will not open.
    --
    -- (2) An EARLIER year that is still open. In October 2026 the office plans the
    --     child's 2027 class. The 2026 row must be closed, because from 2027-01-01
    --     the child is no longer in it — but NOT before. `ended_at` is set to the
    --     day before the new placement begins, not to today, so the 2026 row stays
    --     true for every date in 2026 and the unique index is satisfied.
    --
    --     Without this second rule the child ends up with two open enrollments and
    --     the student record stops opening. The first version of this migration had
    --     only rule (1) and the test found it.
    --
    -- A LATER year's open row is left alone: a child cannot be placed in two future
    -- years, and if one exists it was created by a deliberate act this function was
    -- not asked about.
    update public.student_enrollments
       set ended_at = v_from - interval '1 day',
           status   = 'INACTIVE'
     where student_id = p_student_id
       and ended_at is null
       -- The new placement must actually begin after the old one did, or it is not
       -- superseding anything.
       and enrolled_at::date < v_from
       -- ...and the old row must not belong to a year that STARTS AFTER the new
       -- placement. A child cannot be moved backwards out of a future year by
       -- enrolling them in the current one, and closing it would destroy a planned
       -- placement the office deliberately made.
       and coalesce(
               (select y2.start_date
                  from public.academic_years y2
                 where y2.id = student_enrollments.academic_year_id),
               date '0001-01-01'
           ) <= v_from + interval '1 day'
    returning id into v_previous;

    insert into public.student_enrollments
        (student_id, class_id, academic_year_id, enrolled_at, status)
    values
        -- Midday, not midnight. A placement that begins at 00:00 of its first day
        -- is indistinguishable from the day before when timestamps are compared to
        -- dates, and every report in this system asks by date.
        (p_student_id, p_class_id, v_year_id, v_from + time '12:00', 'ACTIVE')
    returning * into v_result;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(), 'STUDENT_ENROLLED', p_student_id,
            jsonb_build_object(
                'class_id', p_class_id,
                'academic_year_id', v_year_id,
                'effective_from', v_from,
                'replaced_enrollment', v_previous,
                'reason', p_reason
            ));

    return v_result;
end;
$$;

comment on function public.enroll_student(uuid, uuid, text, date) is
    'Places a student in a class from an effective date. A class in a future year '
    'takes effect on that year''s first day, not today, so planning next year does '
    'not move the child out of this year''s class (F24).';

-- ---------------------------------------------------------------------------
-- 3. Planning next year's placement, without pretending it has happened.
-- ---------------------------------------------------------------------------
create or replace function public.plan_next_year_enrollment(
    p_student_id uuid,
    p_class_id   uuid,
    p_reason     text default null
)
returns public.student_enrollments
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Deliberately a thin wrapper. Promotion is the same act as enrollment with a
    -- future effective date, and giving it a separate name makes the intent legible
    -- at the call site — the office is PLANNING, not moving — while keeping one
    -- implementation, so the two cannot drift apart.
    return public.enroll_student(p_student_id, p_class_id, p_reason, null);
end;
$$;

comment on function public.plan_next_year_enrollment(uuid, uuid, text) is
    'Records a student''s placement in a class whose academic year has not started. '
    'The placement takes effect on that year''s first day (F24).';

-- ---------------------------------------------------------------------------
-- 3b. REMOVE THE SUPERSEDED OVERLOAD, and this is not tidiness.
--
-- Adding `p_effective_from` with a default creates a SECOND function rather than
-- replacing the first: `enroll_student(uuid, uuid, text)` and
-- `enroll_student(uuid, uuid, text, date)` now both exist. A three-argument call
-- then resolves to the OLD one, which still stamps placements with `now()` — so
-- every existing caller would keep the F24 bug while the new code looked correct
-- in review. This project has been bitten by exactly this before with
-- `can_read_document`.
--
-- The drop names the full signature because `drop function if exists` with the
-- wrong signature matches nothing and fails SILENTLY, leaving both in place.
-- ---------------------------------------------------------------------------
drop function if exists public.enroll_student(uuid, uuid, text);

-- ---------------------------------------------------------------------------
-- 4. Grants. AFTER the definitions, because `create or replace` resets them.
-- ---------------------------------------------------------------------------
revoke all on function public.class_on(uuid, date) from public, anon;
grant execute on function public.class_on(uuid, date) to authenticated;

revoke all on function public.enroll_student(uuid, uuid, text, date) from public, anon;
grant execute on function public.enroll_student(uuid, uuid, text, date) to authenticated;

revoke all on function public.plan_next_year_enrollment(uuid, uuid, text) from public, anon;
grant execute on function public.plan_next_year_enrollment(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Check the properties on the functions that were actually deployed.
-- ---------------------------------------------------------------------------
do $$
declare
    v_body text;
begin
    v_body := pg_get_functiondef((select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'class_on'
              and pg_get_function_identity_arguments(p.oid) = 'uuid, date'));

    -- The date interval must be part of the decision. A `class_on` that ignored
    -- its date argument would be `current_class()` wearing a misleading name, and
    -- every historical caller moved onto it would silently get today's answer.
    if v_body not like '%enrolled_at::date%' or v_body not like '%p_date%' then
        raise exception
            'F24 guard: class_on does not resolve by the enrollment interval, so it '
            'cannot answer for any date other than today'
            using errcode = 'raise_exception';
    end if;

    if v_body not like '%CURRENT%' then
        raise exception
            'F24 guard: class_on does not consider the current academic year'
            using errcode = 'raise_exception';
    end if;

    if position('order by' in lower(v_body)) = 0 then
        raise exception
            'F24 guard: class_on has no deterministic ordering, so which class it '
            'returns is up to the storage engine and may change between reloads'
            using errcode = 'raise_exception';
    end if;

    -- The enrollment function must not fall back to `now()` for a future year.
    v_body := pg_get_functiondef((select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = 'enroll_student'
              and pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, date'));
    if v_body like '%values%now()%' then
        raise exception
            'F24 guard: enroll_student still stamps the placement with now(), which '
            'is what placed children in next year''s class months early'
            using errcode = 'raise_exception';
    end if;

    if has_function_privilege('anon', 'public.class_on(uuid, date)', 'execute') then
        raise exception 'F24 guard: an anonymous caller can ask for a student''s class'
            using errcode = 'raise_exception';
    end if;
end;
$$;

commit;
