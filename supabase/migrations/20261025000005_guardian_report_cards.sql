-- AUDIT F27 — a parent could not read their OWN child's report card.
--
-- THE FINDING. `report_cards_select` is the only policy on the table, and it reads:
--
--     has_permission('reports.view') OR has_permission('assessments.create')
--
-- Both are STAFF permissions. GUARDIAN holds neither — it holds no permission at all —
-- so a parent opening the report card screen got nothing, for any child, ever. Report
-- cards are the single document a family most wants from a school, and the parent portal
-- could not show one.
--
-- WHY IT WAS NOT NOTICED. The screen has an empty state that reads "no published reports
-- yet", which is indistinguishable from the truth from the outside. There were also no
-- parents with logins during development, so nobody hit it.
--
-- THE FIX is a SECOND policy, ADDITIVE. Postgres combines permissive policies with OR, so
-- the staff rule is untouched and a guardian gains exactly one thing: rows belonging to
-- their own children. Nothing is widened for anyone else.
--
-- THE RULE IS NOT "ANY PUBLISHED CARD". It is: this child is mine AND the card has been
-- published. A DRAFT is the office still working, and a SUPERSEDED version was replaced —
-- showing either would tell a parent something the school has not yet said.

create policy report_cards_select_guardian on public.report_cards
    for select
    to authenticated
    using (
        public.is_active_user()
        and public.is_guardian_of(student_id)
        and status = 'PUBLISHED'
    );

comment on policy report_cards_select_guardian on public.report_cards is
    'A guardian may read their own child''s PUBLISHED report cards. Additive with the '
    'staff policy; a draft or a superseded version is not included, because the school '
    'has not given those to anyone.';

-- Guard: the policy must exist, must name the guardian check, and must not hand out
-- drafts. Losing the second half would expose the office's working copy to families,
-- which is a quiet failure — the card looks complete.
do $guard$
declare
    v_qual text;
    v_count int;
begin
    select count(*) into v_count from pg_policies
     where schemaname = 'public' and tablename = 'report_cards' and cmd = 'SELECT';
    if v_count < 2 then
        raise exception 'F27: report_cards still has only % select policy — a guardian cannot read their own child''s card', v_count;
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = 'report_cards'
       and policyname = 'report_cards_select_guardian';
    if v_qual is null then
        raise exception 'F27: the guardian policy on report_cards was not created';
    end if;
    if v_qual !~ 'is_guardian_of' then
        raise exception 'F27: the guardian policy does not check the family link';
    end if;
    if v_qual !~ 'PUBLISHED' then
        raise exception 'F27: the guardian policy would show a parent a draft report card';
    end if;
end;
$guard$;
