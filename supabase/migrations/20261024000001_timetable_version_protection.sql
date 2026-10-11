-- ---------------------------------------------------------------------------
-- AUDIT F36 — publishing a timetable, and protecting one already published
--
-- TWO DEFECTS, both about history.
--
-- 1. THE CUTOVER WAS DATED BY "NOW" RATHER THAN BY THE NEW TIMETABLE.
--
--    `publish_timetable` superseded the previous version of the year with
--    `effective_to = current_date - 1`. That is correct only when the new
--    timetable starts today. Publish next term's timetable in December — which is
--    exactly when a school prepares it — and the current timetable is marked as
--    having ended on 31 December, two weeks before the new one begins. For those
--    two weeks the school has NO timetable, and nothing reports an error: the
--    screens simply find no current version and show an empty week.
--
--    The fix dates the old version's end from the NEW version's start, and refuses
--    to shorten the old one at all when the new one starts later.
--
-- 2. A PUBLISHED TIMETABLE COULD STILL BE EDITED DIRECTLY.
--
--    The write policy on `timetable_entries` and `timetable_periods` asked only for
--    `timetable.manage`. So a published timetable's lessons could be changed in
--    place — no new version, no publication event, no trace. The version number
--    then claims a revision that the content does not match, which is the exact
--    opposite of what a version is for.
--
--    Editing is now restricted to a DRAFT. Changing what the school follows means
--    cloning into a new draft and publishing it, so there is always a version that
--    says what changed and when.
--
-- Order matters in this file: `create or replace function` resets a function's
-- privileges to the default, so every definition comes before its grants.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Is this timetable still open for editing?
-- ---------------------------------------------------------------------------
create or replace function public.timetable_is_draft(p_timetable_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select t.status = 'DRAFT' from public.timetables t where t.id = p_timetable_id),
        -- An unknown timetable id is NOT a draft. The caller is doing something
        -- the model does not describe, and refusing is the safe reading.
        false
    );
$$;

comment on function public.timetable_is_draft(uuid) is
    'Whether a timetable may still be edited. False for a published version: '
    'changing what the school follows must be a new version and a publication.';

revoke all on function public.timetable_is_draft(uuid) from public, anon;
grant execute on function public.timetable_is_draft(uuid) to authenticated;


-- A period belongs to exactly one timetable, so a lesson's editability is that of
-- its period's timetable. A small mapping function keeps the policy readable and
-- keeps the lookup in one place: `timetable_entries` has no timetable_id of its
-- own, and writing the subquery out in the policy would mean two copies of the
-- same join that a later change could update in one place only.
create or replace function public.period_id_to_timetable(p_period_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select p.timetable_id from public.timetable_periods p where p.id = p_period_id;
$$;

comment on function public.period_id_to_timetable(uuid) is
    'The timetable a period belongs to, so a lesson''s editability follows its '
    'period''s timetable.';

revoke all on function public.period_id_to_timetable(uuid) from public, anon;
grant execute on function public.period_id_to_timetable(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Publishing
-- ---------------------------------------------------------------------------
-- Rewritten rather than patched: the supersede step is the whole bug, and it is
-- three lines long. A patch on top would leave the wrong line in the file for
-- someone to find later and copy.
create or replace function public.publish_timetable(
    p_timetable_id uuid,
    p_reason       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor        uuid := auth.uid();
    v_timetable    record;
    v_previous     record;
    v_entry_count  integer;
    v_cutover      date;
begin
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    if not public.has_permission('timetable.manage') then
        raise exception 'You do not have permission to publish a timetable'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_timetable from public.timetables where id = p_timetable_id;
    if not found then
        raise exception 'Timetable % does not exist', p_timetable_id
            using errcode = 'no_data_found';
    end if;

    if v_timetable.status = 'PUBLISHED' then
        return jsonb_build_object('published', false, 'reason', 'already-published');
    end if;

    -- An empty timetable is not a timetable. Publishing one would leave the school
    -- with a current version that lists no lessons, which is worse than no version.
    select count(*) into v_entry_count
      from public.timetable_entries e
      join public.timetable_periods p on p.id = e.period_id
     where p.timetable_id = p_timetable_id;

    if v_entry_count = 0 then
        raise exception 'A timetable with no lessons cannot be published'
            using errcode = 'check_violation';
    end if;

    -- The version being replaced, if any.
    select * into v_previous
      from public.timetables t
     where t.academic_year_id = v_timetable.academic_year_id
       and t.status = 'PUBLISHED'
       and t.id <> p_timetable_id
     order by t.version desc
     limit 1;

    if found then
        -- WHERE THE OLD VERSION ENDS IS DECIDED BY WHERE THE NEW ONE BEGINS.
        --
        -- The day before the new version starts — not yesterday. When the new
        -- timetable begins in the future, the old one keeps running right up to it,
        -- which is what the school expects and what "the timetable from next term"
        -- actually means.
        v_cutover := v_timetable.effective_from - interval '1 day';

        -- A replacement that starts BEFORE the version it replaces is a data error,
        -- not a scheduling decision. Refusing loudly beats writing a negative
        -- interval and leaving a version that ended before it began.
        if v_cutover < v_previous.effective_from then
            raise exception
                'This timetable starts on % but the version it would replace only '
                'began on %. A replacement cannot start earlier than the timetable it '
                'replaces.', v_timetable.effective_from, v_previous.effective_from
                using errcode = 'check_violation';
        end if;

        update public.timetables
           set status = 'SUPERSEDED',
               -- Never leave a version with no end. If the old one already had an
               -- end (a back-dated publication), keep the EARLIER of the two: the
               -- version stopped being the school's plan at the first of them.
               effective_to = least(coalesce(effective_to, v_cutover), v_cutover),
               updated_at = now()
         where id = v_previous.id;
    end if;

    update public.timetables
       set status = 'PUBLISHED',
           published_at = now(),
           published_by = v_actor,
           updated_at = now(),
           -- A published version runs until it is replaced. Clearing the end date
           -- here is what stops a stale `effective_to` from an earlier draft being
           -- carried into the version the school follows.
           effective_to = null
     where id = p_timetable_id;

    return jsonb_build_object(
        'published', true,
        'entries',   v_entry_count,
        'reason',    p_reason,
        'superseded', v_previous.id,
        'previous_ends', case when v_previous.id is null then null else v_cutover end
    );
end;
$$;

comment on function public.publish_timetable(uuid, text) is
    'Publishes a timetable and supersedes the previous version for the same year, '
    'ending it the day before the new version starts rather than yesterday. '
    'Refuses to replace a version that started after the replacement.';

revoke all on function public.publish_timetable(uuid, text) from public, anon;
grant execute on function public.publish_timetable(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Editing is for drafts
-- ---------------------------------------------------------------------------
-- Read stays open to any active user: a teacher has to be able to see the
-- timetable. Write narrows to a draft.
drop policy if exists timetable_periods_write on public.timetable_periods;
create policy timetable_periods_write on public.timetable_periods
    for all to authenticated
    using (
        public.has_permission('timetable.manage')
        and public.timetable_is_draft(timetable_id)
    )
    with check (
        public.has_permission('timetable.manage')
        and public.timetable_is_draft(timetable_id)
    );

drop policy if exists timetable_entries_write on public.timetable_entries;
create policy timetable_entries_write on public.timetable_entries
    for all to authenticated
    using (
        public.has_permission('timetable.manage')
        and public.timetable_is_draft(period_id_to_timetable(period_id))
    )
    with check (
        public.has_permission('timetable.manage')
        and public.timetable_is_draft(period_id_to_timetable(period_id))
    );


-- ---------------------------------------------------------------------------
-- 4. Guard
-- ---------------------------------------------------------------------------
do $$
declare
    v_body  text;
    v_cnt   integer;
begin
    select p.prosrc into v_body
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'publish_timetable'
       -- Named in full, including the argument names: a lookup by name alone
       -- returns more than one row as soon as an overload exists, and this project
       -- has been bitten by that. Named arguments are what this project's older
       -- functions carry, and a DEFAULT on `p_reason` is what makes a second
       -- overload possible in the first place.
       and pg_get_function_identity_arguments(p.oid) = 'p_timetable_id uuid, p_reason text';

    if v_body is null then
        raise exception 'F36 guard: publish_timetable(uuid, text) is missing';
    end if;

    -- The defect itself: dating the cutover from today.
    if v_body like '%current_date - 1%' then
        raise exception
            'F36 guard: publish_timetable still ends the previous version at '
            'current_date - 1, which cuts the school off early whenever the new '
            'timetable starts in the future';
    end if;

    if v_body not like '%effective_from - interval%' then
        raise exception
            'F36 guard: publish_timetable does not derive the cutover from the new '
            'version''s effective_from';
    end if;

    -- The write policies must require a draft.
    select count(*) into v_cnt
      from pg_policies
     where schemaname = 'public'
       and tablename in ('timetable_periods', 'timetable_entries')
       and policyname in ('timetable_periods_write', 'timetable_entries_write')
       and (coalesce(qual, '') like '%timetable_is_draft%'
            and coalesce(with_check, '') like '%timetable_is_draft%');

    if v_cnt <> 2 then
        raise exception
            'F36 guard: expected both timetable write policies to require a DRAFT, '
            'found %', v_cnt;
    end if;

    if has_function_privilege('anon', 'public.publish_timetable(uuid, text)', 'execute') then
        raise exception 'F36 guard: anon can publish a timetable';
    end if;
end;
$$;
