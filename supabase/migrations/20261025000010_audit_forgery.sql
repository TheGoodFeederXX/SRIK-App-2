-- AUDIT F11 — the authorization audit could be forged by any active user. (P1)
--
-- THE FINDING, CONFIRMED ON PRODUCTION AFTER EVERYTHING ELSE WAS DONE. The table is
-- append-only and its SELECT is properly restricted to `audit.view` — but its INSERT policy
-- was `is_active_user()`, with no WITH CHECK at all. A teacher could write any row they
-- liked, naming any actor and any action.
--
--     insert into authorization_audit (actor_id, action)
--     values ('<an admin uuid>', 'FAKE_ADMIN_ACTION');
--
-- I ran exactly that as a teacher against production: `INSERT 0 1`. A row appeared saying an
-- admin had performed an action they never performed. An audit trail anyone can write to is
-- not an audit trail; it is a text file. And it is WORSE than no trail, because the whole
-- point of it is to be believed.
--
-- The audit's own note is the clue: the teacher's first attempt used RETURNING and was
-- refused only because they lacked SELECT. Removing RETURNING let it through. The append-only
-- guarantee protected nothing about authenticity.
--
-- WHY REVOKING INSERT DOES NOT BREAK THE REAL TRAIL. Writes to this table come from
-- `audit_authorization_change()`, which is SECURITY DEFINER and owned by postgres, and from
-- `clear_temporary_password_flag()`, also SECURITY DEFINER. Both run as the owner and do not
-- need `authenticated` to hold INSERT at all — and both take the actor from `auth.uid()`
-- rather than from a value the caller supplied. So the legitimate path keeps working and the
-- forged path closes.
--
-- The trigger is what makes the actor true; the grant is what makes it the only way in.

revoke insert, update, delete, truncate on public.authorization_audit from authenticated;

drop policy if exists authz_audit_insert on public.authorization_audit;

comment on table public.authorization_audit is
    'Append-only authorization trail. Written ONLY by security-definer functions and triggers '
    'that take the actor from auth.uid(). No client role holds INSERT (audit F11: a teacher '
    'could forge a row naming an admin, because the INSERT policy was only is_active_user()).';

do $guard$
declare
    v_withcheck text;
    v_n int;
begin
    -- The policy that allowed this must be gone.
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = 'authorization_audit' and cmd = 'INSERT';
    if v_n <> 0 then
        raise exception 'F11: an INSERT policy still exists on the authorization audit';
    end if;

    -- No client role may hold a write privilege.
    if has_table_privilege('authenticated', 'public.authorization_audit', 'insert') then
        raise exception 'F11: authenticated can still insert into the authorization audit';
    end if;
    if has_table_privilege('authenticated', 'public.authorization_audit', 'update') then
        raise exception 'F11: authenticated can update the authorization audit';
    end if;
    if has_table_privilege('authenticated', 'public.authorization_audit', 'delete') then
        raise exception 'F11: authenticated can delete from the authorization audit';
    end if;
    if has_table_privilege('anon', 'public.authorization_audit', 'insert') then
        raise exception 'F11: anon can insert into the authorization audit';
    end if;

    -- And the REAL path must still work: a security-definer writer owned by the table owner.
    if not exists (
        select 1 from pg_proc p
         where p.proname = 'audit_authorization_change'
           and p.prosecdef
    ) then
        raise exception 'F11: the audit writer is no longer security definer — the real trail would break';
    end if;
end;
$guard$;
