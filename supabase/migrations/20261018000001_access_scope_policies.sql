-- ===========================================================================--
-- Access scope: policies that gate on the ACCOUNT but never on the RECORD.
--
-- Findings F05, F06 and F07 of the 2026-10-10 audit.
--
-- Each of the three policies below asked "does this person have the right kind of
-- account?" and never asked "is this their record?". A permission answers what
-- someone may DO; it says nothing about WHICH rows. Authorisation needs both
-- answers, and these policies only produced the first.
--
-- Verified against the production database before being changed, not taken from
-- the report:
--
--   F05  `students_select_guardian` and `student_guardians_select_guardian` were
--        granted to `public` with no `is_active_user()` test. A guardian account
--        that has been DISABLED therefore still read their child's record — the
--        account was switched off and kept working.
--   F06  `students_select` was `is_active_user() AND has_permission
--        ('students.view')`, and `students.view` is held by BOTH ADMIN and
--        TEACHER. All 18 production teachers could therefore read every one of
--        the school's children: name, identity number, address, birth details.
--   F07  `student_attendance_select` was `is_active_user()` ALONE — no scope
--        clause of any kind. Any signed-in account read the whole school's
--        attendance.
--
-- WHAT THE FIX IS, AND WHAT IT IS NOT. It is not a tightening of the permission
-- model; it adds the missing half. Each policy keeps its permission test and gains
-- a record-scope test beside it. Three shapes are needed, because "which records"
-- has three different answers:
--
--   the office        -> everything (this is a single school; the office must be
--                        able to look up any child, and a fix that broke that
--                        would be rejected by the school)
--   a guardian        -> only their own children, and only while active
--   a teacher         -> only students in the classes they actually teach
--
-- Nothing here is granted to `anon`. These are changes to `authenticated` and
-- `public` policies that already existed; `anon` reaches none of these tables.
--
-- THE CLASS-SCOPE TEST. `students` carries no `class_id` — a child's class comes
-- from `student_enrollments`, which is the relational answer the project requires
-- (class is derived from enrollment, never a name string). The scope test
-- therefore goes through that table, and through `teaching_assignments` to find
-- which classes the caller teaches. `current_teacher_id()` already resolves the
-- caller's teacher row, and is used rather than a new lookup so there is one
-- definition of "which teacher is this".
--
-- A teacher with no active assignment sees no students. That is deliberate and it
-- is the correct reading of deny-by-default: they teach nobody, so they have no
-- legitimate reason to open a child's file.
-- ===========================================================================--

-- ---------------------------------------------------------------------------
-- A reusable scope helper.
--
-- Written once rather than inlined into each policy, for a reason that matters
-- more than brevity: a policy's USING clause is the only place some of these
-- rules exist, so a rule copied into four policies is a rule that will drift in
-- three of them. One function means one place to read and one place to be right.
--
-- `security definer` with an empty search_path, matching every other helper in
-- this schema: the caller must not be able to influence what the function reads
-- by manipulating the search path.
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
          from public.student_enrollments se
          join public.teaching_assignments ta
            on ta.class_id = se.class_id
         where se.student_id = p_student_id
           and se.status = 'ACTIVE'
           and ta.teacher_id = public.current_teacher_id()
           and ta.status = 'ACTIVE'
    );
$$;

comment on function public.is_teacher_of_student(uuid) is
    'True when the caller teaches a class the student is actively enrolled in. '
    'Class comes from student_enrollments (relational), not a column on students. '
    'Used by the students and attendance SELECT policies (audit F06, F07).';

-- `anon` must not be able to call it, and this is not belt-and-braces.
--
-- A new `security definer` function is granted EXECUTE to PUBLIC automatically by
-- Postgres, so this helper arrived anonymous-callable the moment it was created —
-- reintroducing exactly the condition F01/F02/F03 removed, on a function written
-- to fix an access-scope problem. It is a harmless leak in itself (it returns one
-- boolean about one student, and `is_active_user()` inside `has_role` is false
-- without a JWT, so the policies stay closed), which is precisely why it would
-- have gone unnoticed: the hole is real even when the consequence is small, and
-- the NEXT definer function copied from this one inherits it.
--
-- Found by re-running the "no definer function is callable without a JWT" check
-- from the security hardening migration after this one was applied. That check
-- exists to catch this class of drift, and it did.
revoke execute on function public.is_teacher_of_student(uuid) from public, anon;
grant execute on function public.is_teacher_of_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- F05 — a DISABLED guardian must not read their child.
--
-- Both guardian policies were `roles=public` with no account-state test. The fix
-- adds `is_active_user()` — the same test every other authenticated policy already
-- uses — while keeping the `public` role, because the role is not the problem
-- here: these policies exist so a guardian's own row is visible without them
-- holding a staff permission. Dropping the role would silently forbid the very
-- access the policy was written to allow.
-- ---------------------------------------------------------------------------
drop policy if exists students_select_guardian on public.students;
create policy students_select_guardian on public.students
    for select
    to public
    using (public.is_active_user() and public.is_guardian_of(id));

comment on policy students_select_guardian on public.students is
    'A guardian reads their own child. Requires an ACTIVE account: the previous '
    'version omitted is_active_user(), so a disabled guardian kept reading (F05).';

drop policy if exists student_guardians_select_guardian on public.student_guardians;
create policy student_guardians_select_guardian on public.student_guardians
    for select
    to public
    using (
        public.is_active_user()
        and exists (
            select 1
              from public.guardians g
             where g.id = student_guardians.guardian_id
               and g.user_id = auth.uid()
        )
    );

comment on policy student_guardians_select_guardian on public.student_guardians is
    'A guardian reads their own family link. Requires an ACTIVE account (F05).';

-- ---------------------------------------------------------------------------
-- F06 — a teacher must not read a student outside their classes.
--
-- The old policy was the permission alone. The replacement keeps the permission
-- and adds the scope, with the office exempt so the school can still look up any
-- child.
--
-- THE EXEMPTION USES `has_role(array['ADMIN'])`, AND THAT IS NOT A SHORTCUT.
-- The first attempt used a permission called `admin.access`, which turned out not
-- to exist — ADMIN holds 39 permissions and that is not one of them, so the
-- exemption could never fire and the office would have lost sight of every child.
-- A test caught it. The lesson is worth keeping: a permission name invented at the
-- keyboard is a policy that silently denies.
--
-- `has_role` is the project's own helper and is already used to define "an
-- administrator" for the last-admin protection. Reusing it means there is one
-- definition of the office rather than two that can disagree. It also checks
-- `is_active_user()` internally, so a disabled administrator is not an exemption.
--
-- Why a role here and a permission elsewhere: TEACHER and ADMIN differ by ROLE,
-- and the question is "is this the school's office?", which is a fact about who
-- the person is, not about one capability. The teacher half of the policy stays
-- permission-based, because there "may this person see student records at all?"
-- is the right question.
-- ---------------------------------------------------------------------------
drop policy if exists students_select on public.students;
create policy students_select on public.students
    for select
    to authenticated
    using (
        public.is_active_user()
        and (
            public.has_role(array['ADMIN']::public.app_role[])
            or (
                public.has_permission('students.view')
                and public.is_teacher_of_student(id)
            )
        )
    );

comment on policy students_select on public.students is
    'The office reads any student; a teacher reads only students in classes they '
    'teach. The previous version stopped at the permission, so every teacher read '
    'every child''s record (F06).';

-- ---------------------------------------------------------------------------
-- F07 — attendance must be scoped, not merely gated on being signed in.
--
-- The old policy was `is_active_user()` with no scope clause at all, so it was
-- satisfied by ANY signed-in account and the whole school's attendance was
-- readable. The three legitimate readers are separated explicitly.
-- ---------------------------------------------------------------------------
drop policy if exists student_attendance_select on public.student_attendance;
create policy student_attendance_select on public.student_attendance
    for select
    to authenticated
    using (
        public.is_active_user()
        and (
            -- The office: sees everything.
            public.has_role(array['ADMIN']::public.app_role[])
            -- Staff who record attendance: their own classes.
            or (
                public.has_permission('attendance.record')
                and public.is_teacher_of_student(student_id)
            )
            -- A parent: their own children, and only while active.
            or public.is_guardian_of(student_id)
        )
    );

comment on policy student_attendance_select on public.student_attendance is
    'Scoped to the office, the student''s own teachers, or the student''s own '
    'guardian. The previous version was is_active_user() alone, so any signed-in '
    'account read the entire school''s attendance (F07).';

-- ---------------------------------------------------------------------------
-- WHY THE HELPER MUST BE `security definer` — the opposite of the instinct.
--
-- `is_teacher_of_student` reads `student_enrollments` and `teaching_assignments`.
-- If it ran with the caller's privileges, RLS on THOSE tables would apply first,
-- and a teacher's ability to prove "I teach this class" would depend on a policy
-- that asks the very question being answered — a circle. In practice the helper
-- would find nothing, the scope test would be false, and a teacher would be locked
-- out of their own class's students.
--
-- A definer function reads as the owner, so the scope test can see the rows it
-- needs. That is safe HERE because the function returns only a boolean about one
-- student; it discloses nothing. The lesson is specific rather than general: a
-- policy helper often has to be definer precisely to avoid depending on the
-- policy it implements.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verify the property, not the statements.
--
-- These assertions fail the migration rather than leaving a quiet hole. Each
-- restates one of the three rules in a form that can be checked mechanically, and
-- they re-check on every environment — including one where an earlier migration
-- has just re-created a permissive policy.
-- ---------------------------------------------------------------------------
do $$
declare
    v_qual text;
begin
    -- F05: neither guardian policy may be reachable without an active account.
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'students'
       and policyname = 'students_select_guardian';
    if v_qual is null or v_qual not like '%is_active_user%' then
        raise exception 'F05 guard: students_select_guardian has no is_active_user(): %',
            coalesce(v_qual, '(policy missing)')
            using errcode = 'insufficient_privilege';
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'student_guardians'
       and policyname = 'student_guardians_select_guardian';
    if v_qual is null or v_qual not like '%is_active_user%' then
        raise exception 'F05 guard: student_guardians_select_guardian has no is_active_user(): %',
            coalesce(v_qual, '(policy missing)')
            using errcode = 'insufficient_privilege';
    end if;

    -- F06: the student policy must carry a class-scope test, not the permission
    -- alone. `is_teacher_of_student` is the marker that the scope half is present.
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'students'
       and policyname = 'students_select';
    if v_qual is null or v_qual not like '%is_teacher_of_student%' then
        raise exception 'F06 guard: students_select has no class scope: %',
            coalesce(v_qual, '(policy missing)')
            using errcode = 'insufficient_privilege';
    end if;

    -- F06/F07 helper: not callable without a login. A definer function created
    -- here must not reopen what the security hardening closed.
    if has_function_privilege('anon', 'public.is_teacher_of_student(uuid)', 'EXECUTE') then
        raise exception 'is_teacher_of_student is callable without a login'
            using errcode = 'insufficient_privilege';
    end if;

    -- F07: attendance must name its scope. `is_active_user` alone was the defect,
    -- so its presence is NOT sufficient — the policy must also mention a scope
    -- predicate. The check is for the absence of BOTH possible readers, which is
    -- the state that means "signed in is enough".
    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'student_attendance'
       and policyname = 'student_attendance_select';
    if v_qual is null
       or (v_qual not like '%is_teacher_of_student%'
           and v_qual not like '%is_guardian_of%') then
        raise exception 'F07 guard: student_attendance_select is not scoped: %',
            coalesce(v_qual, '(policy missing)')
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;
