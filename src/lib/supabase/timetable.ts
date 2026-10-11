/**
 * Timetable data access — SRIK.
 *
 * Reference: docs/srik/05_PHASE_3_TIMETABLE_ATTENDANCE.md
 *
 * The rule that shapes this file: THE SCHOOL DAY BELONGS TO THE TIMETABLE, NOT
 * TO A CLASS. "Period 5 is 9:50 to 10:25 and it is break" is one fact about the
 * school day. If it were stored per class, the same times would be copied seven
 * times and could disagree with each other. So periods are read once for the
 * whole timetable and then laid out as rows and columns.
 *
 * Two more decisions worth knowing:
 *
 * A time that is not a lesson is still a real time. Assembly, break and Zohor
 * are period TYPES, not lessons with a placeholder subject. They occupy their
 * slot on the grid and are never counted as teaching.
 *
 * A teacher's timetable and a class's timetable are the same data seen from
 * different sides, so both screens share one grid builder here rather than
 * having two implementations that can drift apart.
 */

import { requireSupabase } from './client';
import { todayInKualaLumpur } from './attendance';

export type DayOfWeek = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY';
export type PeriodType = 'TEACHING' | 'ASSEMBLY' | 'BREAK' | 'PRAYER' | 'ACTIVITY';

/** The school week, in the order the school runs it. */
export const SCHOOL_DAYS: { key: DayOfWeek; label: string; short: string }[] = [
    { key: 'SUNDAY', label: 'Sunday', short: 'Sun' },
    { key: 'MONDAY', label: 'Monday', short: 'Mon' },
    { key: 'TUESDAY', label: 'Tuesday', short: 'Tue' },
    { key: 'WEDNESDAY', label: 'Wednesday', short: 'Wed' },
    { key: 'THURSDAY', label: 'Thursday', short: 'Thu' },
];

/** A time slot in the school day, before anyone is put in it. */
export interface PeriodRecord {
    id: string;
    dayOfWeek: DayOfWeek;
    periodNumber: number;
    startTime: string;
    endTime: string;
    type: PeriodType;
    /** "Rehat", "Zohor", "Perhimpunan" — only set for non-teaching times. */
    label: string | null;
}

/** One lesson, or one non-teaching slot, at a specific time. */
export interface EntryRecord {
    id: string;
    periodId: string;
    classId: string;
    className: string;
    subjectId: string | null;
    subjectCode: string | null;
    subjectName: string | null;
    teacherId: string | null;
    teacherName: string | null;
    room: string | null;
    activity: string | null;
}

/** A cell on the grid: what happens in one class, on one day, in one period. */
export interface GridCell {
    period: PeriodRecord;
    /** null when nobody is timetabled — which is not the same as a free period. */
    entry: EntryRecord | null;
}

export interface TimetableInfo {
    id: string;
    name: string;
    version: number;
    status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
    effectiveFrom: string;
    publishedAt: string | null;
}

/** The timetable the school is working with, preferring the newest published. */
export async function getActiveTimetable(): Promise<TimetableInfo | null> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('timetables')
        .select('id, name, version, status, effective_from, published_at')
        .limit(2000)
        .order('version', { ascending: false });

    if (error) throw new Error(`Could not load the timetable: ${error.message}`);

    const rows = (data ?? []) as unknown as {
        id: string; name: string; version: number; status: TimetableInfo['status'];
        effective_from: string; published_at: string | null;
    }[];
    if (rows.length === 0) return null;

    // A published timetable is the one the school actually follows; a draft is
    // work in progress. Showing the draft when a published timetable exists
    // would have teachers reading a plan nobody has agreed to yet.
    const chosen = rows.find(r => r.status === 'PUBLISHED') ?? rows[0];

    return {
        id: chosen.id,
        name: chosen.name,
        version: chosen.version,
        status: chosen.status,
        effectiveFrom: chosen.effective_from,
        publishedAt: chosen.published_at,
    };
}

/** Every period in a timetable, in the order the school day runs. */
export async function listPeriods(timetableId: string): Promise<PeriodRecord[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('timetable_periods')
        .select('id, day_of_week, period_number, start_time, end_time, type, label')
        .limit(2000)
        .eq('timetable_id', timetableId)
        .order('period_number');

    if (error) throw new Error(`Could not load the period times: ${error.message}`);

    return ((data ?? []) as unknown as {
        id: string; day_of_week: DayOfWeek; period_number: number;
        start_time: string; end_time: string; type: PeriodType; label: string | null;
    }[]).map(p => ({
        id: p.id,
        dayOfWeek: p.day_of_week,
        periodNumber: p.period_number,
        startTime: p.start_time.slice(0, 5),
        endTime: p.end_time.slice(0, 5),
        type: p.type,
        label: p.label,
    }));
}

const ENTRY_SELECT = `
    id, room, activity, class_id, subject_id, teacher_id,
    timetable_periods!inner(day_of_week, period_number, start_time, end_time, type, label),
    subjects(code, name),
    teachers(full_name),
    classes(display_name)
`;

type RawEntry = {
    id: string; room: string | null; activity: string | null;
    class_id: string; subject_id: string | null; teacher_id: string | null;
    timetable_periods: {
        day_of_week: DayOfWeek; period_number: number; start_time: string;
        end_time: string; type: PeriodType; label: string | null;
    };
    subjects: { code: string; name: string } | null;
    teachers: { full_name: string } | null;
    classes: { display_name: string } | null;
};

function toEntry(r: RawEntry): EntryRecord {
    return {
        id: r.id,
        periodId: '',
        classId: r.class_id,
        className: r.classes?.display_name ?? '',
        subjectId: r.subject_id,
        subjectCode: r.subjects?.code ?? null,
        subjectName: r.subjects?.name ?? null,
        teacherId: r.teacher_id,
        teacherName: r.teachers?.full_name ?? null,
        room: r.room,
        activity: r.activity,
    };
}

function keyOf(day: string, periodNumber: number): string {
    return `${day}|${periodNumber}`;
}

/**
 * Lays the timetable out as a grid: one row per period, one column per day.
 *
 * Built here once so the class view and the teacher view cannot disagree about
 * what the week looks like. Each caller just decides which entries to feed in.
 */
export function buildGrid(
    periods: PeriodRecord[],
    entries: EntryRecord[]
): { periodNumber: number; time: string; cells: GridCell[] }[] {
    const bySlot = new Map<string, EntryRecord>();
    for (const e of entries) {
        const p = periods.find(x => x.id === e.periodId);
        if (!p) continue;
        bySlot.set(keyOf(p.dayOfWeek, p.periodNumber), e);
    }

    const numbers = [...new Set(periods.map(p => p.periodNumber))].sort((a, b) => a - b);
    const first = periods[0];

    return numbers.map(n => {
        const sample = periods.find(p => p.periodNumber === n);
        return {
            periodNumber: n,
            time: sample ? `${sample.startTime} - ${sample.endTime}` : '',
            // Missing on purpose when a day has no lesson there. A blank cell
            // means "nothing timetabled", which is different from a free period.
            cells: SCHOOL_DAYS.map(day => ({
                period: periods.find(p => p.periodNumber === n && p.dayOfWeek === day.key)!,
                entry: bySlot.get(keyOf(day.key, n)) ?? null,
            })),
        };
    }).filter(row => row.cells.some(c => c.period) || first !== undefined);
}

/** One class's week. */
export async function getClassTimetable(timetableId: string, classId: string) {
    const db = requireSupabase();

    const [periods, entriesRes] = await Promise.all([
        listPeriods(timetableId),
        db.from('timetable_entries').select(ENTRY_SELECT)
            .eq('class_id', classId)
            .eq('timetable_periods.timetable_id', timetableId)
            .limit(500),
    ]);

    if (entriesRes.error) throw new Error(`Could not load the timetable: ${entriesRes.error.message}`);

    const entries = ((entriesRes.data ?? []) as unknown as RawEntry[]).map(r => {
        const e = toEntry(r);
        // The period id is not returned by the nested select, so match it back.
        const p = periods.find(x =>
            x.dayOfWeek === r.timetable_periods.day_of_week &&
            x.periodNumber === r.timetable_periods.period_number);
        e.periodId = p?.id ?? '';
        return e;
    });

    return { periods, entries, grid: buildGrid(periods, entries) };
}

/** One teacher's week, which is the same week seen from the other side. */
export async function getTeacherTimetable(timetableId: string, teacherId: string) {
    const db = requireSupabase();

    const [periods, entriesRes] = await Promise.all([
        listPeriods(timetableId),
        db.from('timetable_entries').select(ENTRY_SELECT)
            .eq('teacher_id', teacherId)
            .eq('timetable_periods.timetable_id', timetableId)
            .limit(500),
    ]);

    if (entriesRes.error) throw new Error(`Could not load the timetable: ${entriesRes.error.message}`);

    const entries = ((entriesRes.data ?? []) as unknown as RawEntry[]).map(r => {
        const e = toEntry(r);
        const p = periods.find(x =>
            x.dayOfWeek === r.timetable_periods.day_of_week &&
            x.periodNumber === r.timetable_periods.period_number);
        e.periodId = p?.id ?? '';
        return e;
    });

    return { periods, entries, grid: buildGrid(periods, entries) };
}

/** A class or a teacher the timetable can be viewed for. */
export interface TimetableSubject {
    id: string;
    label: string;
    /** Lessons per week, so the office can see an overload at a glance. */
    periodsPerWeek: number;
}

/** The classes that have a timetable. */
export async function listTimetableClasses(timetableId: string): Promise<TimetableSubject[]> {
    const db = requireSupabase();

    const { data, error } = await db
        // `timetable_periods` must appear in the select list as well as the
        // filter: PostgREST cannot filter on an embedded resource it was not
        // asked to return, and rejects the request outright.
        .from('timetable_entries')
        .select('class_id, classes!inner(display_name, year_level), timetable_periods!inner(timetable_id)')
            .limit(2000)
        .eq('timetable_periods.timetable_id', timetableId)
        .limit(2000);

    if (error) throw new Error(`Could not load classes: ${error.message}`);

    const counts = new Map<string, { label: string; yearLevel: number; n: number }>();
    for (const r of (data ?? []) as unknown as {
        class_id: string; classes: { display_name: string; year_level: number };
    }[]) {
        const cur = counts.get(r.class_id) ?? { label: r.classes.display_name, yearLevel: r.classes.year_level, n: 0 };
        cur.n += 1;
        counts.set(r.class_id, cur);
    }

    return [...counts.entries()]
        .map(([id, v]) => ({ id, label: v.label, periodsPerWeek: v.n, yearLevel: v.yearLevel }))
        .sort((a, b) => a.yearLevel - b.yearLevel || a.label.localeCompare(b.label))
        .map(({ yearLevel, ...rest }) => rest);
}

/** The teachers who appear in the timetable, with their weekly load. */
export async function listTimetableTeachers(timetableId: string): Promise<TimetableSubject[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('timetable_entries')
        .select('teacher_id, teachers!inner(full_name), timetable_periods!inner(timetable_id)')
        .limit(2000)
        .eq('timetable_periods.timetable_id', timetableId)
        .not('teacher_id', 'is', null)
        .limit(2000);

    if (error) throw new Error(`Could not load teachers: ${error.message}`);

    const counts = new Map<string, { label: string; n: number }>();
    for (const r of (data ?? []) as unknown as {
        teacher_id: string; teachers: { full_name: string };
    }[]) {
        const cur = counts.get(r.teacher_id) ?? { label: r.teachers.full_name, n: 0 };
        cur.n += 1;
        counts.set(r.teacher_id, cur);
    }

    return [...counts.entries()]
        .map(([id, v]) => ({ id, label: v.label, periodsPerWeek: v.n }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** How a period's type should be described, since it is not always a lesson. */
export function describePeriod(period: PeriodRecord): { title: string; isTeaching: boolean } {
    switch (period.type) {
        case 'ASSEMBLY':
            return { title: period.label ?? 'Assembly', isTeaching: false };
        case 'BREAK':
            return { title: period.label ?? 'Break', isTeaching: false };
        case 'PRAYER':
            return { title: period.label ?? 'Prayer', isTeaching: false };
        case 'ACTIVITY':
            return { title: period.label ?? 'Activity', isTeaching: false };
        default:
            return { title: '', isTeaching: true };
    }
}

/** A gap in the week that the office has not filled in yet. */
export interface EmptySlot {
    className: string;
    teacherName: string;
    day: DayOfWeek;
    periodNumber: number;
    time: string;
}

/**
 * Lessons that have no teacher, or no subject.
 *
 * Reported separately rather than left as blank cells: an unstaffed lesson is a
 * job for the office, and it is invisible on a grid where an empty period and an
 * unfinished one look identical.
 */
export async function findIncompleteEntries(timetableId: string) {
    const db = requireSupabase();

    // Asked for the count rather than counting rows here: a timetable easily
    // passes the 1000-row cap, and a silently truncated count would report a
    // complete timetable as incomplete.
    const [total, noTeacher, noSubject] = await Promise.all([
        db.from('timetable_entries')
            .select('id, timetable_periods!inner(timetable_id)', { count: 'exact', head: true })
            .eq('timetable_periods.timetable_id', timetableId),
        db.from('timetable_entries')
            .select('id, timetable_periods!inner(timetable_id)', { count: 'exact', head: true })
            .eq('timetable_periods.timetable_id', timetableId)
            .is('teacher_id', null),
        db.from('timetable_entries')
            .select('id, timetable_periods!inner(timetable_id)', { count: 'exact', head: true })
            .eq('timetable_periods.timetable_id', timetableId)
            .is('subject_id', null),
    ]);

    if (total.error) throw new Error(`Could not check the timetable: ${total.error.message}`);

    return {
        missingTeacher: noTeacher.count ?? 0,
        missingSubject: noSubject.count ?? 0,
        total: total.count ?? 0,
    };
}

/**
 * ---------------------------------------------------------------------------
 * Editing and publishing
 * ---------------------------------------------------------------------------
 *
 * A lesson is written straight to `timetable_entries`, which the school's own
 * RLS policies allow only for someone holding `timetable.manage`. Unlike
 * attendance, this table is meant to be edited directly: a timetable is a plan
 * that gets rearranged constantly, and funnelling every move through an RPC
 * would make it impossible to draft.
 *
 * Two rules the database enforces on its own, and which the screen must not
 * pretend it can override:
 *
 *   - A teacher cannot be in two places at once. A partial unique index refuses
 *     a second lesson for the same teacher in the same period.
 *   - Periods cannot overlap. An exclusion constraint refuses a period whose
 *     time range collides with another on the same day.
 *
 * Conflicts are therefore reported to the user in plain words, because the
 * database's own message names an index, which helps nobody.

/** A lesson to place on the grid. */
export interface EntryInput {
    periodId: string;
    classId: string;
    subjectId: string;
    teacherId: string;
}

/** Turns a database conflict into something a teacher can act on. */
function friendlyEntryError(message: string): string {
    if (/teacher_not_double_booked/i.test(message)) {
        return 'That teacher already has a lesson at this time. Choose another teacher, or move the lesson.';
    }
    if (/no_overlap/i.test(message)) {
        return 'Those two periods overlap in time.';
    }
    if (/teaching_assignments|not assigned/i.test(message)) {
        return 'That teacher is not assigned to teach this subject in this class. Set the assignment first.';
    }
    if (/duplicate key|unique/i.test(message)) {
        return 'There is already a lesson in this slot.';
    }
    return message;
}

/** What can be taught here: the subjects this class's teachers are assigned to. */
export async function listAssignableSubjects(
    academicYearId: string,
    classId: string
): Promise<{ id: string; code: string; name: string; teacherId: string; teacherName: string }[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('teaching_assignments')
        .select('subject_id, teacher_id, subjects!inner(code, name), teachers!inner(full_name)')
        .limit(2000)
        .eq('academic_year_id', academicYearId)
        .eq('class_id', classId)
        .eq('status', 'ACTIVE')
        .eq('assignment_type', 'SUBJECT_TEACHER')
        .not('subject_id', 'is', null);

    if (error) throw new Error(`Could not load subjects: ${error.message}`);

    return ((data ?? []) as unknown as {
        subject_id: string; teacher_id: string;
        subjects: { code: string; name: string };
        teachers: { full_name: string };
    }[]).map(r => ({
        id: r.subject_id,
        code: r.subjects.code,
        name: r.subjects.name,
        teacherId: r.teacher_id,
        teacherName: r.teachers.full_name,
        // Sorted by subject so the same subject groups together in the list.
    })).sort((a, b) => a.code.localeCompare(b.code) || a.teacherName.localeCompare(b.teacherName));
}

/**
 * Puts a lesson in a slot, replacing whatever was there.
 *
 * Delete-then-insert rather than upsert: a slot may currently hold a lesson
 * with a different class or subject, and upserting on period would need a
 * unique constraint the table deliberately does not have.
 */
export async function setLesson(entry: EntryInput): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const { error: clearError } = await db
        .from('timetable_entries')
        .delete()
        .eq('period_id', entry.periodId)
        .eq('class_id', entry.classId);

    if (clearError) return { success: false, error: friendlyEntryError(clearError.message) };

    const { error } = await db.from('timetable_entries').insert({
        period_id: entry.periodId,
        class_id: entry.classId,
        subject_id: entry.subjectId,
        teacher_id: entry.teacherId,
    });

    if (error) return { success: false, error: friendlyEntryError(error.message) };
    return { success: true };
}

/** Empties a slot, for a lesson that should not be there. */
export async function clearLesson(periodId: string, classId: string): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const { error } = await db
        .from('timetable_entries')
        .delete()
        .eq('period_id', periodId)
        .eq('class_id', classId);

    if (error) return { success: false, error: friendlyEntryError(error.message) };
    return { success: true };
}

/** The classes a lesson can be moved to, for the move menu. */
export async function listOtherClasses(
    timetableId: string,
    excludeClassId: string
): Promise<{ id: string; label: string }[]> {
    const all = await listTimetableClasses(timetableId);
    return all.filter(c => c.id !== excludeClassId).map(c => ({ id: c.id, label: c.label }));
}

/**
 * Publishes a timetable, making it the one the school follows.
 *
 * Goes through the RPC rather than updating the status column, because
 * publishing also has to supersede the previous published timetable for the
 * same year. Doing that by hand would leave two timetables marked current.
 */
export async function publishTimetable(
    timetableId: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const { error } = await db.rpc('publish_timetable', {
        p_timetable_id: timetableId,
        p_reason: reason ?? null,
    });

    if (error) {
        if (/no lessons/i.test(error.message)) {
            return { success: false, error: 'This timetable has no lessons yet, so there is nothing to publish.' };
        }
        if (/permission/i.test(error.message)) {
            return { success: false, error: 'You do not have permission to publish a timetable.' };
        }
        return { success: false, error: error.message };
    }
    return { success: true };
}

/**
 * Adds a period to the school day.
 *
 * Only for filling a gap the office has agreed on. Overlapping an existing
 * period is refused by the database, and that is the point: two periods at the
 * same time would make the timetable impossible to follow.
 */
export async function addPeriod(input: {
    timetableId: string;
    dayOfWeek: DayOfWeek;
    periodNumber: number;
    startTime: string;
    endTime: string;
    type: PeriodType;
    label?: string | null;
}): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const { error } = await db.from('timetable_periods').insert({
        timetable_id: input.timetableId,
        day_of_week: input.dayOfWeek,
        period_number: input.periodNumber,
        start_time: input.startTime,
        end_time: input.endTime,
        type: input.type,
        label: input.label ?? null,
    });

    if (error) return { success: false, error: friendlyEntryError(error.message) };
    return { success: true };
}

/** Renames a period, e.g. to correct a label. */
export async function updatePeriod(
    periodId: string,
    changes: { startTime?: string; endTime?: string; type?: PeriodType; label?: string | null }
): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    const patch: Record<string, unknown> = {};
    if (changes.startTime !== undefined) patch.start_time = changes.startTime;
    if (changes.endTime !== undefined) patch.end_time = changes.endTime;
    if (changes.type !== undefined) patch.type = changes.type;
    if (changes.label !== undefined) patch.label = changes.label;

    if (Object.keys(patch).length === 0) return { success: true };

    const { error } = await db.from('timetable_periods').update(patch).eq('id', periodId);

    if (error) return { success: false, error: friendlyEntryError(error.message) };
    return { success: true };
}

/**
 * A teacher's existing lesson at a given time, if any.
 *
 * Used to warn before a move is attempted rather than after the database has
 * refused it — the school should not have to reject a change to learn it is a
 * clash.
 */
export async function findTeacherClash(
    timetableId: string,
    teacherId: string,
    periodId: string,
    excludeClassId: string
): Promise<{ className: string; subjectCode: string | null } | null> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('timetable_entries')
        .select('class_id, classes!inner(display_name), subjects(code), timetable_periods!inner(timetable_id)')
        .limit(2000)
        .eq('teacher_id', teacherId)
        .eq('period_id', periodId)
        .eq('timetable_periods.timetable_id', timetableId)
        .neq('class_id', excludeClassId)
        .limit(1);

    if (error) throw new Error(`Could not check for a clash: ${error.message}`);

    const rows = (data ?? []) as unknown as {
        classes: { display_name: string }; subjects: { code: string } | null;
    }[];
    if (rows.length === 0) return null;

    return {
        className: rows[0].classes.display_name,
        subjectCode: rows[0].subjects?.code ?? null,
    };
}

/**
 * The class a STUDENT or GUARDIAN should see the timetable for.
 *
 * A student's class is not a column on their record; it is the class on their
 * open enrollment. That is deliberate, because a student changes class each year
 * while their history must remain readable — so the "current" class is whichever
 * enrollment has no end date.
 *
 * NO STUDENT ID IS ACCEPTED. The database decides which child belongs to the
 * caller, exactly as `listMyChildrenFees` does: a parameter would be a name a
 * caller could change, and this is the value that must not be changeable. A
 * guardian with two children in different classes gets the first, and the screen
 * lets them choose; a guardian asking about someone else's child gets nothing,
 * because the policy on `students` permits nothing else.
 *
 * Returns null when the caller has no class yet — a new student, or an office
 * user who is neither a student nor a guardian.
 */
export async function getMyClassId(): Promise<string | null> {
    const supabase = requireSupabase();

    // The child's class TODAY, by the interval.
    //
    // `ended_at is null` alone would return a promoted child's NEXT year's class
    // during this year, so a student opening their timetable would see a class they
    // are not in yet.
    const { data, error } = await supabase
        .from('student_enrollments')
        .select('class_id, students!inner(status)')
        .eq('students.status', 'ACTIVE')
        .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
        .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`)
        .order('enrolled_at', { ascending: false })
        .limit(1);

    if (error) throw new Error(`Could not find your class: ${error.message}`);

    const rows = (data ?? []) as unknown as { class_id: string | null }[];
    return rows.length > 0 ? rows[0].class_id : null;
}

/**
 * The teacher row belonging to the signed-in user.
 *
 * `teachers.user_id` is the link to the login. The database returns only the
 * caller's own row, because the `teachers` policy requires `teachers.view`,
 * which a teacher does not hold for other people's records.
 */
export async function getMyTeacherId(): Promise<string | null> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
        .from('user_roles')
        .select('role_code')
        .limit(2000)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
        .limit(1);

    if (error) throw new Error(`Could not read your role: ${error.message}`);

    // Only a teacher has a teacher row to find; asking as anyone else would be a
    // wasted round trip and a confusing empty result.
    const isTeacher = (data ?? []).some(r => (r as { role_code: string }).role_code === 'TEACHER');
    if (!isTeacher) return null;

    const { data: rows, error: teacherError } = await supabase
        .from('teachers')
        .select('id')
        .limit(2000)
        .limit(1);

    if (teacherError) throw new Error(`Could not find your teacher record: ${teacherError.message}`);

    const found = (rows ?? []) as { id: string }[];
    return found.length > 0 ? found[0].id : null;
}
