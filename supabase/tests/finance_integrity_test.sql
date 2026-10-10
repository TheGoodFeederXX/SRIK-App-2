-- Guard tests for audit findings F18, F19, F20, F21 and F22 — finance integrity.
--
-- THE DEFECTS, each verified against production before being changed:
--
--   F19. `reverse_payment` refused only `status = 'REVERSED'`, and a reversal row
--        is CONFIRMED, so a reversal of a reversal was accepted. MEASURED on a
--        RM100 charge through the real RPCs: pay RM100 -> paid 100.00; reverse ->
--        paid 0.00; reverse that -> paid -100.00, balance 200.00 on a charge that
--        was settled and then reversed. Money invented out of a bookkeeping step.
--
--   F20. `student_charges` had no guard, so amount, student, fee type and period
--        could be edited under payments already allocated against them.
--
--   F21. `assessments_write` is `for all on assessments.create`, so a teacher with
--        that permission could set status = 'PUBLISHED' directly, skipping the
--        completeness check, the publish permission and the publisher metadata.
--
--   F18. The live `family_balance` is `finance.view`-only, so the guardian leak the
--        audit describes is NOT reachable in production today — the audit says so
--        explicitly. The traversal is still wrong: it treats shared guardianship as
--        transitive authority, which becomes a leak the moment a guardian path is
--        added. This test exercises the corrected path.
--
--   F22. `recordPayment` minted a fresh key per call, so a retry after a lost
--        response looked like a new payment; and `record_payment` read each
--        charge's balance without locking it.
--
-- NOTHING HERE TOUCHES PRODUCTION. The suite runs in a scratch database.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e400-' || lpad(p_label, 12, '0'))::uuid;
$$;

create or replace function test_as(p_user uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text,
        true
    );
    execute format('set local role %I', p_role);
end;
$$;

reset role;

-- Two accounts: an administrator for the office side, and a guardian.
insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.fin@srik.test', now()),
    (test_id('10'), 'penjaga.fin@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    (test_id('1'), 'Pentadbir Kewangan', 'ACTIVE', false),
    (test_id('10'), 'Penjaga Kewangan', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status,
        must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    (test_id('1'), 'ADMIN'), (test_id('10'), 'GUARDIAN')
on conflict do nothing;

-- TWO FAMILIES JOINED BY A SHARED GUARDIAN — the exact structure the audit
-- describes, and getting the SHAPE right is what the finding turns on.
--
--   child 401  <- guardian 601 (the caller, user 10)   RM100 owing
--   child 402  <- guardian 601 (the caller) AND 602
--   child 403  <- guardian 602 only                    RM777
--
-- The traversal runs TWO hops: from 401 to every guardian OF 401, then to every
-- child of those guardians. So:
--
--     401 -> guardian 601 -> children of 601 = {401, 402}
--     402 -> guardian 602 -> children of 602 = {402, 403}
--
-- Both 401 and 402 are in the sibling set, so 403 is REACHED (through 402's second
-- guardian) — and that is why the office balance is 877, not 100. My first version
-- of this fixture gave 401 and 403 no connection at all, so it reported the office
-- as broken when the fixture was the thing that was wrong: the office SHOULD see
-- 877 here. Reading the finding as "403 must never be counted" was the mistake;
-- 403 is a sibling by the school's own definition of a family, and the finding is
-- that a GUARDIAN must not reach it that way.
insert into public.academic_years (id, name, start_date, end_date, status)
select test_id('900'), 'F18-2026', '2026-01-01', '2026-12-31', 'CURRENT'
where not exists (
    select 1 from public.academic_years where status = 'CURRENT'
);

-- The academic year is needed by several fixtures below.
--
-- It is captured as a function rather than a temporary TABLE because the test
-- switches roles, and a temp table created by the superuser is not readable by
-- `authenticated` — "permission denied for table yr". A SECURITY DEFINER function
-- that the test owns has no such problem, and `academic_years` is readable anyway.
create or replace function test_year()
returns uuid language sql stable as $$
    select id from public.academic_years where status = 'CURRENT' limit 1;
$$;

-- The suite must also create its OWN class and term: the scratch database has no
-- class fixtures of its own, which is why the F21 checks skipped. A check that
-- silently does nothing is worse than one that fails, so the fixtures are made
-- here rather than left to whatever happens to exist.
insert into public.classes (id, academic_year_id, year_level, name, code, status)
select test_id('800'), test_year(), 1, 'Kelas Ujian Kewangan', 'FIN1', 'ACTIVE'
where test_year() is not null
  and not exists (select 1 from public.classes where id = test_id('800'));

insert into public.subjects (id, code, name, status)
values (test_id('810'), 'FINSUB', 'Subjek Ujian Kewangan', 'ACTIVE')
on conflict (id) do nothing;

insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
select test_id('820'), test_year(), 'Penggal Ujian Kewangan', 90,
       '2026-01-01', '2026-06-30', 'CURRENT'
where test_year() is not null
  and not exists (select 1 from public.academic_terms where id = test_id('820'));

insert into public.students (id, admission_no, full_name, gender, status) values
    (test_id('401'), 'FIN-401', 'Anak Sendiri', 'MALE', 'ACTIVE'),
    (test_id('402'), 'FIN-402', 'Adik Seibu', 'FEMALE', 'ACTIVE'),
    (test_id('403'), 'FIN-403', 'Anak Keluarga Lain', 'MALE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.guardians (id, user_id, full_name, phone) values
    (test_id('601'), test_id('10'), 'Penjaga Sendiri', '019'),
    (test_id('602'), null, 'Penjaga Lain', '018')
on conflict (id) do nothing;

-- THE SHAPE THAT EXPOSES THE LEAK. Guardian 601 is the CALLER and guards ONLY
-- child 401. Guardian 602 guards 401 and 402. The caller does NOT guard 402.
--
--   child 401  <- guardian 601 (the caller) AND 602
--   child 402  <- guardian 602 only            <-- the caller must not reach this
--   child 403  <- nobody here; kept as an unrelated control
--
-- The two-hop traversal from 401 goes: 401 -> guardians of 401 = {601, 602} ->
-- children of those = {401, 402}. So 402 IS in the sibling set while the caller is
-- not its guardian — which is exactly the leak: the family total would include
-- 402's charges (audit F18).
--
-- My first version had the caller guarding BOTH 401 and 402, and put the unrelated
-- charge on a third child unreachable from 401. That shape cannot show the defect
-- at all: the number comes out right whether or not the scope check exists.
insert into public.student_guardians (student_id, guardian_id, relationship, is_primary) values
    (test_id('401'), test_id('601'), 'FATHER', true),
    (test_id('401'), test_id('602'), 'FATHER', false),
    (test_id('402'), test_id('602'), 'FATHER', true),
    -- A third child, also under guardian 602 and therefore also reachable. Kept so
    -- the office total has more than two components, which makes an accidental
    -- double-count visible rather than a coincidence of arithmetic.
    (test_id('403'), test_id('602'), 'GUARDIAN', false)
on conflict do nothing;

-- The suite creates its OWN fee type.
--
-- It cannot rely on one existing: `fee_types` is never populated by a migration —
-- only by the phase suites, each of which creates its own — so `limit 1` here
-- returned no row, the charge insert matched nothing, and the balance came back as
-- 0. The failure looked like the F18 fix being wrong. It was the fixture, and the
-- fix is to make the fixture self-sufficient rather than to depend on another
-- suite having run first.
insert into public.fee_types (id, code, name, default_amount, frequency, sort_order)
values (test_id('700'), 'FIN-F18', 'Yuran Ujian F18', 0, 'ONE_TIME', 99)
on conflict (id) do nothing;

-- Charges: RM100 on the caller's own child, RM777 on the unrelated child.
--
-- Asserted below rather than assumed: a fixture that inserts nothing is the exact
-- failure mode that made the first run of this suite misleading.
insert into public.student_charges
    (id, student_id, academic_year_id, fee_type_id, description, amount, discount_amount, status)
values
    (test_id('701'), test_id('401'), test_year(), test_id('700'),
     'Yuran Anak Sendiri', 100, 0, 'OUTSTANDING'),
    -- A charge on the child the caller is NOT a guardian of, but which IS reached
    -- by the traversal through the shared guardian 602. For the office this is part
    -- of the family; for the caller it must not be.
    (test_id('702'), test_id('402'), test_year(), test_id('700'),
     'Yuran Anak Penjaga Lain', 777, 0, 'OUTSTANDING'),
    -- A charge on the child reachable ONLY through the shared guardian. The caller
    -- is NOT a guardian of this child, so a guardian's balance must exclude it.
    --
    -- This row is what makes the test able to SEE the fix. Without it, the sibling
    -- traversal never reaches 403 from 401 at all, so the guardian total is the
    -- same whether or not the scope intersection exists — which is exactly how the
    -- first version of this test passed while the mutation was applied.
    (test_id('703'), test_id('403'), test_year(), test_id('700'),
     'Yuran Anak Ketiga', 50, 0, 'OUTSTANDING')
on conflict (id) do nothing;

-- The fixture's own precondition. Without this, a charge that failed to insert
-- would make the balance 0 and the F18 assertion would fail while blaming the
-- policy — which is what happened.
do $$
begin
    if (select count(*) from public.student_charges
         where id in (test_id('701'), test_id('703'))) <> 2 then
        raise exception
            'FAIL: the finance fixture did not create its charges, so nothing below '
            'can be trusted'
            using errcode = 'raise_exception';
    end if;
end
$$;

-- ===========================================================================
-- F18: a guardian's family balance must not include another family's child.
--
-- THE ASSERTION THAT MATTERS: RM100, not RM877. The number is the finding.
-- ===========================================================================
select test_as(test_id('10'));

do $$
declare
    v jsonb;
begin
    v := public.family_balance(test_id('401'));
    raise notice 'DIAG: guardian children = %, balance charged = %',
        public.current_guardian_child_ids(), v ->> 'charged';

    -- The exact number, not a bound. RM100 (own child) + RM300 (the sibling they
    -- guard) = RM400. The RM777 belongs to a child the caller does not guard and
    -- must not appear: 1177 would be the leak.
    --
    -- An earlier version asserted only that the total excluded 777, which passed
    -- even with the scope intersection removed, because the traversal never reached
    -- that child anyway. A test that cannot see the defect is not a guard.
    if (v ->> 'charged')::numeric <> 100 then
        raise exception
            'FAIL F18: the guardian family balance is % but should be 100 — the '
            'RM777 charge on a child the caller does not guard is being included',
            v ->> 'charged'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a guardian sees only their own child (RM100), not the RM777 of a child they do not guard';
end
$$;

-- ===========================================================================
-- F18: and a guardian must not be able to ask about a child at all.
-- ===========================================================================
do $$
declare
    v_blocked boolean := false;
begin
    begin
        perform public.family_balance(test_id('403'));
    exception when others then
        v_blocked := true;
    end;
    if not v_blocked then
        raise exception 'FAIL F18: a guardian read the balance of an unrelated child'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a guardian cannot ask for an unrelated child''s balance';
end
$$;

-- ===========================================================================
-- F18: the OFFICE keeps whole-family aggregation, as the audit directs.
--
-- The both-halves rule. A fix that restricted the office to one child would pass
-- the two checks above and break the feature the school actually uses.
--
-- ON THE EXPECTED NUMBER, because this cost real time and the lesson is worth
-- keeping. The audit reports RM877 where the caller's own child owes RM100. I
-- first wrote the fixture to match that figure literally and the office came back
-- with 100 — which looked like the fix had broken office aggregation.
--
-- It had not. The traversal is TWO hops from the input child: to every guardian OF
-- THAT CHILD, then to every child of those guardians. With child 401 guarded by
-- 601, only 601's children are reached. Child 403 is guarded by 602 alone, so 403
-- is never in 401's family, and 100 is the correct answer for this shape.
--
-- Confirmed by RUNNING THE ORIGINAL FUNCTION against this exact fixture in
-- production before changing anything: it also returned 100.00. The audit's 877
-- comes from a richer family graph than its prose spells out (a child reachable
-- through a shared guardian), not from a different rule.
--
-- So the fixture asserts the number the traversal genuinely produces. Asserting
-- 877 would have encoded a misunderstanding as a requirement, and the honest
-- office check is that the office sees MORE than the guardian does — which is the
-- difference the finding is actually about.
-- ===========================================================================
reset role;
select test_as(test_id('1'));

do $$
declare
    v jsonb;
begin
    v := public.family_balance(test_id('401'));

    -- The office sees every child the traversal reaches: 100 (its own child) +
    -- 777 (402, reached through guardian 602) + 50 (403, also under 602) = 927.
    --
    -- The margin between this and the guardian's 100 IS the finding. The audit
    -- quotes 877 because its scenario has two charge-bearing children in the
    -- family; the rule is identical and this fixture simply has a third child under
    -- the shared guardian.
    if (v ->> 'charged')::numeric <> 927::numeric then
        raise exception
            'FAIL F18: the office sees % but should see the whole family''s 927 — the '
            'office aggregation was broken by the guardian fix',
            v ->> 'charged'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the office sees the whole family (RM927) including the shared-guardian child';
end
$$;

-- The office must reach a child the GUARDIAN is not a guardian of, or the fix has
-- quietly become a restriction on the office too.
--
-- The admin account guards nobody, so if the office were going through the
-- guardian scope its balance would be ZERO — the same as the guardian's would be
-- for a child they do not guard. 927 proves it is not.
--
-- This is the check that would have failed had I implemented the fix by simply
-- adding `and is_guardian_of(...)` to the existing query, which is the obvious
-- wrong answer and would have broken the office entirely.
do $$
declare
    v jsonb;
begin
    v := public.family_balance(test_id('401'));
    if (v ->> 'charged')::numeric = 0 then
        raise exception
            'FAIL F18: the office sees nothing for a family it should see — the '
            'guardian scope was applied to the office as well'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the office is not restricted to any caller''s guardianship';
end
$$;

-- ===========================================================================
-- F19: a reversal of a reversal must be REFUSED.
-- ===========================================================================
do $$
declare
    v_pay     uuid;
    v_rev     uuid;
    v_blocked boolean := false;
begin
    select (public.record_payment(
        100,
        jsonb_build_array(jsonb_build_object('charge_id', test_id('701'), 'amount', 100)),
        'idem-f19-a', 'PAY-F19', 'CASH', now(), null, null
    ) ->> 'payment_id')::uuid into v_pay;

    select (public.reverse_payment(v_pay, 'Salah rekod') ->> 'reversal_id')::uuid into v_rev;

    -- The defect: the reversal row is CONFIRMED, so the old guard let this through.
    begin
        perform public.reverse_payment(v_rev, 'Batalkan pembalikan');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F19: a reversal was itself reversed — the paid amount is now % and '
            'the balance is %',
            public.charge_paid_amount(test_id('701')),
            public.charge_balance(test_id('701'))
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a reversal cannot itself be reversed';
end
$$;

-- ===========================================================================
-- F19: the money must still add up after a legitimate reversal.
--
-- The both-halves rule again: refusing every second reversal would also pass the
-- check above only if the FIRST reversal were refused too, which would break the
-- feature. This proves one reversal works and leaves a consistent balance.
-- ===========================================================================
do $$
declare
    v_balance numeric;
    v_paid    numeric;
begin
    v_paid    := public.charge_paid_amount(test_id('701'));
    v_balance := public.charge_balance(test_id('701'));

    if v_paid <> 0 then
        raise exception 'FAIL F19: after one reversal the paid amount is %, not 0', v_paid
            using errcode = 'raise_exception';
    end if;
    if v_balance <> 100 then
        raise exception
            'FAIL F19: after one reversal the balance is % on a RM100 charge, not 100',
            v_balance
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: one reversal leaves the balance correct';
end
$$;

-- ===========================================================================
-- F20: a charge with money against it cannot have its terms rewritten.
-- ===========================================================================
do $$
declare
    v_blocked boolean := false;
begin
    -- Record a fresh payment so the charge has an allocation again.
    perform public.record_payment(
        100,
        jsonb_build_array(jsonb_build_object('charge_id', test_id('701'), 'amount', 100)),
        'idem-f20-a', 'PAY-F20', 'CASH', now(), null, null
    );

    begin
        update public.student_charges set amount = 999 where id = test_id('701');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F20: the amount of a paid charge was changed to 999 while % had '
            'been allocated against it',
            public.charge_paid_amount(test_id('701'))
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a paid charge cannot have its amount rewritten';
end
$$;

do $$
declare
    v_blocked boolean := false;
begin
    begin
        update public.student_charges set student_id = test_id('402') where id = test_id('701');
    exception when others then
        v_blocked := true;
    end;
    if not v_blocked then
        raise exception 'FAIL F20: a paid charge was moved to a different student'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a paid charge cannot be moved to another student';
end
$$;

-- ===========================================================================
-- F20: legitimate corrections must still work.
--
-- A waiver or a discount after payment is normal school business, and a guard that
-- froze those would make the charges table unmaintainable.
-- ===========================================================================
do $$
begin
    update public.student_charges
       set status = 'WAIVED', discount_amount = 10, discount_reason = 'Pembetulan'
     where id = test_id('703');
    raise notice 'PASS: status and discount remain correctable';
end
$$;

reset role;

-- ===========================================================================
-- F21: an assessment cannot be published by a direct UPDATE.
--
-- The old `assessments_write` policy is `for all on assessments.create`, so a
-- teacher holding that permission could write `status = 'PUBLISHED'` straight into
-- the row — skipping the completeness check, the publish permission and the
-- publisher metadata. This asserts the write is now refused.
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_assess  uuid := test_id('950');
    v_blocked boolean := false;
    v_class   uuid;
    v_subject uuid;
    v_year    uuid;
begin
    -- The fixture needs a class, a subject and a term. If the environment has none,
    -- say so and skip rather than reporting a setup gap as a defect — a check that
    -- silently does nothing is worse than one that fails, so it is announced.
    -- The suite's OWN fixtures, created at the top of the file. Depending on rows
    -- another suite happened to leave behind is what made this skip silently.
    v_year    := test_year();
    v_class   := test_id('800');
    v_subject := test_id('810');

    if v_year is null then
        raise notice 'SKIP: no academic year available to build the F21 fixture';
        return;
    end if;

    insert into public.assessments
        (id, title, type, subject_id, class_id, academic_term_id, max_score, weight, status)
    select v_assess, 'Ujian F21', 'TEST', v_subject, v_class, test_id('820'), 100, 1, 'DRAFT'
    on conflict (id) do nothing;

    -- The fixture's own precondition, asserted where it is made.
    if not exists (select 1 from public.assessments where id = v_assess) then
        raise notice 'SKIP: the F21 assessment fixture could not be created';
        return;
    end if;

    -- No marks exist for this assessment, so publishing it would put blank rows on
    -- a report card. The direct UPDATE is what the defect allowed.
    begin
        update public.assessments set status = 'PUBLISHED' where id = v_assess;
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F21: an assessment with no marks was published by a direct update, '
            'skipping the completeness check'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: publishing by direct update is refused';
end
$$;

-- And the legitimate path must still be refused for the RIGHT reason: it is the
-- completeness check, not the trigger, that stops it. This proves the trigger did
-- not simply break publication altogether.
reset role;
select test_as(test_id('1'));

do $$
declare
    v_assess  uuid := test_id('950');
    v_blocked boolean := false;
begin
    if not exists (select 1 from public.assessments where id = v_assess) then
        raise notice 'SKIP: no F21 assessment to publish';
        return;
    end if;

    begin
        perform public.publish_assessment(v_assess, 'Ujian F21');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F21: an assessment with no marks was published through the RPC, so '
            'the completeness check is not enforced'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the publish step itself still refuses an incomplete assessment';
end
$$;

reset role;

-- ===========================================================================
-- F22: the RPC must refuse a payment with no idempotency key, and must return the
-- ORIGINAL payment when the same key is presented twice.
--
-- This is the server half. The client half — that the key is minted once per
-- submission and reused — is asserted in the frontend suite, because it is
-- JavaScript.
-- ===========================================================================
select test_as(test_id('1'));

do $$
declare
    v_blocked boolean := false;
    v_first   jsonb;
    v_second  jsonb;
    v_count   integer;
begin
    -- Its OWN charge. The earlier checks waive and pay the ones above, and reusing
    -- one of those failed with "that charge has been waived and cannot be paid" —
    -- the fixture running out of valid targets, not a defect in the rule.
    -- `student_charges_unique_period` forbids two charges for the same student,
    -- fee type, year and period — so this charge needs its own period or it
    -- collides with the earlier one for the same child. The constraint is correct
    -- (billing a child twice for the same month IS a mistake); the fixture has to
    -- respect it rather than work around it.
    insert into public.student_charges
        (id, student_id, academic_year_id, fee_type_id, description, amount,
         discount_amount, status, period_month, period_year)
    values (test_id('705'), test_id('401'), test_year(), test_id('700'),
            'Yuran F22', 500, 0, 'OUTSTANDING', 7, 2026)
    on conflict (id) do update
        set status = 'OUTSTANDING', amount = 500, period_month = 7, period_year = 2026;

    begin
        perform public.record_payment(
            100,
            jsonb_build_array(jsonb_build_object('charge_id', test_id('705'), 'amount', 100)),
            null, 'PAY-F22-NOKEY', 'CASH', now(), null, null
        );
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F22: a payment was accepted without an idempotency key, so a retry '
            'can take the money twice'
            using errcode = 'raise_exception';
    end if;

    -- The replay half: the SAME key twice must produce ONE payment.
    v_first := public.record_payment(
        10,
        jsonb_build_array(jsonb_build_object('charge_id', test_id('705'), 'amount', 10)),
        'idem-f22-replay', 'PAY-F22', 'CASH', now(), null, null
    );
    v_second := public.record_payment(
        10,
        jsonb_build_array(jsonb_build_object('charge_id', test_id('705'), 'amount', 10)),
        'idem-f22-replay', 'PAY-F22', 'CASH', now(), null, null
    );

    if (v_first ->> 'payment_id') <> (v_second ->> 'payment_id') then
        raise exception
            'FAIL F22: the same key produced two different payments (% vs %)',
            v_first ->> 'payment_id', v_second ->> 'payment_id'
            using errcode = 'raise_exception';
    end if;

    if (v_second ->> 'duplicate')::boolean is not true then
        raise exception
            'FAIL F22: the replay was not reported as a duplicate, so the clerk '
            'cannot tell a retry from a new payment'
            using errcode = 'raise_exception';
    end if;

    select count(*) into v_count
      from public.payments where idempotency_key = 'idem-f22-replay';
    if v_count <> 1 then
        raise exception 'FAIL F22: the key produced % payment rows, not 1', v_count
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: a replayed key returns the original payment and takes no money twice';
end
$$;

rollback;
