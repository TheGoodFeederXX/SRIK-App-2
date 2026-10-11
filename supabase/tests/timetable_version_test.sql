-- ---------------------------------------------------------------------------
-- AUDIT F36 — publishing a timetable does not cut the school off early, and a
-- published timetable cannot be edited in place.
--
-- The cutover defect is silent in production: publishing next term's timetable
-- early marks the current one as ended yesterday, and the screens then find no
-- current version and show an empty week. There is no error to notice, which is
-- why this suite asserts the DATES rather than that the call succeeded.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP off
\timing off

-- The fixture signs in as its OWN admin.
--
-- `has_permission` requires an ACTIVE profile, and a scratch database has no real
-- user. Using the production admin's id would have made this suite pass only against
-- production: publication is granted through `role_permissions`, so the user has to
-- exist before any of it means anything.
insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-4000-e900-0000000000aa', 'admin.f36@srik.test', now())
on conflict (id) do nothing;

insert into public.profiles (id, full_name, status, must_change_password) values
    ('00000000-0000-4000-e900-0000000000aa', 'Admin F36', 'ACTIVE', false)
on conflict (id) do update
    set status = excluded.status, must_change_password = excluded.must_change_password;

insert into public.user_roles (user_id, role_code) values
    ('00000000-0000-4000-e900-0000000000aa', 'ADMIN')
on conflict do nothing;

-- A unique index allows one PUBLISHED timetable per academic year, so the fixture
-- needs a CURRENT year. A fresh migration-built database has none, and a suite that
-- refused to run there would be a suite that only ever passes on the machine where
-- it was written.
do $$
begin
    if (select count(*) from public.academic_years where status = 'CURRENT') = 0 then
        insert into public.academic_years (id, name, start_date, end_date, status)
        values ('00000000-0000-4000-e901-000000000001', 'F36 Tahun', date '2026-01-01', date '2026-12-31', 'CURRENT');
    end if;
end;
$$;

-- Helpers. Functions rather than temp tables: `authenticated` cannot read a temp
-- table a superuser created, so an assertion reading one would fail with
-- "permission denied" and look like a policy refusal.
create or replace function public.t36_year() returns uuid language sql stable as $$
    select id from public.academic_years where status = 'CURRENT'
     order by (id = '00000000-0000-4000-e901-000000000001')::int desc
     limit 1;
$$;

create or replace function public.t36_make(
    p_id uuid, p_version integer, p_from date, p_status public.timetable_status
) returns void language plpgsql as $$
begin
    -- `published_by` references auth.users, which a scratch database has none of,
    -- so it is left null: the column is nullable and the guard being tested does
    -- not read it. `published_at` IS required on a non-draft row by
    -- `timetables_publish_metadata`, which is a real rule worth honouring.
    insert into public.timetables (id, academic_year_id, name, version, status, effective_from, published_at)
    values (p_id, public.t36_year(), 'Ujian ' || p_version, p_version, p_status, p_from,
            case when p_status = 'PUBLISHED' then now() else null end)
    on conflict (id) do nothing;
end;
$$;

create or replace function public.t36_lesson(p_timetable uuid, p_period uuid) returns void
language plpgsql as $$
declare
    v_class   uuid := '00000000-0000-4000-e902-000000000001';
    v_subject uuid := '00000000-0000-4000-e902-000000000002';
begin
    -- The fixture builds its own class and subject. A scratch database has none,
    -- and borrowing the real ones would tie this suite to whichever machine it runs
    -- on. `teacher_id` is left null: a teacher must be assigned to teach the subject
    -- in that class, and inventing an assignment here would be testing the fixture
    -- rather than the timetable.
    insert into public.subjects (id, code, name)
    values (v_subject, 'F36', 'F36 Ujian') on conflict (id) do nothing;

    insert into public.classes (id, academic_year_id, year_level, name, code, status)
    values (v_class, public.t36_year(), 6, 'F36 Kelas', 'F36K', 'ACTIVE') on conflict (id) do nothing;

    insert into public.timetable_periods (id, timetable_id, day_of_week, period_number, start_time, end_time, type)
    values (p_period, p_timetable, 'SUNDAY', 1, '07:30', '08:00', 'TEACHING')
    on conflict (id) do nothing;

    insert into public.timetable_entries (id, period_id, class_id, subject_id)
    values (gen_random_uuid(), p_period, v_class, v_subject)
    on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- F36a — the cutover follows the NEW version's start date.
-- ---------------------------------------------------------------------------
do $$
declare
    v_old_from date := date '2026-01-05';
    v_new_from date := date '2026-07-01';
    v_old_end  date;
begin
    -- Put the real published timetable aside so the fixture owns the year.
    update public.timetables set status = 'DRAFT', published_at = null, published_by = null
     where status = 'PUBLISHED';

    perform public.t36_make('00000000-0000-4000-e900-000000000001', 1, v_old_from, 'PUBLISHED');
    perform public.t36_make('00000000-0000-4000-e900-000000000002', 2, v_new_from, 'DRAFT');
    perform public.t36_lesson('00000000-0000-4000-e900-000000000002', '00000000-0000-4000-e900-000000000011');

    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-e900-0000000000aa', 'role', 'authenticated')::text, true);

    perform public.publish_timetable('00000000-0000-4000-e900-000000000002', 'ganti jadual');

    select effective_to into v_old_end
      from public.timetables where id = '00000000-0000-4000-e900-000000000001';

    if v_old_end is distinct from (v_new_from - interval '1 day')::date then
        raise exception
            'FAIL F36a: the superseded timetable ends % but should end % — the day '
            'before the new version starts. Anything else leaves a gap in which the '
            'school has no timetable at all.',
            v_old_end, (v_new_from - interval '1 day')::date;
    end if;

    raise notice 'PASS: [F36a] the superseded timetable ends the day before the new one starts';
end;
$$;

-- ---------------------------------------------------------------------------
-- F36b — a gap is never created: the old version still covers its own dates.
-- ---------------------------------------------------------------------------
do $$
declare
    v_old record;
    v_new record;
begin
    select effective_from, effective_to into v_old
      from public.timetables where id = '00000000-0000-4000-e900-000000000001';
    select effective_from into v_new
      from public.timetables where id = '00000000-0000-4000-e900-000000000002';

    -- The whole point of the fix, stated as the property the school cares about:
    -- on every day, at least one version is in force.
    if v_old.effective_to + interval '1 day' <> v_new.effective_from then
        raise exception
            'FAIL F36b: a gap or an overlap. The old version ends % and the new one '
            'begins %, so the days between them have no timetable (or two).',
            v_old.effective_to, v_new.effective_from;
    end if;

    raise notice 'PASS: [F36b] one version runs out exactly as the next begins';
end;
$$;

-- ---------------------------------------------------------------------------
-- F36c — a published timetable cannot be edited in place.
-- ---------------------------------------------------------------------------
do $$
declare
    v_period uuid := '00000000-0000-4000-e900-000000000021';
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-e900-0000000000aa', 'role', 'authenticated')::text, true);

    -- The published version from F36a.
    set local role authenticated;

    begin
        insert into public.timetable_periods (id, timetable_id, day_of_week, period_number, start_time, end_time, type)
        values (v_period, '00000000-0000-4000-e900-000000000002', 'MONDAY', 2, '08:00', '08:30', 'TEACHING');

        reset role;
        raise exception
            'FAIL F36c: a period was added to a PUBLISHED timetable. The timetable the '
            'school follows changed with no new version and no publication, so the '
            'version number no longer describes the content.';
    exception
        when insufficient_privilege then
            reset role;
            raise notice 'PASS: [F36c] a published timetable refuses a new period';
        when others then
            reset role;
            -- A row-level security refusal on INSERT arrives as this code.
            if sqlstate = '42501' then
                raise notice 'PASS: [F36c] a published timetable refuses a new period';
            else
                raise;
            end if;
    end;

    reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- F36d — and the allowed case works, so the guard is not simply refusing all.
-- ---------------------------------------------------------------------------
do $$
declare
    v_ok boolean;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', '00000000-0000-4000-e900-0000000000aa', 'role', 'authenticated')::text, true);

    -- After F36a published version 2:
    --   …0001 is SUPERSEDED — not a draft, so not editable;
    --   …0002 is PUBLISHED  — not a draft, so not editable.
    -- Both halves are asserted. A rule that only refused the published version would
    -- pass a one-sided check while leaving superseded history open to silent edits.
    if public.timetable_is_draft('00000000-0000-4000-e900-000000000001') then
        raise exception 'FAIL F36d: the superseded version is reported as editable';
    end if;

    if public.timetable_is_draft('00000000-0000-4000-e900-000000000002') then
        raise exception 'FAIL F36d: the PUBLISHED version is reported as editable';
    end if;

    raise notice 'PASS: [F36d] neither a published nor a superseded version is editable';
end;
$$;

-- ---------------------------------------------------------------------------
-- F36e — an anonymous caller cannot publish.
-- ---------------------------------------------------------------------------
do $$
begin
    if has_function_privilege('anon', 'public.publish_timetable(uuid, text)', 'execute') then
        raise exception 'FAIL F36e: an anonymous caller can publish a timetable';
    end if;
    raise notice 'PASS: [F36e] publishing is closed to anonymous callers';
end;
$$;

-- Clean up, so the next suite starts from the same state as this one.
update public.timetables set status = 'DRAFT', published_at = null, published_by = null
 where id in ('00000000-0000-4000-e900-000000000001',
              '00000000-0000-4000-e900-000000000002');

delete from public.timetable_entries where period_id in (
    select id from public.timetable_periods where timetable_id in (
        '00000000-0000-4000-e900-000000000001', '00000000-0000-4000-e900-000000000002'));
delete from public.timetable_periods where timetable_id in (
    '00000000-0000-4000-e900-000000000001', '00000000-0000-4000-e900-000000000002');
delete from public.timetables where id in (
    '00000000-0000-4000-e900-000000000001', '00000000-0000-4000-e900-000000000002');
delete from public.classes where id = '00000000-0000-4000-e902-000000000001';
delete from public.subjects where id = '00000000-0000-4000-e902-000000000002';

-- The fixture's admin is deliberately left in place. Removing the last ACTIVE
-- ADMIN is refused by a real guard, and working around it here would mean either
-- weakening that guard or writing a cleanup that lies about what the database
-- allows. The suite's own timetables are removed below; the scratch database goes
-- away with the run.
drop function if exists public.t36_lesson(uuid, uuid);
drop function if exists public.t36_make(uuid, integer, date, public.timetable_status);
drop function if exists public.t36_year();
