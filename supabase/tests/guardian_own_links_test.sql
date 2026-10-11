-- ---------------------------------------------------------------------------
-- AUDIT F17 — a guardian can read their own child links, and nothing else.
--
-- The defect returned ZERO ROWS. Every assertion below is therefore about a count,
-- and the suite deliberately asserts the FORBIDDEN case as well as the allowed
-- one: "the guardian sees their child" would also pass if the policy had been
-- replaced by "everyone sees everything", which is a far worse bug than the one
-- being fixed.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP off
\timing off

-- A guardian with a login, a child, and a link between them.
insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-4000-eb00-000000000001', 'penjaga.f17@srik.test', now()),
    ('00000000-0000-4000-eb00-000000000002', 'penjaga.lain.f17@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    ('00000000-0000-4000-eb00-000000000001', 'Penjaga F17', 'ACTIVE', false),
    -- A DISABLED guardian, for the check that this path is not the exception.
    ('00000000-0000-4000-eb00-000000000002', 'Penjaga Nyahaktif F17', 'DISABLED', false)
on conflict (id) do update
    set status = excluded.status, must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    ('00000000-0000-4000-eb00-000000000001', 'GUARDIAN')
on conflict do nothing;

insert into public.guardians (id, full_name, phone, user_id) values
    ('00000000-0000-4000-eb00-000000000011', 'Penjaga F17', '0111111111', '00000000-0000-4000-eb00-000000000001'),
    ('00000000-0000-4000-eb00-000000000012', 'Penjaga Lain F17', '0222222222', null),
    ('00000000-0000-4000-eb00-000000000013', 'Penjaga Nyahaktif F17', '0333333333', '00000000-0000-4000-eb00-000000000002')
on conflict (id) do update set user_id = excluded.user_id;

insert into public.students (id, admission_no, full_name, gender, status) values
    ('00000000-0000-4000-eb00-000000000021', 'F17-A', 'Anak Sendiri F17', 'MALE', 'ACTIVE'),
    ('00000000-0000-4000-eb00-000000000022', 'F17-B', 'Anak Orang Lain F17', 'FEMALE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relationship, is_primary) values
    ('00000000-0000-4000-eb00-000000000021', '00000000-0000-4000-eb00-000000000011', 'IBU_BAPA', true),
    ('00000000-0000-4000-eb00-000000000022', '00000000-0000-4000-eb00-000000000012', 'IBU_BAPA', true),
    ('00000000-0000-4000-eb00-000000000022', '00000000-0000-4000-eb00-000000000013', 'IBU_BAPA', false)
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- F17a — the guardian sees their own link.  This is the defect.
-- ---------------------------------------------------------------------------
do $$
declare
    v_seen integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-eb00-000000000001', 'role', 'authenticated')::text, true);

    set local role authenticated;

    select count(*) into v_seen
      from public.student_guardians
     where guardian_id = '00000000-0000-4000-eb00-000000000011';

    reset role;

    if v_seen <> 1 then
        raise exception
            'FAIL F17a: a guardian sees % of their own child links, expected 1. The '
            'link policy reads public.guardians, whose own policy requires '
            'guardians.view — so the subquery finds nothing and the link is '
            'invisible to the family it belongs to.', v_seen;
    end if;

    raise notice 'PASS: [F17a] a guardian can read their own child link';
end;
$$;

-- ---------------------------------------------------------------------------
-- F17b — and NOT anyone else's.  Without this, "the guardian sees their child"
-- passes even if the policy had been widened to everyone.
-- ---------------------------------------------------------------------------
do $$
declare
    v_other integer;
    v_total integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-eb00-000000000001', 'role', 'authenticated')::text, true);

    set local role authenticated;

    -- Someone else's link, looked for BY ID so a filtered table cannot hide it.
    select count(*) into v_other
      from public.student_guardians
     where guardian_id = '00000000-0000-4000-eb00-000000000012';

    select count(*) into v_total from public.student_guardians;

    reset role;

    if v_other <> 0 then
        raise exception
            'FAIL F17b: a guardian can read % links belonging to ANOTHER family. '
            'The fix must grant a self-read, not a view permission — a name, a '
            'phone number and an address are in that row.', v_other;
    end if;

    if v_total <> 1 then
        raise exception
            'FAIL F17b: a guardian sees % links in total; exactly 1 is theirs. '
            'Anything more means the policy is wider than the family.', v_total;
    end if;

    raise notice 'PASS: [F17b] a guardian cannot read another family''s links';
end;
$$;

-- ---------------------------------------------------------------------------
-- F17c — a DISABLED account reads nothing through this path.
-- ---------------------------------------------------------------------------
do $$
declare
    v_seen integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-eb00-000000000002', 'role', 'authenticated')::text, true);

    set local role authenticated;
    select count(*) into v_seen from public.student_guardians;
    reset role;

    if v_seen <> 0 then
        raise exception
            'FAIL F17c: a DISABLED guardian sees % child links. A deactivated '
            'account must not keep reading its children''s records — this helper '
            'checks the account, not only the link.', v_seen;
    end if;

    raise notice 'PASS: [F17c] a disabled account reads nothing through this path';
end;
$$;

-- ---------------------------------------------------------------------------
-- F17d — the office still sees every link.  A fix that broke the office would be
-- a different bug wearing the first one's clothes.
-- ---------------------------------------------------------------------------
do $$
declare
    v_seen integer;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-eb00-000000000001', 'role', 'authenticated')::text, true);

    insert into public.user_roles (user_id, role_code) values
        ('00000000-0000-4000-eb00-000000000001', 'ADMIN')
    on conflict do nothing;

    set local role authenticated;
    select count(*) into v_seen from public.student_guardians;
    reset role;

    delete from public.user_roles
     where user_id = '00000000-0000-4000-eb00-000000000001' and role_code = 'ADMIN';

    if v_seen < 3 then
        raise exception
            'FAIL F17d: an administrator sees % links, expected all 3. The office '
            'must still be able to see every family''s links.', v_seen;
    end if;

    raise notice 'PASS: [F17d] the office still sees every link';
end;
$$;

-- ---------------------------------------------------------------------------
-- F17e — the helper is not callable by an anonymous visitor.
-- ---------------------------------------------------------------------------
do $$
begin
    if has_function_privilege('anon', 'public.guardian_is_me(uuid)', 'execute') then
        raise exception 'FAIL F17e: an anonymous caller can execute guardian_is_me';
    end if;
    raise notice 'PASS: [F17e] guardian_is_me is closed to anonymous callers';
end;
$$;

-- ---------------------------------------------------------------------------
-- F17f — the helper answers ONLY about the caller, whatever id it is handed.
-- ---------------------------------------------------------------------------
do $$
declare
    v_mine  boolean;
    v_other boolean;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-eb00-000000000001', 'role', 'authenticated')::text, true);

    v_mine  := public.guardian_is_me('00000000-0000-4000-eb00-000000000011');
    v_other := public.guardian_is_me('00000000-0000-4000-eb00-000000000012');

    if not v_mine then
        raise exception 'FAIL F17f: guardian_is_me says NO for the caller''s own row';
    end if;

    if v_other then
        raise exception
            'FAIL F17f: guardian_is_me says YES for ANOTHER guardian. The helper '
            'must answer "is this mine", never "does this exist" — otherwise it is '
            'a read-any-guardian permission in a boolean costume.';
    end if;

    raise notice 'PASS: [F17f] the helper answers only about the caller';
end;
$$;

-- Clean up the fixture. The two auth users are left: removing the last ACTIVE
-- ADMIN is refused by a real guard, and other suites' fixtures are shared.
delete from public.student_guardians
 where guardian_id in ('00000000-0000-4000-eb00-000000000011',
                       '00000000-0000-4000-eb00-000000000012',
                       '00000000-0000-4000-eb00-000000000013');
delete from public.students
 where id in ('00000000-0000-4000-eb00-000000000021', '00000000-0000-4000-eb00-000000000022');
delete from public.guardians
 where id in ('00000000-0000-4000-eb00-000000000011',
              '00000000-0000-4000-eb00-000000000012',
              '00000000-0000-4000-eb00-000000000013');
