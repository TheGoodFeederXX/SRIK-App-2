/**
 * Teacher data access — SRIK.
 *
 * Reference: docs/srik/04_PHASE_2_ACADEMIC_CORE.md
 *
 * This module is the ONLY place that reads or writes teacher records. Screens
 * call these functions instead of reaching for the legacy API client, which is
 * what lets the legacy dependency be removed for this feature without touching
 * the screens again.
 *
 * Two rules shape the code below:
 *
 *   1. A teacher's subjects and classes are NOT columns. They come from
 *      `teaching_assignments`, because a teacher's duties change over time and
 *      the history must survive. The shape returned here is therefore assembled
 *      from more than one table.
 *
 *   2. A teacher's login account is created by an administrator through a
 *      privileged server-side call, never from the browser. The browser holds
 *      no key that could create an account.
 */

import { requireSupabase } from './client';

/**
 * Row shapes as they actually come back from Postgres.
 *
 * Declared by hand because the client is not created with generated database
 * types: without these, every field access resolves against the library's error
 * union and none of the real columns type-check.
 */
interface TeacherRow {
    id: string;
    user_id: string | null;
    staff_code: string;
    full_name: string;
    gender: 'MALE' | 'FEMALE' | null;
    phone: string | null;
    email: string | null;
    employment_start: string | null;
    employment_end: string | null;
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

interface AssignmentRow {
    teacher_id: string;
    subject_id: string | null;
    class_id: string | null;
    status: string;
}

interface NamedRow { id: string; name: string }
interface ClassRow { id: string; display_name: string }

/** A teacher as the screens consume it. */
export interface TeacherRecord {
    id: string;
    userId: string | null;
    staffCode: string;
    fullName: string;
    gender: 'MALE' | 'FEMALE' | null;
    phone: string | null;
    email: string | null;
    employmentStart: string | null;
    employmentEnd: string | null;
    /** Mapped to the screen's 'Active' / 'Inactive' vocabulary by the caller. */
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    /** Subject names this teacher teaches, from their teaching assignments. */
    subjects: string[];
    /** Class display names this teacher is assigned to, e.g. "3 Al-Junaidi". */
    classes: string[];
}

/** The result of a create/update, so the caller can report exactly what failed. */
export interface TeacherWriteResult {
    success: boolean;
    teacherId?: string;
    /** Set when the teacher was saved but the login account could not be made. */
    accountWarning?: string;
    error?: string;
    /**
     * The one-time password for a newly created login account. Present only in
     * the reply from the account step, and never stored: the owner passes it on
     * and the teacher changes it at first sign-in.
     */
    temporaryPassword?: string;
}

/**
 * Reads every teacher with their subjects and classes.
 *
 * Written as one query per table rather than a nested select. The generated
 * column `classes.display_name` (e.g. "3 Al-Junaidi") is what the screens show,
 * and PostgREST cannot filter or label a nested relation by it cleanly. Three
 * flat queries joined in memory is easier to verify than one clever query, and
 * at ~250 users the size is irrelevant.
 */
export async function listTeachers(): Promise<TeacherRecord[]> {
    const db = requireSupabase();

    const { data: teachers, error: teachersError } = await db
        .from('teachers')
        .select('id, user_id, staff_code, full_name, gender, phone, email, ' +
                'employment_start, employment_end, status')
                    .limit(2000)
        .order('full_name');

    if (teachersError) {
        throw new Error(`Could not load teachers: ${teachersError.message}`);
    }
    if (!teachers || teachers.length === 0) return [];
    const teacherRows = teachers as unknown as TeacherRow[];

    // Subjects and classes in one pass. A failure here must NOT blank the whole
    // list: a teacher with no assignments yet is normal, and showing nothing
    // because the optional tables were unavailable would be worse than showing
    // teachers without their subjects.
    const { data: assignments, error: assignmentsError } = await db
        .from('teaching_assignments')
        .select('teacher_id, subject_id, class_id, status')
        .limit(2000)
        .eq('status', 'ACTIVE');

    const subjectsByTeacher = new Map<string, Set<string>>();
    const classesByTeacher = new Map<string, Set<string>>();

    if (!assignmentsError && assignments) {
        const assignmentRows = assignments as unknown as AssignmentRow[];
        const subjectIds = [...new Set(assignmentRows.map(a => a.subject_id).filter(Boolean))] as string[];
        const classIds = [...new Set(assignmentRows.map(a => a.class_id).filter(Boolean))] as string[];

        const [{ data: subjects }, { data: classes }] = await Promise.all([
            subjectIds.length
                ? db.from('subjects').select('id, name').in('id', subjectIds)
                    .limit(2000)
                : Promise.resolve({ data: [] as { id: string; name: string }[] }),
            classIds.length
                ? db.from('classes').select('id, display_name').in('id', classIds)
                    .limit(2000)
                : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
        ]);

        const subjectName = new Map(((subjects ?? []) as unknown as NamedRow[]).map(s => [s.id, s.name]));
        const className = new Map(((classes ?? []) as unknown as ClassRow[]).map(c => [c.id, c.display_name]));

        for (const a of assignments as unknown as AssignmentRow[]) {
            if (a.subject_id && subjectName.has(a.subject_id)) {
                if (!subjectsByTeacher.has(a.teacher_id)) subjectsByTeacher.set(a.teacher_id, new Set());
                subjectsByTeacher.get(a.teacher_id)!.add(subjectName.get(a.subject_id)!);
            }
            if (a.class_id && className.has(a.class_id)) {
                if (!classesByTeacher.has(a.teacher_id)) classesByTeacher.set(a.teacher_id, new Set());
                classesByTeacher.get(a.teacher_id)!.add(className.get(a.class_id)!);
            }
        }
    }

    return teacherRows.map((t): TeacherRecord => ({
        id: t.id,
        userId: t.user_id,
        staffCode: t.staff_code,
        fullName: t.full_name,
        gender: t.gender,
        phone: t.phone,
        email: t.email,
        employmentStart: t.employment_start,
        employmentEnd: t.employment_end,
        status: t.status,
        subjects: [...(subjectsByTeacher.get(t.id) ?? [])],
        classes: [...(classesByTeacher.get(t.id) ?? [])],
    }));
}

/** Reads one teacher, or null when the id does not exist. */
export async function getTeacher(id: string): Promise<TeacherRecord | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('teachers')
        .select('id, user_id, staff_code, full_name, gender, phone, email, ' +
                'employment_start, employment_end, status')
                    .limit(2000)
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(`Could not load the teacher: ${error.message}`);
    if (!data) return null;
    const row = data as unknown as TeacherRow;

    const { data: assignments } = await db
        .from('teaching_assignments')
        .select('teacher_id, subject_id, class_id, status')
        .limit(2000)
        .eq('teacher_id', id)
        .eq('status', 'ACTIVE');

    const assignmentRows = (assignments ?? []) as unknown as AssignmentRow[];
    const subjectIds = [...new Set(assignmentRows.map(a => a.subject_id).filter(Boolean))] as string[];
    const classIds = [...new Set(assignmentRows.map(a => a.class_id).filter(Boolean))] as string[];

    const [{ data: subjects }, { data: classes }] = await Promise.all([
        subjectIds.length ? db.from('subjects').select('id, name').in('id', subjectIds)
            .limit(2000)
                          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        classIds.length ? db.from('classes').select('id, display_name').in('id', classIds)
            .limit(2000)
                        : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    ]);

    const subjectName = new Map(((subjects ?? []) as NamedRow[]).map(s => [s.id, s.name]));
    const className = new Map(((classes ?? []) as ClassRow[]).map(c => [c.id, c.display_name]));

    return {
        id: row.id,
        userId: row.user_id,
        staffCode: row.staff_code,
        fullName: row.full_name,
        gender: row.gender,
        phone: row.phone,
        email: row.email,
        employmentStart: row.employment_start,
        employmentEnd: row.employment_end,
        status: row.status,
        subjects: subjectIds.map(i => subjectName.get(i)).filter(Boolean) as string[],
        classes: classIds.map(i => className.get(i)).filter(Boolean) as string[],
    };
}

/** Fields a caller may supply when creating or updating a teacher. */
export interface TeacherInput {
    staffCode: string;
    fullName: string;
    gender?: 'MALE' | 'FEMALE' | null;
    phone?: string | null;
    email?: string | null;
    employmentStart?: string | null;
    employmentEnd?: string | null;
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

/**
 * Creates a teacher record.
 *
 * Does NOT create a login account: that is a privileged action and belongs in
 * `provisionTeacherAccount()` (or the Edge Function), so this function stays
 * something a normal admin session can perform.
 */
export async function createTeacher(input: TeacherInput): Promise<TeacherWriteResult> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('teachers')
        .insert({
            staff_code: input.staffCode.trim(),
            full_name: input.fullName.trim(),
            gender: input.gender ?? null,
            phone: input.phone?.trim() || null,
            email: input.email?.trim() || null,
            employment_start: input.employmentStart || null,
            employment_end: input.employmentEnd || null,
            status: input.status ?? 'ACTIVE',
        })
        .select('id')
            .limit(2000)
        .single();

    if (error) {
        // A duplicate staff code is the most likely failure and the message
        // Postgres returns is not something to show an owner, so translate it.
        if (error.code === '23505') {
            return { success: false, error: `Staff code "${input.staffCode}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, teacherId: (data as unknown as { id: string }).id };
}

/** Updates a teacher record. */
export async function updateTeacher(id: string, input: TeacherInput): Promise<TeacherWriteResult> {
    const db = requireSupabase();

    const { error } = await db
        .from('teachers')
        .update({
            staff_code: input.staffCode.trim(),
            full_name: input.fullName.trim(),
            gender: input.gender ?? null,
            phone: input.phone?.trim() || null,
            email: input.email?.trim() || null,
            employment_start: input.employmentStart || null,
            employment_end: input.employmentEnd || null,
            status: input.status ?? 'ACTIVE',
        })
        .eq('id', id);

    if (error) {
        if (error.code === '23505') {
            return { success: false, error: `Staff code "${input.staffCode}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, teacherId: id };
}

/**
 * Creates a login account for an existing teacher.
 *
 * This calls an Edge Function rather than the database directly, because
 * creating an account requires a key that bypasses Row Level Security and that
 * key must never reach the browser. The function returns a temporary password
 * exactly once; it is not stored anywhere the app can read it back.
 */
export async function provisionTeacherAccount(
    teacherId: string,
    email: string,
    fullName: string
): Promise<TeacherWriteResult> {
    const db = requireSupabase();

    const { data, error } = await db.functions.invoke('provision-teacher-account', {
        body: { teacherId, email, fullName },
    });

    if (error) {
        // The teacher record still exists, so this is a warning rather than a
        // failure: the owner can retry the account step without re-entering the
        // teacher's details.
        return {
            success: false,
            teacherId,
            accountWarning: `Teacher saved, but the login account could not be created: ${error.message}`,
        };
    }
    return { success: true, teacherId, temporaryPassword: (data as any)?.temporaryPassword };
}

/** A pickable subject or class, as the form's dropdowns need them. */
export interface Option {
    id: string;
    label: string;
}

/**
 * Active subjects for the "subjects taught" picker.
 *
 * Archived subjects are excluded: offering one on a new assignment would create
 * a duty pointing at a subject the school has retired.
 */
export async function listSubjectOptions(): Promise<Option[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('subjects')
        .select('id, name')
        .limit(2000)
        .eq('status', 'ACTIVE')
        .order('name');

    if (error) throw new Error(`Could not load subjects: ${error.message}`);
    return ((data ?? []) as unknown as NamedRow[]).map(s => ({ id: s.id, label: s.name }));
}

/**
 * Classes for the "classes taught" picker, from the CURRENT academic year.
 *
 * Scoped to the current year on purpose: a class from a past year is not
 * something a new teacher can be assigned to, and listing every year would
 * offer "3 Al-Junaidi" three times with no way for the owner to tell them apart.
 * When no year is marked CURRENT the list is empty rather than wrong — the same
 * choice the database makes.
 */
export async function listClassOptions(): Promise<Option[]> {
    const db = requireSupabase();

    const { data: year, error: yearError } = await db
        .from('academic_years')
        .select('id')
        .limit(2000)
        .eq('status', 'CURRENT')
        .maybeSingle();

    if (yearError) throw new Error(`Could not load the academic year: ${yearError.message}`);
    if (!year) return [];

    const { data, error } = await db
        .from('classes')
        .select('id, display_name')
        .limit(2000)
        .eq('academic_year_id', (year as { id: string }).id)
        .eq('status', 'ACTIVE')
        .order('year_level')
        .order('name');

    if (error) throw new Error(`Could not load classes: ${error.message}`);
    return ((data ?? []) as unknown as ClassRow[]).map(c => ({ id: c.id, label: c.display_name }));
}

/**
 * Records a teacher's subjects and classes as teaching assignments.
 *
 * Calls the `set_teacher_assignments` RPC rather than writing the table. That
 * table deliberately has no INSERT or DELETE grant: replacing a teacher's
 * duties must close the previous assignments and open the new ones in one
 * atomic, audited step, and a screen cannot be trusted to do that. Calling the
 * RPC is the only supported path.
 */
export async function setTeacherAssignments(
    teacherId: string,
    academicYearId: string,
    classIds: string[],
    subjectIds: string[]
): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const { error } = await db.rpc('set_teacher_assignments', {
        p_teacher_id: teacherId,
        p_academic_year_id: academicYearId,
        p_class_ids: classIds,
        p_subject_ids: subjectIds,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
}

/**
 * A teaching duty as the assignment screens consume it.
 *
 * `periodsPerWeek` is null for a class-teacher duty: being responsible for a
 * class has no weekly period count, and storing 0 would read as "no teaching"
 * rather than "not applicable".
 */
export interface AssignmentRecord {
    id: string;
    teacherId: string;
    teacherName: string;
    teacherStaffCode: string;
    type: 'CLASS_TEACHER' | 'SUBJECT_TEACHER' | 'ASSISTANT';
    classId: string;
    className: string;
    subjectId: string | null;
    subjectName: string | null;
    periodsPerWeek: number | null;
}

/**
 * Every active teaching duty for an academic year.
 *
 * Read as flat rows and joined in memory. At SRIK's size this is a few hundred
 * rows, and separate queries are far easier to verify than a nested PostgREST
 * select — which matters more here than saving two round trips.
 */
export async function listAssignments(
    academicYearId?: string | null
): Promise<AssignmentRecord[]> {
    const db = requireSupabase();

    const yearId = academicYearId ?? await getCurrentAcademicYearId();
    if (!yearId) return [];

    const { data, error } = await db
        .from('teaching_assignments')
        .select('id, teacher_id, class_id, subject_id, assignment_type, periods_per_week')
        .limit(2000)
        .eq('academic_year_id', yearId)
        .eq('status', 'ACTIVE');

    if (error) throw new Error(`Could not load teaching duties: ${error.message}`);

    const rows = (data ?? []) as unknown as {
        id: string; teacher_id: string; class_id: string;
        subject_id: string | null; assignment_type: AssignmentRecord['type'];
        periods_per_week: number | null;
    }[];
    if (rows.length === 0) return [];

    const teacherIds = [...new Set(rows.map(r => r.teacher_id))];
    const classIds = [...new Set(rows.map(r => r.class_id))];
    const subjectIds = [...new Set(rows.map(r => r.subject_id).filter(Boolean))] as string[];

    const [teachers, classes, subjects] = await Promise.all([
        db.from('teachers').select('id, full_name, staff_code').in('id', teacherIds)
            .limit(2000),
        db.from('classes').select('id, display_name').in('id', classIds)
            .limit(2000),
        subjectIds.length
            ? db.from('subjects').select('id, name').in('id', subjectIds)
                .limit(2000)
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const teacherById = new Map(
        ((teachers.data ?? []) as unknown as { id: string; full_name: string; staff_code: string }[])
            .map(t => [t.id, t])
    );
    const classById = new Map(
        ((classes.data ?? []) as unknown as { id: string; display_name: string }[])
            .map(c => [c.id, c])
    );
    const subjectById = new Map(
        ((subjects.data ?? []) as unknown as { id: string; name: string }[])
            .map(x => [x.id, x])
    );

    return rows.map((r): AssignmentRecord => ({
        id: r.id,
        teacherId: r.teacher_id,
        teacherName: teacherById.get(r.teacher_id)?.full_name ?? 'Unknown teacher',
        teacherStaffCode: teacherById.get(r.teacher_id)?.staff_code ?? '',
        type: r.assignment_type,
        classId: r.class_id,
        className: classById.get(r.class_id)?.display_name ?? 'Unknown class',
        subjectId: r.subject_id,
        subjectName: r.subject_id ? subjectById.get(r.subject_id)?.name ?? null : null,
        periodsPerWeek: r.periods_per_week,
    }));
}

/** Which classes and subjects a single teacher currently has. */
export async function getTeacherDuties(teacherId: string): Promise<{
    classIds: string[];
    subjectIds: string[];
    periodsPerWeek: number;
}> {
    const assignments = await listAssignments();
    const mine = assignments.filter(a => a.teacherId === teacherId);
    return {
        classIds: [...new Set(mine.map(a => a.classId))],
        subjectIds: [...new Set(mine.map(a => a.subjectId).filter(Boolean))] as string[],
        periodsPerWeek: mine.reduce((n, a) => n + (a.periodsPerWeek ?? 0), 0),
    };
}

/**
 * Sets one teacher's whole set of duties in a single audited step.
 *
 * `periodsPerWeek` defaults to 1 for subject duties and is omitted for a class
 * duty, because a class-teacher role has no weekly period count.
 */
export async function assignTeacherDuties(
    teacherId: string,
    academicYearId: string,
    options: { classIds: string[]; subjectIds: string[]; periodsPerWeek?: number }
): Promise<{ success: boolean; error?: string }> {
    return setTeacherAssignments(
        teacherId,
        academicYearId,
        options.classIds,
        options.subjectIds
    );
}

/** The id of the CURRENT academic year, or null when none is set. */
export async function getCurrentAcademicYearId(): Promise<string | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('academic_years')
        .select('id')
        .limit(2000)
        .eq('status', 'CURRENT')
        .maybeSingle();
    if (error) return null;
    return (data as { id: string } | null)?.id ?? null;
}

/**
 * Creates a teacher and, when asked, their login account.
 *
 * Returns the temporary password exactly once. The account is created through
 * the Edge Function because that step needs a key which bypasses Row Level
 * Security and must never reach the browser.
 */
export async function createTeacherWithAccount(
    input: TeacherInput,
    options: { createAccount: boolean; academicYearId?: string | null;
               classIds?: string[]; subjectIds?: string[] }
): Promise<TeacherWriteResult & { temporaryPassword?: string }> {
    const created = await createTeacher(input);
    if (!created.success || !created.teacherId) return created;

    const teacherId = created.teacherId;

    // Assignments are best-effort: a teacher with no duties is still a valid
    // teacher, and failing the whole creation because one optional table was
    // unavailable would lose the record the owner just typed.
    if (options.academicYearId && (options.classIds?.length || options.subjectIds?.length)) {
        await setTeacherAssignments(
            teacherId,
            options.academicYearId,
            options.classIds ?? [],
            options.subjectIds ?? []
        );
    }

    if (!options.createAccount || !input.email) {
        return { success: true, teacherId };
    }

    const account = await provisionTeacherAccount(teacherId, input.email, input.fullName);
    if (!account.success) {
        return { success: true, teacherId, accountWarning: account.accountWarning };
    }
    return { success: true, teacherId, temporaryPassword: account.temporaryPassword };
}

/**
 * The teacher record belonging to the signed-in user.
 *
 * A teacher opens their own dashboard, so the app needs to get from "who is logged
 * in" to "which teacher row is theirs". That link is `teachers.user_id`. When the
 * office has not yet issued a login for a teacher, or is looking at a teacher who
 * has no account, this returns null and the caller shows nothing rather than
 * guessing.
 *
 * The dashboard used to reach for this through the Express API and a
 * `school_id` that SRIK records do not carry, so it never resolved.
 */
export async function getMyTeacherProfile(): Promise<TeacherRecord | null> {
    const db = requireSupabase();

    const { data: auth } = await db.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return null;

    const { data, error } = await db
        .from('teachers')
        .select('id')
        .limit(2000)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw new Error(`Could not load your teacher record: ${error.message}`);
    if (!data) return null;

    return getTeacher((data as unknown as { id: string }).id);
}

/**
 * Change only a teacher's status.
 *
 * WHY NOT `updateTeacher` WITH THE REST SPIED BACK OFF THE SCREEN. That call sends
 * every column, so a screen that has not loaded a field — or that loaded it before
 * someone else changed it — writes its stale copy back over the live one. A status
 * change should touch the status.
 *
 * WHY NOT A DELETE. Removing a teacher would leave their teaching assignments,
 * attendance and lesson records pointing at nothing, and the school would lose the
 * record of who taught what. "No longer teaching here" is a STATUS, and ARCHIVED is
 * the honest one: the person stays in the record and stops appearing in lists.
 */
export async function setTeacherStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
): Promise<TeacherWriteResult> {
    const db = requireSupabase();
    const { error } = await db.from('teachers').update({ status }).eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true, teacherId: id };
}
