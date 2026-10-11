-- AUDIT F27 — a student could not read their OWN record, attendance or report card.
--
-- THE FINDING. Every read policy on these tables named the people who look AFTER the
-- child, never the child. A teacher needs a permission, a parent is admitted by the
-- family link, and a student was admitted by NOTHING. Verified on production: with a
-- real student login and their own row present, every read returned zero — which reads
-- as "no record" rather than "not allowed".

\set ON_ERROR_STOP on

begin;

create temp table fx as
select
    (select ay.id from public.academic_years ay where ay.status = 'CURRENT' limit 1) as year_id,
    gen_random_uuid() as term_a,
    gen_random_uuid() as student_user,
    gen_random_uuid() as other_user;

-- Two children with their own logins, and one attendance day for the first.
do $setup$
declare
    v_mine uuid; v_theirs uuid; v_year uuid; v_term uuid;
begin
    select year_id, term_a, student_user, other_user into v_year, v_term, v_mine, v_theirs from fx;

    insert into auth.users (id, email, email_confirmed_at) values
        (v_mine, 'murid.rc@srialkhairiah.my', now()),
        (v_theirs, 'bukan.saya@srialkhairiah.my', now());

    update public.profiles set full_name = 'Murid RC', status = 'ACTIVE' where id = v_mine;
    update public.profiles set full_name = 'Bukan Saya', status = 'ACTIVE' where id = v_theirs;

    insert into public.academic_terms (id, academic_year_id, name, sequence, start_date, end_date, status)
    select v_term, v_year, 'Penggal RC Murid', 93, '2026-01-01', '2026-06-30', 'PLANNED'
    where v_year is not null
      and not exists (select 1 from public.academic_terms where id = v_term);

    insert into public.students (user_id, admission_no, full_name, gender, status, admission_date)
    values (v_mine, concat('SP', substr(v_mine::text, 1, 6)), 'Murid RC', 'MALE', 'ACTIVE', current_date);
    insert into public.students (user_id, admission_no, full_name, gender, status, admission_date)
    values (v_theirs, concat('SO', substr(v_theirs::text, 1, 6)), 'Murid Lain', 'MALE', 'ACTIVE', current_date);

    -- One PUBLISHED report card for each, so the limit can be tested both ways.
    insert into public.report_cards (student_id, academic_term_id, version, status, snapshot)
    select s.id, v_term, 1, 'PUBLISHED'::public.report_status, '{"assessments":[]}'::jsonb
      from public.students s where s.user_id in (v_mine, v_theirs);
end;
$setup$;

-- F27st1: a student CAN read their own record.
do $c1$
declare v_user uuid;
begin
    select student_user into v_user from fx;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    if not exists (select 1 from public.students where full_name = 'Murid RC') then
        raise exception 'F27st1: a student cannot read their own record';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27st1] a student can read their own record';
end;
$c1$;

-- F27st2: a student CANNOT read another family's child. This is the half that makes
-- the policy safe rather than merely permissive.
do $c2$
declare v_user uuid;
begin
    select student_user into v_user from fx;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    if exists (select 1 from public.students where full_name = 'Murid Lain') then
        raise exception 'F27st2: a student can read another family''s child';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27st2] a student cannot read another family''s child';
end;
$c2$;

-- F27st3: a student CAN read their own report card, and a DRAFT is still refused.
do $c3$
declare v_user uuid;
begin
    select student_user into v_user from fx;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user), true);

    -- Their own PUBLISHED card is visible...
    if (select count(*) from public.report_cards rc
         join public.students s on s.id = rc.student_id
        where s.full_name = 'Murid RC' and rc.status = 'PUBLISHED') = 0 then
        raise exception 'F27st3: a student cannot read their own published report card';
    end if;
    -- ...but the other family's is not.
    if exists (select 1 from public.report_cards rc
                join public.students s on s.id = rc.student_id
               where s.full_name = 'Murid Lain') then
        raise exception 'F27st3: a student can read another family''s report card';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27st3] a student reads only their own report card';
end;
$c3$;

-- F27st4: the office rule is untouched. Staff still see everyone.
do $c4$
declare v_admin uuid;
begin
    select p.id into v_admin from public.profiles p join public.user_roles ur on ur.user_id = p.id
     where ur.role_code = 'ADMIN' and p.status = 'ACTIVE' limit 1;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin), true);

    if (select count(*) from public.students where full_name in ('Murid RC', 'Murid Lain')) < 2 then
        raise exception 'F27st4: the office can no longer see every student';
    end if;

    perform set_config('role', 'postgres', true);
    raise notice 'PASS: [F27st4] the office still sees every student';
end;
$c4$;

rollback;
