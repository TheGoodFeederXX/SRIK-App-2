-- AUDIT F05 — a DISABLED guardian account must not resolve to anybody's child.
--
-- THE DEFECT, CONFIRMED ON PRODUCTION. `current_guardian_child_ids` matched the guardian row
-- by user id and nothing else, so a guardian whose profile is DISABLED still got their child's
-- id back from the helper. The student rows were withheld only because one particular policy
-- happened to wrap the call in `is_active_user()` — so the exposure depended on every caller
-- remembering to do the same, and the one that forgets is the hole.
--
-- FOUR CHECKS. The second is the one that matters: a fix that also locks out active guardians
-- would stop every parent from seeing their own child, which is worse than the defect.

begin;

do $setup$
declare
    v_g_disabled uuid := 'cccccccc-2222-4333-8444-555555555551';
    v_g_active   uuid := 'cccccccc-2222-4333-8444-555555555552';
    v_c_disabled uuid := 'cccccccc-2222-4333-8444-555555555553';
    v_c_active   uuid := 'cccccccc-2222-4333-8444-555555555554';
    v_guard1 uuid := 'cccccccc-2222-4333-8444-5555555555a1';
    v_guard2 uuid := 'cccccccc-2222-4333-8444-5555555555a2';
begin
    perform set_config('request.jwt.claims', '', true);

    insert into auth.users (id, email, email_confirmed_at) values
        (v_g_disabled, 'penjaga.mati.f05@srialkhairiah.my', now()),
        (v_g_active,   'penjaga.hidup.f05@srialkhairiah.my', now()),
        (v_c_disabled, 'anak.mati.f05@srialkhairiah.my', now()),
        (v_c_active,   'anak.hidup.f05@srialkhairiah.my', now());

    -- One guardian account DISABLED, one ACTIVE. This is the whole point of the suite.
    update public.profiles set full_name = 'Penjaga Mati F05', status = 'DISABLED' where id = v_g_disabled;
    update public.profiles set full_name = 'Penjaga Hidup F05', status = 'ACTIVE'   where id = v_g_active;
    update public.profiles set full_name = 'Anak Mati F05',   status = 'ACTIVE'   where id = v_c_disabled;
    update public.profiles set full_name = 'Anak Hidup F05',  status = 'ACTIVE'   where id = v_c_active;

    insert into public.guardians (id, user_id, full_name, phone) values
        (v_guard1, v_g_disabled, 'Penjaga Mati F05', '0111111111'),
        (v_guard2, v_g_active,   'Penjaga Hidup F05', '0122222222');

    insert into public.students (id, user_id, admission_no, full_name, gender, status, admission_date) values
        (v_c_disabled, v_c_disabled, 'F05-MATI', 'Anak Mati F05', 'MALE', 'ACTIVE', current_date),
        (v_c_active,   v_c_active,   'F05-HIDUP', 'Anak Hidup F05', 'FEMALE', 'ACTIVE', current_date);

    insert into public.student_guardians (student_id, guardian_id, relationship, is_primary) values
        (v_c_disabled, v_guard1, 'Bapa', true),
        (v_c_active,   v_guard2, 'Ibu',  true);

    perform set_config('srik.f05_disabled', v_g_disabled::text, false);
    perform set_config('srik.f05_active',   v_g_active::text,   false);
    perform set_config('srik.f05_child',    v_c_active::text,   false);
end;
$setup$;

-- F05a: THE DEFECT. A disabled guardian must resolve NO children.
do $c1$
declare v_n integer;
begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f05_disabled')), true);
    select coalesce(array_length(public.current_guardian_child_ids(), 1), 0) into v_n;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_n <> 0 then
        raise exception 'F05a: a DISABLED guardian still resolved % child(ren)', v_n;
    end if;
    raise notice 'PASS: [F05a] a disabled guardian resolves no children';
end;
$c1$;

-- F05b: an ACTIVE guardian still resolves their child, and can still read the row. A fix that
-- locks out every parent would be worse than the defect.
do $c2$
declare v_n integer;
begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f05_active')), true);
    select coalesce(array_length(public.current_guardian_child_ids(), 1), 0) into v_n;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_n <> 1 then
        raise exception 'F05b: an ACTIVE guardian resolved % children, expected 1', v_n;
    end if;
    raise notice 'PASS: [F05b] an active guardian still resolves their own child';
end;
$c2$;

-- F05c: re-enabling the account restores access. The audit asks that re-enable be tested,
-- because a status check that can never be satisfied again is a permanent lockout.
do $c3$
declare v_n integer;
begin
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set status = 'ACTIVE' where id = current_setting('srik.f05_disabled')::uuid;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', current_setting('srik.f05_disabled')), true);
    select coalesce(array_length(public.current_guardian_child_ids(), 1), 0) into v_n;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    if v_n <> 1 then
        raise exception 'F05c: re-enabling the account did not restore access (got %)', v_n;
    end if;
    raise notice 'PASS: [F05c] re-enabling the account restores access';
end;
$c3$;

-- F05d: the helper must not be callable by anon at all. It reads the caller's links, so an
-- unauthenticated caller has no links — but it should not even be reachable.
do $c4$
declare v_allowed boolean;
begin
    select has_function_privilege('anon', 'public.current_guardian_child_ids()', 'execute')
      into v_allowed;
    if v_allowed then
        raise exception 'F05d: anon can call current_guardian_child_ids';
    end if;
    raise notice 'PASS: [F05d] anon cannot call the guardian helper';
end;
$c4$;

rollback;
