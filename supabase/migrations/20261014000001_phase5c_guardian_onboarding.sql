-- ===========================================================================
-- Phase 5c — giving a parent an account, and connecting them to their children
-- ===========================================================================
-- Reference: docs/srik/07_PHASE_5_FINANCE.md, 02_PHASE_1_AUTH.md
--
-- Phase 5b created the GUARDIAN role and the policies that let a parent see
-- their own children's fees. But a role with no account is useless, and there
-- is no way yet to give a guardian one.
--
-- The obvious approach — call the Supabase admin API from the office screen —
-- is the wrong one here. The admin API needs the secret key, and the secret key
-- bypasses Row Level Security. Reaching the browser with it would be a data
-- breach, not a misconfiguration, which is why `client.ts` already refuses to
-- build a client when it sees one. Asking for it here would mean removing that
-- guard.
--
-- So the account is created in the database instead, where the key never has to
-- leave the server. The rules:
--
-- 1. CREATING AN ACCOUNT IS NOT THE SAME AS GRANTING ACCESS. Creating the login
--    makes a row in `auth.users`. What a parent can SEE is decided by the
--    family link and the policies from 5b. This migration does not touch either,
--    which is what keeps a half-finished setup harmless: a parent with an
--    account but no children linked sees an empty screen, not everyone's.
--
-- 2. A GUARDIAN IS NOT GIVEN THE STAFF ROLE BY ACCIDENT. The role is written
--    explicitly here as GUARDIAN, and the function refuses any other value, so
--    a mistake in a screen cannot quietly create an administrator.
--
-- 3. REVOKING IS AS IMPORTANT AS GRANTING. Unlinking a guardian from a child is
--    a supported action, because a family's circumstances change and the school
--    must be able to act on that. Unlinking removes access immediately, since
--    the policies ask the family link every time.
--
-- 4. THE AUDIT TRAIL IS NOT OPTIONAL. Who created an account, for whom, and who
--    linked which child to which parent, are all recorded. These are the
--    actions a school would be asked to explain.

-- --- Creating a parent's login ----------------------------------------------

/*
 * Creates a login for a guardian and links it to their existing record.
 *
 * `auth.users` is written directly because this function is SECURITY DEFINER
 * and owned by the migration runner. That is a privileged act, which is why
 * every call is audited and the permission is checked at the top.
 *
 * The password is set by the caller and must be handed to the parent, who
 * should change it. No password is generated here: a generated password that
 * nobody records becomes a support call.
 */
create or replace function public.create_guardian_account(
    p_guardian_id uuid,
    p_email text,
    p_password text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_guardian public.guardians;
    v_user_id  uuid;
    v_existing uuid;
begin
    if not public.has_permission('users.manage') then
        raise exception 'You do not have permission to create an account'
            using errcode = '42501';
    end if;

    if p_email is null or btrim(p_email) = '' or position('@' in p_email) = 0 then
        raise exception 'A valid email address is required'
            using errcode = 'invalid_parameter_value';
    end if;

    -- Short passwords are the single easiest way for a child's record to leak.
    if p_password is null or length(p_password) < 8 then
        raise exception 'The password must be at least 8 characters'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'Creating an account must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into v_guardian from public.guardians where id = p_guardian_id;
    if v_guardian.id is null then
        raise exception 'Guardian % does not exist', p_guardian_id
            using errcode = 'no_data_found';
    end if;

    if v_guardian.user_id is not null then
        raise exception 'That guardian already has a login'
            using errcode = 'check_violation';
    end if;

    select id into v_existing from auth.users where lower(email) = lower(btrim(p_email));
    if v_existing is not null then
        raise exception 'An account with that email already exists'
            using errcode = 'unique_violation';
    end if;

    v_user_id := gen_random_uuid();

    -- The columns are assembled explicitly rather than written as a fixed list,
    -- because `auth.users` differs between a real Supabase project and the local
    -- test shim: the real one has `instance_id`, `aud` and `role`, and the shim
    -- does not. Both are legitimate; this builds only what is there.
    --
    -- crypt() comes from pgcrypto, which Supabase installs in the `extensions`
    -- schema. It is schema-qualified because this function runs with an empty
    -- search_path, so an unqualified name would not resolve. The password is
    -- never stored in clear text, here or anywhere else.
    execute format(
        'insert into auth.users (%s) values (%s)',
        (
            select string_agg(quote_ident(column_name), ', ' order by column_name)
              from information_schema.columns
             where table_schema = 'auth' and table_name = 'users'
               and column_name in (
                   'id', 'instance_id', 'aud', 'role', 'email', 'encrypted_password',
                   'email_confirmed_at', 'raw_app_meta_data', 'raw_user_meta_data',
                   'created_at', 'updated_at'
               )
        ),
        (
            select string_agg(
                       case column_name
                           when 'id' then quote_literal(v_user_id)
                           when 'instance_id' then quote_literal('00000000-0000-0000-0000-000000000000')
                           when 'aud' then quote_literal('authenticated')
                           when 'role' then quote_literal('authenticated')
                           when 'email' then quote_literal(lower(btrim(p_email)))
                           when 'encrypted_password' then
                               quote_literal(extensions.crypt(p_password, extensions.gen_salt('bf')))
                           when 'email_confirmed_at' then 'now()'
                           when 'raw_app_meta_data' then
                               quote_literal(jsonb_build_object(
                                   'provider', 'email',
                                   'providers', jsonb_build_array('email'))::text)
                           when 'raw_user_meta_data' then
                               quote_literal(jsonb_build_object(
                                   'full_name', v_guardian.full_name,
                                   'is_guardian', true)::text)
                           else 'now()'
                       end,
                       ', ' order by column_name)
              from information_schema.columns
             where table_schema = 'auth' and table_name = 'users'
               and column_name in (
                   'id', 'instance_id', 'aud', 'role', 'email', 'encrypted_password',
                   'email_confirmed_at', 'raw_app_meta_data', 'raw_user_meta_data',
                   'created_at', 'updated_at'
               )
        )
    );

    -- The identity row is what email/password sign-in actually reads. It exists
    -- on a real Supabase project but not in the local shim, so it is inserted
    -- only where the table is present.
    if exists (
        select 1 from information_schema.tables
         where table_schema = 'auth' and table_name = 'identities'
    ) then
        execute format(
            'insert into auth.identities (%s) values (%s)',
            (
                select string_agg(quote_ident(column_name), ', ' order by column_name)
                  from information_schema.columns
                 where table_schema = 'auth' and table_name = 'identities'
                   and column_name in (
                       'id', 'user_id', 'provider_id', 'identity_data', 'provider',
                       'last_sign_in_at', 'created_at', 'updated_at'
                   )
            ),
            (
                select string_agg(
                           case column_name
                               when 'id' then 'gen_random_uuid()'
                               when 'user_id' then quote_literal(v_user_id)
                               when 'provider_id' then quote_literal(v_user_id::text)
                               when 'identity_data' then
                                   quote_literal(jsonb_build_object(
                                       'sub', v_user_id::text,
                                       'email', lower(btrim(p_email)))::text)
                               when 'provider' then quote_literal('email')
                               else 'now()'
                           end,
                           ', ' order by column_name)
                  from information_schema.columns
                 where table_schema = 'auth' and table_name = 'identities'
                   and column_name in (
                       'id', 'user_id', 'provider_id', 'identity_data', 'provider',
                       'last_sign_in_at', 'created_at', 'updated_at'
                   )
            )
        );
    end if;

    -- The GUARDIAN role, written explicitly. Never derived from anything the
    -- caller passed, so a mistake in a screen cannot create an administrator.
    insert into public.user_roles (user_id, role_code, granted_by)
    values (v_user_id, 'GUARDIAN', auth.uid())
    on conflict do nothing;

    update public.guardians
       set user_id = v_user_id, email = lower(btrim(p_email)), updated_at = now()
     where id = p_guardian_id;

    insert into public.authorization_audit (actor_id, action, subject_id, role_code, detail)
    values (auth.uid(), 'GUARDIAN_ACCOUNT_CREATED', p_guardian_id, 'GUARDIAN',
            jsonb_build_object('email', lower(btrim(p_email)), 'user_id', v_user_id,
                               'reason', p_reason));

    return jsonb_build_object(
        'user_id', v_user_id,
        'guardian_id', p_guardian_id,
        'email', lower(btrim(p_email))
    );
end;
$$;

comment on function public.create_guardian_account(uuid, text, text, text) is
    'Creates a login for a guardian and links it to their record. The account is '
    'created in the database so the secret key never reaches a browser. The role '
    'is always GUARDIAN. Requires users.manage, a password of at least 8 '
    'characters, and a written reason.';

revoke all on function public.create_guardian_account(uuid, text, text, text) from public;
grant execute on function public.create_guardian_account(uuid, text, text, text) to authenticated;

-- --- Linking and unlinking a child ------------------------------------------

/*
 * Connects a guardian to a child, or disconnects them.
 *
 * `p_link = false` REMOVES access immediately, because every parent policy asks
 * the family link at read time. Nothing is cached, so there is no window in
 * which a removed guardian can still see the child.
 */
create or replace function public.set_guardian_child_link(
    p_guardian_id uuid,
    p_student_id uuid,
    p_link boolean,
    p_relationship text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('guardians.manage') then
        raise exception 'You do not have permission to change family links'
            using errcode = '42501';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'Changing a family link must state a reason'
            using errcode = 'invalid_parameter_value';
    end if;

    if not exists (select 1 from public.guardians where id = p_guardian_id) then
        raise exception 'Guardian % does not exist', p_guardian_id
            using errcode = 'no_data_found';
    end if;
    if not exists (select 1 from public.students where id = p_student_id) then
        raise exception 'Student % does not exist', p_student_id
            using errcode = 'no_data_found';
    end if;

    if p_link then
        if p_relationship is null or btrim(p_relationship) = '' then
            raise exception 'A relationship is required when linking a child'
                using errcode = 'invalid_parameter_value';
        end if;

        insert into public.student_guardians (student_id, guardian_id, relationship)
        values (p_student_id, p_guardian_id, btrim(p_relationship))
        on conflict (student_id, guardian_id) do update
            set relationship = excluded.relationship;
    else
        delete from public.student_guardians
         where student_id = p_student_id and guardian_id = p_guardian_id;

        if not found then
            raise exception 'That guardian is not linked to that child'
                using errcode = 'no_data_found';
        end if;
    end if;

    insert into public.authorization_audit (actor_id, action, subject_id, detail)
    values (auth.uid(),
            case when p_link then 'GUARDIAN_CHILD_LINKED' else 'GUARDIAN_CHILD_UNLINKED' end,
            p_guardian_id,
            jsonb_build_object('student_id', p_student_id, 'reason', p_reason,
                               'relationship', p_relationship));

    return jsonb_build_object('guardian_id', p_guardian_id, 'student_id', p_student_id,
                              'linked', p_link);
end;
$$;

comment on function public.set_guardian_child_link(uuid, uuid, boolean, text, text) is
    'Links or unlinks a guardian and a child. Unlinking removes access at once, '
    'because every parent policy reads the family link rather than a cached list.';

revoke all on function public.set_guardian_child_link(uuid, uuid, boolean, text, text) from public;
grant execute on function public.set_guardian_child_link(uuid, uuid, boolean, text, text) to authenticated;

-- --- The office's list of guardians and their children ----------------------

/*
 * Every guardian, whether they can log in, and which children they can see.
 *
 * The office needs this to answer "does this parent have the app yet?" and to
 * check a link before a term starts. `user_id is not null` is the single fact
 * that decides whether a parent can log in at all.
 */
create or replace function public.list_guardians_with_children()
returns table (
    guardian_id     uuid,
    full_name       text,
    phone           text,
    email           text,
    has_login       boolean,
    child_count     bigint,
    child_names     text
)
language sql
stable
security definer
set search_path = ''
as $$
    select g.id,
           g.full_name,
           g.phone,
           g.email,
           g.user_id is not null,
           count(sg.student_id),
           coalesce(string_agg(s.full_name, ', ' order by s.full_name), '')
      from public.guardians g
      left join public.student_guardians sg on sg.guardian_id = g.id
      left join public.students s on s.id = sg.student_id
     where public.has_permission('guardians.view')
     group by g.id, g.full_name, g.phone, g.email, g.user_id
     order by g.full_name;
$$;

comment on function public.list_guardians_with_children() is
    'Guardians with whether they have a login and which children they are linked '
    'to. Returns nothing without guardians.view.';

revoke all on function public.list_guardians_with_children() from public;
grant execute on function public.list_guardians_with_children() to authenticated;
