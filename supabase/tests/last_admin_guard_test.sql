-- Guard tests for audit finding F12 — the last-admin protection can be bypassed.
--
-- THE DEFECT, proven against production before being changed. `protect_last_admin`
-- counts the remaining administrators as:
--
--     ... and ur.user_id <> old_user
--
-- which excludes the row being removed and asks whether anybody ELSE is an admin.
-- On a DELETE that is correct. On an UPDATE it is not, because the row does not
-- disappear — it MOVES.
--
-- THE EXACT BYPASS, and being precise about it matters because the wrong reading
-- leads to the wrong fix. Moving the last ADMIN grant to another ACTIVE account
-- leaves exactly one active administrator, so the system is still administrable and
-- allowing it is correct. The bypass is moving it to a **DISABLED** account: the
-- count requires `p.status = 'ACTIVE'`, so the arriving grant does not count, the
-- check passed because the departing row still existed, and `active_admin_count()`
-- becomes 0. The school is locked out of its own administration, silently.
--
-- MEASURED: with one active admin, the move produced `active_admin_count = 0` while
-- the original administrator's ADMIN row count went to 0 as well — nobody held a
-- working ADMIN grant, and nothing had warned anybody.
--
-- The trigger's own error message says "Promote or enable another administrator
-- first" — the intent is unambiguous, and the UPDATE path does not implement it.
begin;

create or replace function test_id(p_label text)
returns uuid language sql immutable as $$
    select ('00000000-0000-4000-e200-' || lpad(p_label, 12, '0'))::uuid;
$$;

reset role;

-- Two accounts, each able to hold the ADMIN grant.
insert into auth.users (id, email, email_confirmed_at) values
    (test_id('1'), 'admin.satu@srik.test', now()),
    (test_id('2'), 'admin.dua@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status) values
    (test_id('1'), 'Pentadbir Satu', 'ACTIVE'),
    (test_id('2'), 'Pentadbir Dua', 'ACTIVE')
on conflict (id) do update set status = excluded.status;

-- Exactly ONE administrator, which is the state the protection exists for.
delete from public.user_roles where user_id in (test_id('1'), test_id('2'));
insert into public.user_roles (user_id, role_code) values (test_id('1'), 'ADMIN');

do $$
begin
    if public.active_admin_count() < 1 then
        raise exception 'FAIL F12: the fixture left no administrator to protect'
            using errcode = 'raise_exception';
    end if;
end
$$;

-- ===========================================================================
-- F12a: moving the last ADMIN grant to a DISABLED account must be REFUSED.
--
-- This is the finding as the audit states it, and the distinction is the test:
-- a move to an ACTIVE account is legitimate (test F12b below proves it is still
-- allowed), a move to a DISABLED one silently leaves the school with nobody who
-- can administer it.
-- ===========================================================================
reset role;
update public.profiles set status = 'DISABLED' where id = test_id('2');

do $$
declare
    v_blocked boolean := false;
    v_admins  integer;
begin
    begin
        update public.user_roles
           set user_id = test_id('2')   -- a DISABLED account
         where role_code = 'ADMIN'
           and user_id = test_id('1');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        -- Report the consequence, not merely that something was not raised: the
        -- number of administrators is the property the guard exists to keep above
        -- zero.
        select active_admin_count() into v_admins;
        raise exception
            'FAIL F12: the last ADMIN grant moved to a DISABLED account; '
            'active administrators is now %', v_admins
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the last ADMIN grant cannot be moved to a disabled account';
end
$$;

-- ===========================================================================
-- F12b: moving the grant to another ACTIVE account must be ALLOWED.
--
-- The both-halves rule again, and here it is the whole point of the finding. A
-- guard that refused every move would pass F12a and break the school's ability to
-- hand over administration — which is a normal thing to do. The property is "at
-- least one ACTIVE administrator exists afterwards", not "user_id never changes".
-- ===========================================================================
reset role;
update public.profiles set status = 'ACTIVE' where id = test_id('2');

do $$
declare
    v_count integer;
begin
    update public.user_roles
       set user_id = test_id('2')
     where role_code = 'ADMIN'
       and user_id = test_id('1');

    select count(*) into v_count from public.user_roles
     where role_code = 'ADMIN' and user_id = test_id('2');
    if v_count < 1 then
        raise exception 'FAIL F12: a legitimate hand-over was refused or lost'
            using errcode = 'raise_exception';
    end if;
    if public.active_admin_count() < 1 then
        raise exception 'FAIL F12: a legitimate hand-over left no administrator'
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: handing administration to another active account is allowed';
end
$$;

-- ===========================================================================
-- F12c: DISABLING the last admin must be refused too.
--
-- The count requires `p.status = 'ACTIVE'`, so disabling the account removes it
-- from the count without touching `user_roles` at all — the same unadministrable
-- state by a second route, on a table the protection did not watch.
-- ===========================================================================
reset role;
-- Restore the "exactly one administrator" state for the disable test.
--
-- The order matters and the guard itself enforces it: the grant must be given to
-- account 1 BEFORE it is taken from account 2, because removing the only admin is
-- exactly what F12c's trigger now refuses. Writing the fixture in the other order
-- makes the setup fail on its own guard — which is the correct behaviour, and it
-- is how this ordering was found.
update public.profiles set status = 'ACTIVE' where id in (test_id('1'), test_id('2'));
insert into public.user_roles (user_id, role_code) values (test_id('1'), 'ADMIN')
on conflict do nothing;
delete from public.user_roles where user_id = test_id('2');

do $$
declare
    v_blocked boolean := false;
begin
    begin
        update public.profiles set status = 'DISABLED' where id = test_id('1');
    exception when others then
        v_blocked := true;
    end;

    if not v_blocked then
        raise exception
            'FAIL F12: the last ACTIVE administrator was disabled; '
            'active administrators is now %', public.active_admin_count()
            using errcode = 'raise_exception';
    end if;
    raise notice 'PASS: the last active administrator cannot be disabled';
end
$$;

rollback;
