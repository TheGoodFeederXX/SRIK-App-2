-- F28 — balances for many charges in ONE request.
--
-- THE FINDING. `chargeBalances` called `charge_paid_amount` once per charge, all in
-- parallel. The screen that lists a family's charges for a few months produces a few
-- hundred of these, so opening the page meant a few hundred round trips. Parallel
-- requests are not free: each is a separate HTTP request to the Data API, each one
-- authenticated separately, and a school on a slow connection waits for the slowest
-- of them all. The audit found this and it was exactly as described.
--
-- Family balance was fixed in the same pass, but that is a different question: it
-- totals a whole family and needs its own authorization. This is the per-charge
-- figure, for a list.
--
-- WHAT THIS DOES. One call, one query, one authorization decision per charge — using
-- the SAME gate `charge_paid_amount` already applies, so the answer cannot differ
-- from the single-charge function. The formulas are not duplicated: this delegates
-- to `charge_paid_amount` for each id it is authorised to answer, and simply does it
-- inside one database round trip rather than many HTTP ones.
--
-- WHY IT IS NOT A WEAKENING. This is the temptation to watch for. A bulk function is
-- the classic place where per-row authorization quietly becomes "authorize once":
-- the caller passes 500 ids, the function checks that they may read ONE charge, and
-- returns all 500. That mistake would hand a guardian another family's balances.
--
-- So every id is checked, individually, inside the function. There is no "trusted
-- caller" path. The check is the same three-way gate as `charge_paid_amount`:
--   - the office (`finance.view`), or
--   - a guardian of THAT charge's student.
-- Anything else is refused with the same message. Refusing is preferred to silently
-- omitting: a caller who asked for 500 and got 480 has no way to tell whether 20
-- charges were missing or 20 were empty.
begin;

create or replace function public.charge_paid_amounts(p_charge_ids uuid[])
returns table (charge_id uuid, paid_amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    -- The caller's own authority is resolved ONCE, but it is APPLIED per charge.
    -- Resolving it once is an optimization; the loop below is what keeps it correct.
    foreach v_id in array coalesce(p_charge_ids, '{}'::uuid[])
    loop
        -- The same gate as `charge_paid_amount`, asked about THIS charge. A
        -- function that checked only the first id would pass every test that used
        -- one id, which is how this kind of hole survives review.
        if auth.uid() is not null
           and not public.has_permission('finance.view')
           and not exists (
                select 1
                  from public.student_charges c
                 where c.id = v_id
                   and public.is_guardian_of(c.student_id)
           )
        then
            raise exception
                'You do not have permission to read the balance of charge %', v_id
                using errcode = 'insufficient_privilege';
        end if;

        charge_id := v_id;
        paid_amount := public.charge_paid_amount(v_id);
        return next;
    end loop;
end;
$$;

comment on function public.charge_paid_amounts(uuid[]) is
    'The paid amount for each of several charges, in one request. Authorizes every '
    'charge individually with the same gate as charge_paid_amount — a bulk call is '
    'not a licence to check once and return many. Added for audit F28.';

-- Only a signed-in caller. An anonymous one has no identity to authorize against,
-- and the loop above would refuse every id anyway; refusing at the door is clearer
-- than refusing 500 times.
revoke all on function public.charge_paid_amounts(uuid[]) from public, anon;
grant execute on function public.charge_paid_amounts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify the property on the function that was actually deployed.
-- ---------------------------------------------------------------------------
do $$
declare
    v_body text;
begin
    v_body := pg_get_functiondef(
        (select oid from pg_proc where proname = 'charge_paid_amounts')
    );

    -- The per-charge gate must be INSIDE the loop, not before it. A gate that runs
    -- once, outside, is precisely the defect this function had to avoid.
    if v_body not like '%is_guardian_of%' then
        raise exception
            'F28 guard: charge_paid_amounts does not check guardianship at all'
            using errcode = 'insufficient_privilege';
    end if;

    if position('foreach' in lower(v_body)) = 0 then
        raise exception
            'F28 guard: charge_paid_amounts does not loop over the ids, so it cannot '
            'be authorizing each one'
            using errcode = 'insufficient_privilege';
    end if;

    -- The gate must come AFTER the loop begins. Comparing positions is a crude
    -- check, but it is the difference between "authorize each" and "authorize once"
    -- — and that difference is the entire risk of this function.
    if position('foreach' in lower(v_body)) > position('is_guardian_of' in lower(v_body)) then
        raise exception
            'F28 guard: charge_paid_amounts checks guardianship BEFORE the loop, so it '
            'authorizes one charge and answers for all of them'
            using errcode = 'insufficient_privilege';
    end if;

    if has_function_privilege(
        'anon', 'public.charge_paid_amounts(uuid[])', 'execute'
    ) then
        raise exception 'F28 guard: an anonymous caller can request charge balances'
            using errcode = 'insufficient_privilege';
    end if;
end;
$$;

commit;
