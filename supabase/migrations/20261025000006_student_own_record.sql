-- AUDIT F27 — a student could not read their OWN record, attendance or report card.
--
-- THE FINDING. Every read policy on these tables names the people who look AFTER the
-- child, and never the child. On `students`:
--
--     has_role(ADMIN) OR has_permission('students.view') OR is_guardian_of(id)
--
-- A teacher needs a permission; a parent is admitted by the family link; a student is
-- admitted by NOTHING. `student_attendance` is the same shape. The result is that a
-- student logging in — the person the entire system is about — saw an empty record,
-- an empty attendance calendar, and no report card. Verified on production: with a real
-- student login and their own row present, every read returned zero.
--
-- WHY NOBODY NOTICED. There are no student logins in use yet, so the failure was
-- invisible. It would have appeared the first time a child was given an account, and it
-- would have looked like the account was broken.
--
-- THE FIX. One additive policy per table, each admitting a row only when the record's
-- `user_id` is the signed-in user. That is a narrower rule than the guardian one, not a
-- wider one: a parent reaches their children through the family link, a child reaches
-- only themselves.

-- --- The child's own student record -----------------------------------------
create policy students_select_self on public.students
    for select
    to authenticated
    using (
        public.is_active_user()
        and user_id = (select auth.uid())
    );

comment on policy students_select_self on public.students is
    'A student may read their own record. Narrower than the guardian rule: a parent '
    'reaches their children through the family link, a child reaches only themselves.';

-- --- The child's own attendance ---------------------------------------------
create policy student_attendance_select_self on public.student_attendance
    for select
    to authenticated
    using (
        public.is_active_user()
        and exists (
            select 1 from public.students s
             where s.id = student_attendance.student_id
               and s.user_id = (select auth.uid())
        )
    );

comment on policy student_attendance_select_self on public.student_attendance is
    'A student may read their own attendance. Without this a student saw an empty '
    'calendar, which reads as "no record" rather than "not allowed".';

-- --- The child's own published report cards ---------------------------------
--
-- PUBLISHED only, for the same reason the guardian policy is: a draft is the office
-- still working and has been given to nobody.
create policy report_cards_select_self on public.report_cards
    for select
    to authenticated
    using (
        public.is_active_user()
        and status = 'PUBLISHED'
        and exists (
            select 1 from public.students s
             where s.id = report_cards.student_id
               and s.user_id = (select auth.uid())
        )
    );

comment on policy report_cards_select_self on public.report_cards is
    'A student may read their own PUBLISHED report cards. A draft stays the office''s.';

-- Guard: each policy must exist AND must key off the session, not off anything a
-- caller supplies. A policy that named a parameter would be the whole bug again.
do $guard$
declare
    v_qual text;
begin
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'students' and policyname = 'students_select_self';
    if v_qual is null then
        raise exception 'F27: students_select_self was not created';
    end if;
    if v_qual !~ 'auth\.uid\(\)' then
        raise exception 'F27: students_select_self does not read the session — a student could name another child';
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'student_attendance'
       and policyname = 'student_attendance_select_self';
    if v_qual is null then
        raise exception 'F27: student_attendance_select_self was not created';
    end if;
    if v_qual !~ 'auth\.uid\(\)' then
        raise exception 'F27: student_attendance_select_self does not read the session';
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'report_cards' and policyname = 'report_cards_select_self';
    if v_qual is null then
        raise exception 'F27: report_cards_select_self was not created';
    end if;
    if v_qual !~ 'auth\.uid\(\)' then
        raise exception 'F27: report_cards_select_self does not read the session';
    end if;
    if v_qual !~ 'PUBLISHED' then
        raise exception 'F27: report_cards_select_self would show a student a draft';
    end if;
end;
$guard$;
