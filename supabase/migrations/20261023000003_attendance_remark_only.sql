-- =============================================================================
-- SRIK — audit finding F26: a remark-only attendance change was silently dropped.
--
-- THE DEFECT. `record_class_attendance` handled a re-recorded day entirely inside
-- `if v_old_status is distinct from v_status`. The UPDATE wrote both the status and
-- the remark, so:
--
--     change the status            -> both saved
--     change ONLY the remark       -> nothing saved, success reported
--
-- The second case is not rare. It is the ordinary act of a teacher who marked a
-- child absent and was told, an hour later, that the absence was documented —
-- "sakit, ada surat doktor" — or of a clerk correcting a typo in a reason. The
-- screen said it worked. The register still showed the old value, and the next
-- person to read it had no reason to doubt it.
--
-- THE FIX. The two changes are tested independently, and the audit row names which
-- one moved. Nothing else about the procedure changes: the caller check, the
-- enrollment check and the write itself are the same as the F01-hardened version,
-- reproduced here so that the grants which follow still bind.
--
-- WHY THE DEFINITION IS REPEATED RATHER THAN PATCHED. `create or replace function`
-- resets a function's privileges to the default, so the grant at the end of this
-- file is required — and the definition must come BEFORE it. That is the same
-- ordering rule the F01 migration follows.
--
-- A NOTE ON `is distinct from` FOR THE REMARK. The obvious comparison is `<>`, and
-- it would be wrong here in the one case that matters most. `remark` is nullable,
-- and `null <> 'sakit'` is NULL, not TRUE — so clearing a remark, or setting one
-- on a record that had none, would compare as "no change" and be dropped by the
-- fix written to stop exactly that. `is distinct from` treats NULL as a value.
begin;

create or replace function public.record_class_attendance(
    p_class_id      uuid,
    p_date          date,
    p_entries       jsonb,
    p_recorded_by   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := auth.uid();
    v_enrollment uuid;
    v_student    uuid;
    v_status     public.attendance_status;
    v_remark     text;
    v_item       jsonb;
    v_written    integer := 0;
    v_corrected  integer := 0;
    v_old_status public.attendance_status;
    v_old_remark text;
    v_existing   uuid;
    v_assigned   integer;
begin
    -- 1. Must be signed in. `auth.uid()` comes from the verified JWT, so unlike
    --    the old parameter it cannot be supplied by the caller.
    if v_actor is null then
        raise exception 'Not signed in' using errcode = 'insufficient_privilege';
    end if;

    -- 2. If a caller passes `p_recorded_by` it must BE the caller. This keeps the
    --    signature compatible for the deployed frontend while removing the
    --    ability to attribute work to another user.
    if p_recorded_by is not null and p_recorded_by <> v_actor then
        raise exception 'Attendance is always recorded as the signed-in user'
            using errcode = 'insufficient_privilege';
    end if;
    p_recorded_by := v_actor;

    -- 3. Permission. Now unconditional — it no longer depends on which
    --    parameters the caller chose to supply.
    if not public.has_permission('attendance.record') then
        raise exception 'You do not have permission to record attendance'
            using errcode = 'insufficient_privilege';
    end if;

    -- 4. Record scope: the caller must actually teach this class.
    --
    --    A permission is global ("this person may record attendance"), while the
    --    right to record a PARTICULAR class is a scope question. Without this,
    --    any teacher could write the register for a class they do not teach —
    --    F08. ADMINs are exempt: the office must be able to correct any register.
    -- `has_role(array['ADMIN'])`, NOT a permission. (The dead name is avoided
    -- even in prose, so that a catalogue scan for permissions referenced by a
    -- function does not keep reporting a defect that is already fixed.)
    --
    -- The first version of this check tested the permission whose name is only
    -- mentioned here as history. That permission DOES NOT EXIST — ADMIN holds 39
    -- permissions and it is not one of them — so `has_permission` always returned
    -- false and the exemption never fired. The effect was the opposite of the intent: every ADMIN was refused,
    -- because only a teacher with a matching assignment could pass.
    --
    -- The security suite did not catch it, and the reason is worth recording: the
    -- suite proved that a TEACHER is refused, which the broken version did too.
    -- Proving a defect is fixed is not enough; the legitimate path has to be
    -- proved to still work. Every guard test written since asserts both halves.
    --
    -- `has_role` is the project's own helper for "is this the office", already
    -- used by the last-admin protection, and it checks `is_active_user()`
    -- internally so a disabled administrator is not an exemption.
    if not public.has_role(array['ADMIN']::public.app_role[]) then
        select count(*) into v_assigned
        from public.teaching_assignments ta
        where ta.class_id = p_class_id
          and ta.teacher_id = public.current_teacher_id();

        if v_assigned = 0 then
            raise exception 'You are not assigned to this class'
                using errcode = 'insufficient_privilege';
        end if;
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Attendance entries must be a list' using errcode = 'invalid_parameter_value';
    end if;

    if jsonb_array_length(p_entries) = 0 then
        raise exception 'No attendance was provided' using errcode = 'invalid_parameter_value';
    end if;

    for v_item in select * from jsonb_array_elements(p_entries) loop
        v_student := (v_item->>'student_id')::uuid;
        v_status  := (v_item->>'status')::public.attendance_status;
        v_remark  := nullif(trim(coalesce(v_item->>'remark', '')), '');

        if v_student is null then
            raise exception 'Each entry needs a student' using errcode = 'invalid_parameter_value';
        end if;

        -- The enrollment open on that date is the authority for which class the
        -- student belongs to. A student with no enrollment that day cannot be
        -- marked, and saying so is better than writing an unattached record.
        select e.id into v_enrollment
          from public.student_enrollments e
         where e.student_id = v_student
           and e.class_id = p_class_id
           and e.enrolled_at::date <= p_date
           and (e.ended_at is null or e.ended_at::date >= p_date)
         limit 1;

        if v_enrollment is null then
            raise exception
                'Student % was not enrolled in this class on %', v_student, p_date
                using errcode = 'check_violation';
        end if;

        select a.id, a.status, a.remark
          into v_existing, v_old_status, v_old_remark
          from public.student_attendance a
         where a.student_id = v_student and a.attendance_date = p_date;

        if v_existing is null then
            insert into public.student_attendance
                (student_id, enrollment_id, class_id, attendance_date, status, remark, recorded_by)
            values
                (v_student, v_enrollment, p_class_id, p_date, v_status, v_remark, p_recorded_by);
            v_written := v_written + 1;
        else
            -- THE STATUS AND THE REMARK ARE TWO SEPARATE CHANGES (audit F26).
            --
            -- This branch used to sit wholly inside `if v_old_status is distinct from
            -- v_status`. So when a teacher kept "absent" and only corrected WHY the
            -- child was away, the procedure took the else path, changed nothing, and
            -- reported success. The register then showed the old reason — or none —
            -- and a clerk who had typed "sakit, surat doktor" had no way to tell that
            -- it was never saved. A silent no-op that reports success is the worst
            -- shape a bug can take here, because the office trusts it and stops
            -- looking.
            --
            -- The two are now tested independently, and the UPDATE writes both fields
            -- whenever EITHER moved. Writing both is deliberate: the values written are
            -- the ones that were submitted, so re-writing an unchanged field is a
            -- no-op in content and keeps this single statement simple.
            --
            -- `is distinct from` is used for the remark as well, because remark is
            -- nullable and `<>` is NULL for a NULL on either side — the comparison
            -- that looks obvious here would silently fail to detect exactly the case
            -- that matters, clearing a remark to empty.
            if v_old_status is distinct from v_status
               or v_old_remark is distinct from v_remark
            then
                update public.student_attendance
                   set status = v_status,
                       remark = v_remark,
                       enrollment_id = v_enrollment,
                       recorded_by = p_recorded_by,
                       updated_at = now()
                 where id = v_existing;

                -- The audit record must say what moved. A remark-only edit with
                -- 'ABSENT -> ABSENT' would be a true-looking row that explains
                -- nothing, so the reason names the field that changed.
                insert into public.attendance_corrections
                    (table_name, record_id, student_id, attendance_date,
                     old_status, new_status, reason, corrected_by)
                values
                    ('student_attendance', v_existing, v_student, p_date,
                     v_old_status::text, v_status::text,
                     case
                         when v_old_status is distinct from v_status
                             then coalesce(v_remark, 'Re-recorded from the class register')
                         else 'Remark changed (status unchanged)'
                     end,
                     p_recorded_by);
                v_corrected := v_corrected + 1;
            end if;
        end if;
    end loop;

    return jsonb_build_object(
        'recorded',  v_written,
        'corrected', v_corrected,
        'date',      p_date,
        'class_id',  p_class_id
    );
end;
$$;

comment on function public.record_class_attendance(uuid, date, jsonb, uuid) is
    'Records a class register for one date. A change to the status and a change to '
    'the remark are handled independently; either is saved and audited. Before this '
    '(audit F26) a remark-only edit was silently discarded while the call reported '
    'success.';

-- Only a signed-in user may call this. The grant follows the definition, because
-- `create or replace` has just reset the privileges to PUBLIC.
revoke all on function public.record_class_attendance(uuid, date, jsonb, uuid) from public, anon;
grant execute on function public.record_class_attendance(uuid, date, jsonb, uuid) to authenticated;

commit;
