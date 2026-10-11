-- AUDIT F27 — a parent could not read their own child's report card.
--
-- THE FINDING. `report_cards_select` was the only policy, and it required a STAFF
-- permission (`reports.view` or `assessments.create`). GUARDIAN holds neither — it holds
-- NO permission at all — so a parent opening the report card screen got nothing, for any
-- child, ever. The screen said "no published reports yet", which is indistinguishable
-- from the truth from the outside, and there were no parents with logins to notice.

\set ON_ERROR_STOP on

begin;

-- Fixtures this suite owns. The test database is seeded differently from production,
-- and a suite that borrows another suite's rows breaks the moment they change — which
-- is exactly what happened here, with a null academic_term_id.
create temp table fixtures as
select
    (select p.id from public.profiles p join public.user_roles ur on ur.user_id = p.id
      where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1) as admin_id,
    -- Reuse the CURRENT year if the test database already has one. Only one year may be
    -- CURRENT (there is a unique index enforcing it), so creating a second is refused.
    coalesce(
        (select ay.id from public.academic_years ay where ay.status = 'CURRENT' limit 1),
        gen_random_uuid()
    ) as year_id,
    gen_random_uuid() as term_a,
    gen_random_uuid() as term_b;

insert into public.academic_years (id, name, start_date, end_date, status)
select year_id, 'Tahun Ujian RC', '2026-01-01', '2026-12-31', 'CURRENT' from fixtures
where not exists (select 1 from public.academic_years ay where ay.status = 'CURRENT');

insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
select term_a, year_id, 'Penggal RC A', 91, '2026-01-01', '2026-06-30', 'CURRENT' from fixtures
on conflict (id) do nothing;
insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
select term_b, year_id, 'Penggal RC B', 92, '2026-07-01', '2026-12-31', 'PLANNED' from fixtures
on conflict (id) do nothing;

-- Two families, one child each. The guardian is linked to the FIRST only.
do $setup$
declare
    v_admin uuid; v_year uuid; v_class uuid; v_guardian uuid;
    v_mine uuid; v_theirs uuid; v_user uuid := gen_random_uuid();
begin
    select admin_id, year_id into v_admin, v_year from fixtures;

    -- The minimal form the other suites use: the test database's auth.users has fewer
    -- columns than production's, and this suite has to run in both places.
    insert into auth.users (id, email, email_confirmed_at)
    values (v_user, 'penjaga.rc@srialkhairiah.my', now());

    -- NO profile insert: a trigger on auth.users creates it. Inserting one here
    -- collides with the trigger's row, which is how this suite first failed.
    update public.profiles set full_name = 'Penjaga RC', status = 'ACTIVE' where id = v_user;
    insert into public.user_roles (user_id, role_code) values (v_user, 'GUARDIAN');

    insert into public.students (admission_no, full_name, gender, status, admission_date)
    values (concat('RT-', substr(v_user::text, 1, 6)), 'Anak Saya', 'MALE', 'ACTIVE', current_date)
    returning id into v_mine;
    insert into public.students (admission_no, full_name, gender, status, admission_date)
    values (concat('RT', substr(v_user::text, 1, 7)), 'Anak Orang', 'MALE', 'ACTIVE', current_date)
    returning id into v_theirs;

    insert into public.guardians (full_name, phone, user_id) values ('Penjaga RC', '0123456789', v_user)
    returning id into v_guardian;
    insert into public.student_guardians (student_id, guardian_id, relationship)
    values (v_mine, v_guardian, 'Mother');

    -- Report cards: PUBLISHED for mine, DRAFT for mine, PUBLISHED for the other family.
    insert into public.report_cards (student_id, academic_term_id, version, status, snapshot)
    select * from (values
        (v_mine,   (select term_a from fixtures), 1, 'PUBLISHED'::public.report_status, '{"assessments":[]}'::jsonb),
        (v_mine,   (select term_b from fixtures), 1, 'DRAFT'::public.report_status,     '{"assessments":[]}'::jsonb),
        (v_theirs, (select term_a from fixtures), 1, 'PUBLISHED'::public.report_status, '{"assessments":[]}'::jsonb)
    ) as v(student_id, academic_term_id, version, status, snapshot);
end;
$setup$;

-- F27rc1: a guardian CAN read their own child's published report card.
do $c1$
declare v_user uuid;
begin
    select p.id into v_user from public.profiles p where p.full_name = 'Penjaga RC' limit 1;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_user), true);

    if not exists (
        select 1 from public.report_cards rc join public.students s on s.id = rc.student_id
         where s.full_name = 'Anak Saya' and rc.status = 'PUBLISHED'
    ) then
        raise exception 'F27rc1: a guardian cannot read their own child''s published report card';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27rc1] a guardian can read their own child''s published report card';
end;
$c1$;

-- F27rc2: a guardian CANNOT read their own child's DRAFT. The office has not given it out.
do $c2$
declare v_user uuid;
begin
    select p.id into v_user from public.profiles p where p.full_name = 'Penjaga RC' limit 1;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_user), true);

    if exists (select 1 from public.report_cards where status = 'DRAFT') then
        raise exception 'F27rc2: a guardian can see a DRAFT report card';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27rc2] a guardian cannot see a draft report card';
end;
$c2$;

-- F27rc3: a guardian CANNOT read another family's child's report card.
do $c3$
declare v_user uuid;
begin
    select p.id into v_user from public.profiles p where p.full_name = 'Penjaga RC' limit 1;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_user), true);

    if exists (
        select 1 from public.report_cards rc join public.students s on s.id = rc.student_id
         where s.full_name = 'Anak Orang'
    ) then
        raise exception 'F27rc3: a guardian can read another family''s report card';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27rc3] a guardian cannot read another family''s report card';
end;
$c3$;

-- F27rc4: the office rule is untouched — staff still read everything, including drafts.
do $c4$
declare v_admin uuid;
begin
    select admin_id into v_admin from fixtures;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    if not exists (select 1 from public.report_cards where status = 'DRAFT') then
        raise exception 'F27rc4: the office can no longer see a draft report card';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27rc4] the office still sees everything, drafts included';
end;
$c4$;

rollback;
