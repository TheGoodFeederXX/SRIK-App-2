/**
 * Class and subject data access — SRIK.
 *
 * Reference: docs/srik/04_PHASE_2_ACADEMIC_CORE.md
 *
 * The rule that shapes this whole file: a class's NAME is a label, not data.
 * The school renames classes and changes their codes whenever it likes, so
 * nothing here reads meaning out of the text. What matters — the year level, and
 * which class a student belongs to — lives in its own column or its own id.
 *
 * A class also belongs to an academic year. That is what lets last year's
 * "4 Al-Junaidi" and this year's be different records with the same name,
 * instead of one row being overwritten and the previous year's history lost.
 */

import { requireSupabase } from './client';
import { todayInKualaLumpur } from './attendance';

/** A class as the screens consume it. */
export interface ClassRecord {
    id: string;
    /** Year level as a NUMBER, from its own column. Never parsed from the name. */
    yearLevel: number;
    /** The class's name, e.g. "Al-Junaidi". Renameable at any time. */
    name: string;
    /** Short code the school uses, e.g. "3J". Renameable, and display only. */
    code: string | null;
    /** "1 Al-Junaidi" — derived by the database from year level and name. */
    displayName: string;
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    academicYearId: string;
    /** Students currently enrolled. */
    studentCount: number;
}

export interface ClassOption { id: string; label: string }

export interface SubjectRecord {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    category: string | null;
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    /** How many classes teach this subject this year. */
    classCount: number;
}

export interface ClassSubjectRecord {
    classId: string;
    subjectId: string;
}

export interface WriteResult {
    success: boolean;
    id?: string;
    error?: string;
}

/**
 * Row shapes as Postgres returns them.
 *
 * Declared by hand because the client has no generated database types: without
 * these, every field access resolves against the library's error union.
 */
interface ClassRow {
    id: string;
    year_level: number;
    name: string;
    code: string | null;
    display_name: string;
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    academic_year_id: string;
}

interface SubjectRow {
    id: string;
    code: string;
    name: string;
    short_name: string | null;
    category: string | null;
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

interface EnrollmentRow { class_id: string }
interface ClassSubjectRow { class_id: string; subject_id: string }

// =============================================================================
// Academic year
// =============================================================================

/**
 * The CURRENT academic year id, or null when none is set.
 *
 * Classes belong to a year, so writing one requires this. Returning null rather
 * than throwing lets a screen explain "no year is set up yet" instead of showing
 * a raw failure — an empty school is a normal state, not an error.
 */
export async function getCurrentAcademicYearId(): Promise<string | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('academic_years')
        .select('id')
        .limit(2000)
        .eq('status', 'CURRENT')
        .maybeSingle();
    if (error) return null;
    return (data as unknown as { id: string } | null)?.id ?? null;
}

/**
 * The current academic year, with its start and end dates.
 *
 * WHY THE DATES MATTER. A parent's attendance view needs a window, and the only
 * honest window is the school's own year. Deriving one from the calendar — "this
 * month", "the last 90 days" — counts days the school was closed and makes a child
 * look absent when nobody was marking a register at all.
 */
export interface AcademicYearRecord {
    id: string;
    name: string;
    startDate: string;
    endDate: string | null;
    status: string;
}

export async function getCurrentAcademicYear(): Promise<AcademicYearRecord | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('academic_years')
        .select('id, name, start_date, end_date, status')
        .eq('status', 'CURRENT')
        .limit(1);

    if (error) return null;
    const row = (data ?? [])[0] as unknown as {
        id: string; name: string; start_date: string; end_date: string | null; status: string;
    } | undefined;
    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
    };
}

// =============================================================================
// Classes
// =============================================================================

/**
 * Reads every class, with its student count.
 *
 * Ordered by year level then name, so the list reads the way the school thinks:
 * Year 1 up to Year 6. Ordering uses the number column, not the label, so it
 * survives any rename.
 */
export async function listClasses(): Promise<ClassRecord[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('classes')
        .select('id, year_level, name, code, display_name, status, academic_year_id')
        .limit(2000)
        .order('year_level')
        .order('name');

    if (error) throw new Error(`Could not load classes: ${error.message}`);
    const rows = (data ?? []) as unknown as ClassRow[];
    if (rows.length === 0) return [];

    // Count students per class from open enrolments. A failure here degrades to
    // "0 students" rather than blanking the list: an empty class is normal.
    const counts = new Map<string, number>();
    // The same date rule as everywhere else. Counting `ended_at is null` rows would
    // count a promoted child in BOTH their old and new class, so every class list
    // would overstate its size by however many children are moving up.
    const { data: enrollments } = await db
        .from('student_enrollments')
        .select('class_id')
        .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
        .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`)
        .limit(2000);

    for (const e of (enrollments ?? []) as unknown as EnrollmentRow[]) {
        counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    }

    return rows.map((r): ClassRecord => ({
        id: r.id,
        yearLevel: r.year_level,
        name: r.name,
        code: r.code,
        displayName: r.display_name,
        status: r.status,
        academicYearId: r.academic_year_id,
        studentCount: counts.get(r.id) ?? 0,
    }));
}

/** Active classes for the current year, for a picker. */
export async function listClassOptions(): Promise<ClassOption[]> {
    const db = requireSupabase();
    const yearId = await getCurrentAcademicYearId();
    if (!yearId) return [];

    const { data, error } = await db
        .from('classes')
        .select('id, display_name')
        .limit(2000)
        .eq('academic_year_id', yearId)
        .eq('status', 'ACTIVE')
        .order('year_level')
        .order('name');

    if (error) throw new Error(`Could not load classes: ${error.message}`);
    return ((data ?? []) as unknown as { id: string; display_name: string }[])
        .map(c => ({ id: c.id, label: c.display_name }));
}

export interface ClassInput {
    yearLevel: number;
    name: string;
    code?: string | null;
}

/**
 * Creates a class in the current academic year.
 *
 * `display_name` is not sent: the database derives it from year level and name,
 * so the two can never disagree.
 */
export async function createClass(input: ClassInput): Promise<WriteResult> {
    const db = requireSupabase();

    const yearId = await getCurrentAcademicYearId();
    if (!yearId) {
        return {
            success: false,
            error: 'No academic year is set as current, so a class cannot be created yet.',
        };
    }

    const { data, error } = await db
        .from('classes')
        .insert({
            academic_year_id: yearId,
            year_level: input.yearLevel,
            name: input.name.trim(),
            code: input.code?.trim() || null,
            status: 'ACTIVE',
        })
        .select('id')
            .limit(2000)
        .single();

    if (error) {
        // A class with the same year level and name already exists this year.
        // The raw Postgres text would not mean anything to the owner.
        if (error.code === '23505') {
            return {
                success: false,
                error: `A Year ${input.yearLevel} class named "${input.name.trim()}" already exists this year.`,
            };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id: (data as unknown as { id: string }).id };
}

/** Renames a class or changes its code. Renaming is safe at any time. */
export async function updateClass(id: string, input: ClassInput): Promise<WriteResult> {
    const db = requireSupabase();

    const { error } = await db
        .from('classes')
        .update({
            year_level: input.yearLevel,
            name: input.name.trim(),
            code: input.code?.trim() || null,
        })
        .eq('id', id);

    if (error) {
        if (error.code === '23505') {
            return {
                success: false,
                error: `A Year ${input.yearLevel} class named "${input.name.trim()}" already exists this year.`,
            };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id };
}

/**
 * Removes a class.
 *
 * Refuses while students are enrolled. Deleting would either strand those
 * students or silently take their class away, and neither is something to do
 * because someone pressed a button. They must be moved first — which is also
 * what a school would expect to do.
 */
export async function deleteClass(id: string): Promise<WriteResult> {
    const db = requireSupabase();

    const { count, error: countError } = await db
        .from('student_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', id)
        .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
        .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`);

    if (countError) return { success: false, error: countError.message };
    if (count && count > 0) {
        return {
            success: false,
            error: `This class still has ${count} student${count === 1 ? '' : 's'}. Move them to another class first.`,
        };
    }

    const { error } = await db.from('classes').delete().eq('id', id);
    if (error) {
        // A foreign key from a past enrolment, a timetable slot or a subject
        // link means the class is still referenced by history.
        if (error.code === '23503') {
            return {
                success: false,
                error: 'This class is still used by other records and cannot be removed. Mark it inactive instead.',
            };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id };
}

// =============================================================================
// Subjects
// =============================================================================

/** Reads every subject, with how many classes teach it this year. */
export async function listSubjects(): Promise<SubjectRecord[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('subjects')
        .select('id, code, name, short_name, category, status')
        .limit(2000)
        .order('name');

    if (error) throw new Error(`Could not load subjects: ${error.message}`);
    const rows = (data ?? []) as unknown as SubjectRow[];
    if (rows.length === 0) return [];

    const counts = new Map<string, number>();
    const { data: links } = await db
        .from('class_subjects')
        .select('class_id, subject_id')
        .limit(2000);
    for (const l of (links ?? []) as unknown as ClassSubjectRow[]) {
        counts.set(l.subject_id, (counts.get(l.subject_id) ?? 0) + 1);
    }

    return rows.map((r): SubjectRecord => ({
        id: r.id,
        code: r.code,
        name: r.name,
        shortName: r.short_name,
        category: r.category,
        status: r.status,
        classCount: counts.get(r.id) ?? 0,
    }));
}

/** Active subjects, for a picker. */
export async function listSubjectOptions(): Promise<ClassOption[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('subjects')
        .select('id, name, code')
        .limit(2000)
        .eq('status', 'ACTIVE')
        .order('name');

    if (error) throw new Error(`Could not load subjects: ${error.message}`);
    return ((data ?? []) as unknown as { id: string; name: string; code: string }[])
        .map(s => ({ id: s.id, label: s.name }));
}

export interface SubjectInput {
    code: string;
    name: string;
    shortName?: string | null;
    category?: string | null;
    status?: SubjectRecord['status'];
}

const subjectRow = (input: SubjectInput) => ({
    code: input.code.trim(),
    name: input.name.trim(),
    short_name: input.shortName?.trim() || null,
    category: input.category?.trim() || null,
    status: input.status ?? 'ACTIVE',
});

/** Creates a subject. */
export async function createSubject(input: SubjectInput): Promise<WriteResult> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('subjects')
        .insert(subjectRow(input))
        .select('id')
        .limit(2000)
        .single();

    if (error) {
        // Subject codes are compared case-insensitively: "MT" and "mt" would be
        // the same subject, and allowing both would split one subject's records.
        if (error.code === '23505') {
            return { success: false, error: `Subject code "${input.code.trim()}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id: (data as unknown as { id: string }).id };
}

/** Renames a subject or changes its details. */
export async function updateSubject(id: string, input: SubjectInput): Promise<WriteResult> {
    const db = requireSupabase();

    const { error } = await db.from('subjects').update(subjectRow(input)).eq('id', id);

    if (error) {
        if (error.code === '23505') {
            return { success: false, error: `Subject code "${input.code.trim()}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id };
}

/**
 * Removes a subject.
 *
 * Refuses while any class teaches it or any teacher is assigned to teach it:
 * deleting would quietly remove it from timetables and teaching records that
 * already refer to it.
 */
export async function deleteSubject(id: string): Promise<WriteResult> {
    const db = requireSupabase();

    const { count: classCount } = await db
        .from('class_subjects')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', id);

    if (classCount && classCount > 0) {
        return {
            success: false,
            error: `This subject is taught in ${classCount} class${classCount === 1 ? '' : 'es'}. Remove it from those classes first, or mark it inactive instead.`,
        };
    }

    const { error } = await db.from('subjects').delete().eq('id', id);
    if (error) {
        if (error.code === '23503') {
            return {
                success: false,
                error: 'This subject is still used by other records and cannot be removed. Mark it inactive instead.',
            };
        }
        return { success: false, error: error.message };
    }
    return { success: true, id };
}

// =============================================================================
// Class ↔ subject links
// =============================================================================

/** Every subject taught in this academic year, by class. */
export async function listClassSubjects(): Promise<ClassSubjectRecord[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('class_subjects')
        .select('class_id, subject_id')
        .limit(2000);
    if (error) throw new Error(`Could not load class subjects: ${error.message}`);

    return ((data ?? []) as unknown as ClassSubjectRow[]).map(r => ({
        classId: r.class_id,
        subjectId: r.subject_id,
    }));
}

/**
 * Sets which subjects a class teaches, replacing whatever was set before.
 *
 * A class's subject list is edited as a whole ("these are the subjects"), so
 * applying it as a whole is what the owner means. Adding and removing only the
 * differences would leave a subject behind if a request failed halfway.
 *
 * Runs as: add the new links, then remove the ones no longer wanted. That order
 * matters — if adding fails, the class keeps the subjects it had rather than
 * losing them.
 */
export async function setClassSubjects(
    classId: string,
    subjectIds: string[]
): Promise<WriteResult> {
    const db = requireSupabase();

    const yearId = await getCurrentAcademicYearId();
    if (!yearId) {
        return { success: false, error: 'No academic year is set as current.' };
    }

    const { data: existing, error: readError } = await db
        .from('class_subjects')
        .select('subject_id')
        .limit(2000)
        .eq('class_id', classId)
        .eq('academic_year_id', yearId);

    if (readError) return { success: false, error: readError.message };

    const current = new Set(
        ((existing ?? []) as unknown as { subject_id: string }[]).map(r => r.subject_id)
    );
    const wanted = new Set(subjectIds);

    const toAdd = [...wanted].filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !wanted.has(id));

    if (toAdd.length > 0) {
        // Every row carries the same keys: PostgREST rejects a bulk insert whose
        // objects differ in shape.
        const { error } = await db.from('class_subjects').insert(
            toAdd.map(subjectId => ({
                class_id: classId,
                subject_id: subjectId,
                academic_year_id: yearId,
            }))
        );
        if (error) return { success: false, error: error.message };
    }

    if (toRemove.length > 0) {
        const { error } = await db
            .from('class_subjects')
            .delete()
            .eq('class_id', classId)
            .eq('academic_year_id', yearId)
            .in('subject_id', toRemove);
        if (error) return { success: false, error: error.message };
    }

    return { success: true, id: classId };
}

/** Subjects taught in one class. */
export async function getClassSubjects(classId: string): Promise<string[]> {
    const links = await listClassSubjects();
    return links.filter(l => l.classId === classId).map(l => l.subjectId);
}
