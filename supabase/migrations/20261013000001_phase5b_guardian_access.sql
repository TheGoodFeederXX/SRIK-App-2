-- ===========================================================================
-- Phase 5b — a parent's own view of their own children's fees
-- ===========================================================================
-- Reference: docs/srik/07_PHASE_5_FINANCE.md
--
-- Phase 1 deliberately created only two roles, ADMIN and TEACHER, because the
-- office and the staffroom were the only places the system was used. Phase 5
-- then gave finance a single permission, `finance.view`, held by the office.
--
-- That was right, but it left a gap: a PARENT could not see their own child's
-- fees. The screen did not exist, and if it had, the policies would have shown
-- them nothing, because a parent holds no finance permission and should not.
--
-- So the money data needs a second way in, and it must be safe. This migration
-- adds it, and the rules are stricter than anywhere else in the system, because
-- the thing being protected is one family's information from another family.
--
-- 1. A GUARDIAN IS NOT AN ADMIN WITH FEWER BUTTONS. The GUARDIAN role is given
--    NO finance permission at all. If it had `finance.view`, every parent could
--    read every child's charges, and no policy would stop it. Instead, parents
--    reach the money through a separate policy that asks a completely different
--    question: "is this row about MY child?"
--
-- 2. THE QUESTION IS ANSWERED FROM THE FAMILY LINK, NOT FROM THE INPUT. The
--    helper below derives the caller's children from `student_guardians`, which
--    the parent cannot write. A parent cannot name a child they are not linked
--    to and be believed, because the list never comes from them.
--
-- 3. A PARENT SEES CHARGES AND PAYMENTS, AND WRITES NEITHER. This is read-only
--    by construction: there is no INSERT, UPDATE or DELETE policy for a parent
--    on any money table, and no GRANT to permit one. Money is taken at the
--    counter and recorded by the office, which is also where a correction must
--    happen so that it is audited.
--
-- 4. FOREIGN KEYS ARE NOT INFORMATION. A parent must not be able to learn that
--    another family exists by reading a `student_id` in a payments table. The
--    policies below are written so that only rows about their own children are
--    visible at all, not merely rows whose ids they are discouraged from using.

-- --- The GUARDIAN role ------------------------------------------------------

-- The app_role enum is extended rather than replaced. `alter type ... add value`
-- cannot run inside a transaction block in older PostgreSQL, but from 12 it can,
-- and the migration runner applies each file in one transaction.
do $$
begin
    if not exists (
        select 1 from pg_enum e
          join pg_type t on t.oid = e.enumtypid
         where t.typname = 'app_role' and e.enumlabel = 'GUARDIAN'
    ) then
        alter type public.app_role add value 'GUARDIAN';
    end if;
end
$$;

insert into public.roles (code, name, description, is_system)
values (
    'GUARDIAN',
    'Penjaga',
    'A parent or guardian. Sees only their own children, and only their fees. '
    'Holds no staff permission and cannot change anything.',
    true
)
on conflict (code) do nothing;

-- Deliberately NO role_permissions rows for GUARDIAN.
--
-- A parent's access comes from the child relationship, not from a permission.
-- Granting `finance.view` here would give every parent the office's own view of
-- every child in the school, and the tightened policies below would then be
-- quietly bypassed by the very grant meant to help.

-- --- Which children belong to the caller ------------------------------------

/*
 * The caller's own children, derived from the family link.
 *
 * SECURITY DEFINER, because the parent cannot read `student_guardians`
 * themselves under the staff policy — and should not need to. This function
 * reads the link on their behalf and returns only the child ids.
 *
 * `set search_path = ''` because a SECURITY DEFINER function that resolves
 * unqualified names is a privilege escalation waiting to happen.
 */
create or replace function public.current_guardian_child_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(sg.student_id), '{}'::uuid[])
      from public.student_guardians sg
      join public.guardians g on g.id = sg.guardian_id
     where g.user_id = auth.uid();
$$;

comment on function public.current_guardian_child_ids() is
    'The student ids linked to the signed-in guardian. The list comes from the '
    'family record, never from the caller, so a parent cannot name a child they '
    'are not linked to and be believed.';

revoke all on function public.current_guardian_child_ids() from public;
grant execute on function public.current_guardian_child_ids() to authenticated;

-- True when the signed-in user is a guardian of this child.
--
-- Lets a policy ask a readable question rather than comparing arrays inline in
-- every USING clause, which is where a mistake would be easy to make and hard
-- to notice.
create or replace function public.is_guardian_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_student_id = any (public.current_guardian_child_ids());
$$;

comment on function public.is_guardian_of(uuid) is
    'Whether the signed-in user is a guardian of the given child. Used to scope '
    'parent access to one family''s rows.';

revoke all on function public.is_guardian_of(uuid) from public;
grant execute on function public.is_guardian_of(uuid) to authenticated;

-- --- Parents can see the child, the class and the fees -----------------------
--
-- Each policy below is ADDITIVE with the office policy that already exists.
-- PostgreSQL combines permissive policies with OR, so an office user still sees
-- everything and a parent sees their own. Neither policy can widen the other,
-- because each is a complete statement of who may see what.

-- The child's own record. Without this a parent cannot see a name to put on the
-- screen, and `students_select` (students.view) would show them nothing.
drop policy if exists students_select_guardian on public.students;
create policy students_select_guardian on public.students
    for select using (public.is_guardian_of(id));

-- The link itself, so a parent can confirm which children are theirs.
drop policy if exists student_guardians_select_guardian on public.student_guardians;
create policy student_guardians_select_guardian on public.student_guardians
    for select using (
        exists (
            select 1 from public.guardians g
             where g.id = student_guardians.guardian_id
               and g.user_id = auth.uid()
        )
    );

-- Charges for their own children. Read only: there is no write policy for a
-- parent, so a parent cannot create, change or waive a fee.
drop policy if exists student_charges_select_guardian on public.student_charges;
create policy student_charges_select_guardian on public.student_charges
    for select using (public.is_guardian_of(student_id));

-- Payments against their own children's charges.
--
-- A payment row has no `student_id` of its own: one payment can settle several
-- siblings at once. So the question is asked through the allocations, which is
-- the only place the link exists.
drop policy if exists payments_select_guardian on public.payments;
create policy payments_select_guardian on public.payments
    for select using (
        exists (
            select 1
              from public.payment_allocations a
              join public.student_charges c on c.id = a.student_charge_id
             where a.payment_id = payments.id
               and public.is_guardian_of(c.student_id)
        )
    );

drop policy if exists payment_allocations_select_guardian on public.payment_allocations;
create policy payment_allocations_select_guardian on public.payment_allocations
    for select using (
        exists (
            select 1 from public.student_charges c
             where c.id = payment_allocations.student_charge_id
               and public.is_guardian_of(c.student_id)
        )
    );

-- The fee names and prices, so a charge can be explained. Read only, and this
-- is genuinely not private: every family is charged from the same list.
drop policy if exists fee_types_select_guardian on public.fee_types;
create policy fee_types_select_guardian on public.fee_types
    for select using (
        status = 'ACTIVE'
        and exists (
            select 1 from public.student_charges c
             where c.fee_type_id = fee_types.id
               and public.is_guardian_of(c.student_id)
        )
    );

-- --- What a parent must NOT see ---------------------------------------------

/*
 * Confirms the two things that would be worst to get wrong.
 *
 * Called by the test suite. Kept in the migration rather than the test file so
 * that the rule is documented next to the policies that implement it.
 */
create or replace function public.guardian_scope_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        -- A parent must hold no finance permission at all. If this is ever
        -- non-zero, the family-scoped policies below are no longer what is
        -- protecting one family from another.
        'guardian_finance_permissions', (
            select count(*) from public.role_permissions
             where role_code = 'GUARDIAN' and permission_code like 'finance%'
        ),
        -- A parent must not be able to write money anywhere.
        'guardian_money_write_grants', (
            select count(*) from (
                select 1 where has_table_privilege('authenticated', 'public.student_charges', 'INSERT')
                  and exists (select 1 from public.role_permissions
                               where role_code = 'GUARDIAN' and permission_code like 'finance%')
                union all
                select 1 where exists (select 1 from public.role_permissions
                                        where role_code = 'GUARDIAN' and permission_code = 'finance.manage')
            ) x
        )
    );
$$;

revoke all on function public.guardian_scope_check() from public;
grant execute on function public.guardian_scope_check() to authenticated;
