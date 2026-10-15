import i18n from '../../../lib/i18n';
/**
 * Student data access — SRIK.
 *
 * Reference: docs/srik/04_PHASE_2_ACADEMIC_CORE.md
 *
 * Same two rules as the teacher module:
 *
 *   1. A student's class is NOT a column. It comes from `student_enrollments`,
 *      where the current class is the row with `ended_at IS NULL`. This is what
 *      lets a class change keep history instead of overwriting it.
 *
 *   2. Class membership is written through the `enroll_student` RPC, never by
 *      inserting into the table. That table deliberately has no write grant,
 *      because a class change must close the old row and open the new one in a
 *      single audited transaction.
 */

import { readAllPages, requireSupabase } from './client';
import { todayInKualaLumpur } from './attendance';

/** A student as the screens consume it. */
export interface StudentRecord {
    id: string;
    admissionNo: string;
    fullName: string;
    gender: 'MALE' | 'FEMALE' | null;
    birthDate: string | null;
    birthPlace: string | null;
    nationality: string | null;
    identityNo: string | null;
    address: string | null;
    previousSchool: string | null;
    admissionDate: string;
    status: 'ACTIVE' | 'GRADUATED' | 'TRANSFERRED' | 'WITHDRAWN' | 'ARCHIVED';
    /** Current class display name, e.g. "3 Al-Junaidi", or null when unassigned. */
    className: string | null;
    classId: string | null;
    /**
     * The class's year level as a NUMBER, straight from the database.
     *
     * Deliberately not parsed out of `className`. Class names are labels the
     * school may rename at any time ("5 Na'im" today, something else tomorrow),
     * and reading meaning out of them would break silently on the next rename.
     * Ordering and banding use this column, never the text.
     */
    yearLevel: number | null;
    /** Short class code, e.g. "3J". Also renameable; display only. */
    classCode: string | null;
    /** Guardians linked to this student, primary contact first. */
    guardians: GuardianSummary[];
}

export interface GuardianSummary {
    id: string;
    fullName: string;
    relationship: string;
    phone: string;
    email: string | null;
    isPrimary: boolean;
    isEmergencyContact: boolean;
}

export interface StudentWriteResult {
    success: boolean;
    studentId?: string;
    error?: string;
}

/**
 * Row shapes as they come back from Postgres.
 *
 * Declared by hand because the client is not created with generated database
 * types: without these, every field access resolves against the library's error
 * union and none of the real columns type-check.
 */
interface StudentRow {
    id: string;
    admission_no: string;
    full_name: string;
    gender: 'MALE' | 'FEMALE' | null;
    birth_date: string | null;
    birth_place: string | null;
    nationality: string | null;
    identity_no: string | null;
    address: string | null;
    previous_school: string | null;
    admission_date: string;
    status: 'ACTIVE' | 'GRADUATED' | 'TRANSFERRED' | 'WITHDRAWN' | 'ARCHIVED';
}

interface EnrollmentRow {
    student_id: string;
    class_id: string;
    ended_at: string | null;
}

interface ClassRow { id: string; display_name: string; year_level: number; code: string | null }

interface GuardianJoinRow {
    student_id: string;
    guardian_id: string;
    relationship: string;
    is_primary: boolean;
    is_emergency_contact: boolean;
}

interface GuardianRow {
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
}

const STUDENT_COLUMNS =
    'id, admission_no, full_name, gender, birth_date, birth_place, nationality, ' +
    'identity_no, address, previous_school, admission_date, status';

/**
 * Reads every student, with their current class and guardians.
 *
 * Three flat queries joined in memory rather than one nested select. At ~250
 * students the size is irrelevant, and separate queries are far easier to
 * verify than a deeply nested PostgREST query — which matters more here than
 * saving two round trips.
 *
 * EVERY QUERY HERE PAGES, and the reason is the school's own growth rather than
 * today's roll. The Data API returns at most 1,000 rows per response and stops
 * there without an error. Five years of graduates in the archive reaches that on
 * the students list alone, and the school would see a full-looking register with
 * people quietly missing from the bottom — sorted by name, so the loss would fall
 * on whoever comes last alphabetically and be attributed to anything but paging.
 * `readAllPages` keeps asking until the answer runs out.
 *
 * Each page request needs an `order`, or the database may return rows in a
 * different order per page and a student on a boundary can be dropped or doubled.
 */
export async function listStudents(): Promise<StudentRecord[]> {
    const db = requireSupabase();

    let students: unknown[];
    try {
        students = await readAllPages<StudentRow>((from, to) =>
            db.from('students').select(STUDENT_COLUMNS).order('full_name').range(from, to),
        );
    } catch (e) {
        throw new Error(
            `Could not load students: ${e instanceof Error ? e.message : String(e)}`,
        );
    }

    if (students.length === 0) return [];

    const rows = students as unknown as StudentRow[];

    // Current class per student, resolved by the DATABASE — one call for the list.
    //
    // This used to filter `student_enrollments` on `ended_at is null` and take
    // whatever came back. That filter is ambiguous (audit F24): a child promoted to
    // next year's class has two open rows, one per year, and the answer depended on
    // which one the database happened to return. The student record did not survive
    // it at all, because it reads with `maybeSingle()` and two rows is an error.
    //
    // `classes_on` is the same rule as `class_on`, in bulk, so the directory and the
    // child's own page cannot disagree about which class they are in.
    //
    // A failure here degrades to "no class shown" rather than blanking the whole
    // list: a student without a placement is a normal state, not an error.
    const classByStudent = new Map<string, { id: string; name: string; yearLevel: number; code: string | null }>();
    const { data: placements } = await db.rpc('classes_on', {
        p_student_ids: rows.map(r => r.id),
        p_date: todayInKualaLumpur(),
    });

    const placementRows = (placements ?? []) as { student_id: string; class_id: string }[];
    if (placementRows.length) {
        const classIds = [...new Set(placementRows.map(p => p.class_id))];
        const { data: classes } = await db
            .from('classes')
            .select('id, display_name, year_level, code')
            .in('id', classIds)
            .limit(1000);

        const classById = new Map(((classes ?? []) as unknown as ClassRow[]).map(c => [c.id, c]));
        for (const p of placementRows) {
            const cls = classById.get(p.class_id);
            if (cls) {
                classByStudent.set(p.student_id, {
                    id: p.class_id,
                    name: cls.display_name,
                    yearLevel: cls.year_level,
                    code: cls.code,
                });
            }
        }
    }

    const guardians = await loadGuardians(rows.map(r => r.id));

    return rows.map((r): StudentRecord => {
        const current = classByStudent.get(r.id);
        return {
            id: r.id,
            admissionNo: r.admission_no,
            fullName: r.full_name,
            gender: r.gender,
            birthDate: r.birth_date,
            birthPlace: r.birth_place,
            nationality: r.nationality,
            identityNo: r.identity_no,
            address: r.address,
            previousSchool: r.previous_school,
            admissionDate: r.admission_date,
            status: r.status,
            className: current?.name ?? null,
            classId: current?.id ?? null,
            yearLevel: current?.yearLevel ?? null,
            classCode: current?.code ?? null,
            guardians: guardians.get(r.id) ?? [],
        };
    });
}

/** Loads guardians for the given students, keyed by student id. */
async function loadGuardians(studentIds: string[]): Promise<Map<string, GuardianSummary[]>> {
    const result = new Map<string, GuardianSummary[]>();
    if (studentIds.length === 0) return result;

    const db = requireSupabase();
    // Bounded by `studentIds`, which the caller supplies — a page of students. A
    // guardian count per child is small (one to three), so this cannot reach the
    // 1,000-row cap for a realistic page; the explicit limit states that bound.
    const { data: links } = await db
        .from('student_guardians')
        .select('student_id, guardian_id, relationship, is_primary, is_emergency_contact')
        .in('student_id', studentIds)
        .limit(10000);

    if (!links) return result;

    const linkRows = links as unknown as GuardianJoinRow[];
    const guardianIds = [...new Set(linkRows.map(l => l.guardian_id))];
    if (guardianIds.length === 0) return result;

    const { data: people } = await db
        .from('guardians')
        .select('id, full_name, phone, email')
        .in('id', guardianIds)
        .limit(10000);

    const personById = new Map(((people ?? []) as unknown as GuardianRow[]).map(g => [g.id, g]));

    for (const link of linkRows) {
        const person = personById.get(link.guardian_id);
        if (!person) continue;
        if (!result.has(link.student_id)) result.set(link.student_id, []);
        result.get(link.student_id)!.push({
            id: person.id,
            fullName: person.full_name,
            relationship: link.relationship,
            phone: person.phone,
            email: person.email,
            isPrimary: link.is_primary,
            isEmergencyContact: link.is_emergency_contact,
        });
    }

    // Primary contact first, so a screen reading `[0]` gets the right person
    // without every caller re-implementing the ordering.
    for (const list of result.values()) {
        list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    }
    return result;
}

/** Reads one student, or null when the id does not exist. */
export async function getStudent(id: string): Promise<StudentRecord | null> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('students')
        .select(STUDENT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(`${i18n.t('dataErrors.couldNotLoadTheStudent')}: ${error.message}`);
    if (!data) return null;

    const row = data as unknown as StudentRow;

    // The child's class, from the database's own rule — NOT a `maybeSingle()` over
    // `ended_at is null`.
    //
    // That is what F24 broke most visibly: a promoted child has two open enrollments
    // in different years, `maybeSingle()` errors when it is handed two rows, and the
    // whole student record failed to open. Not a wrong class — a page that would not
    // load, for every child the office had promoted for next year.
    const { data: placement } = await db.rpc('class_on', {
        p_student_id: id,
        p_date: todayInKualaLumpur(),
    });

    let className: string | null = null;
    let classId: string | null = null;
    let yearLevel: number | null = null;
    let classCode: string | null = null;
    if (placement) {
        classId = placement as unknown as string;
        const { data: cls } = await db
            .from('classes').select('id, display_name, year_level, code').eq('id', classId).maybeSingle();
        const row2 = cls as unknown as ClassRow | null;
        className = row2?.display_name ?? null;
        yearLevel = row2?.year_level ?? null;
        classCode = row2?.code ?? null;
    }

    const guardians = await loadGuardians([id]);

    return {
        id: row.id,
        admissionNo: row.admission_no,
        fullName: row.full_name,
        gender: row.gender,
        birthDate: row.birth_date,
        birthPlace: row.birth_place,
        nationality: row.nationality,
        identityNo: row.identity_no,
        address: row.address,
        previousSchool: row.previous_school,
        admissionDate: row.admission_date,
        status: row.status,
        className,
        classId,
        yearLevel,
        classCode,
        guardians: guardians.get(id) ?? [],
    };
}

/** Fields a caller may supply when creating or updating a student. */
export interface StudentInput {
    admissionNo: string;
    fullName: string;
    gender?: 'MALE' | 'FEMALE' | null;
    birthDate?: string | null;
    birthPlace?: string | null;
    nationality?: string | null;
    identityNo?: string | null;
    address?: string | null;
    previousSchool?: string | null;
    admissionDate?: string | null;
    status?: StudentRecord['status'];
}

const toRow = (input: StudentInput) => ({
    admission_no: input.admissionNo.trim(),
    full_name: input.fullName.trim(),
    gender: input.gender ?? null,
    birth_date: input.birthDate || null,
    birth_place: input.birthPlace?.trim() || null,
    nationality: input.nationality?.trim() || null,
    identity_no: input.identityNo?.trim() || null,
    address: input.address?.trim() || null,
    previous_school: input.previousSchool?.trim() || null,
    admission_date: input.admissionDate || undefined,
    status: input.status ?? 'ACTIVE',
});

/** Creates a student record. Does not enrol them: see `enrollStudent`. */
export async function createStudent(input: StudentInput): Promise<StudentWriteResult> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('students')
        .insert(toRow(input))
        .select('id')
        .single();

    if (error) {
        // A duplicate admission number is the most likely failure, and the raw
        // Postgres message is not something to show an owner.
        if (error.code === '23505') {
            return { success: false, error: `Admission number "${input.admissionNo}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, studentId: (data as unknown as { id: string }).id };
}

/** Updates a student record. */
export async function updateStudent(id: string, input: StudentInput): Promise<StudentWriteResult> {
    const db = requireSupabase();

    const { error } = await db.from('students').update(toRow(input)).eq('id', id);

    if (error) {
        if (error.code === '23505') {
            return { success: false, error: `Admission number "${input.admissionNo}" is already in use.` };
        }
        return { success: false, error: error.message };
    }
    return { success: true, studentId: id };
}

/**
 * Changes a student's status, e.g. withdrawing them.
 *
 * Separate from `updateStudent` because status carries meaning the other fields
 * do not: withdrawing a student should not require the form to resend their
 * name and admission number, and an accidental blank there would wipe both.
 */
export async function setStudentStatus(
    id: string,
    status: StudentRecord['status']
): Promise<StudentWriteResult> {
    const db = requireSupabase();
    const { error } = await db.from('students').update({ status }).eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true, studentId: id };
}

/**
 * Places a student in a class.
 *
 * Calls the `enroll_student` RPC: `student_enrollments` has no write grant, so
 * this is the only supported path. The RPC closes any previous enrolment in the
 * same academic year first, which keeps "the student's class" unambiguous.
 */
export async function enrollStudent(
    studentId: string,
    classId: string,
    reason?: string
): Promise<StudentWriteResult> {
    const db = requireSupabase();
    const { error } = await db.rpc('enroll_student', {
        p_student_id: studentId,
        p_class_id: classId,
        p_reason: reason ?? null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, studentId };
}

/** A guardian's details as supplied by the form. */
export interface GuardianInput {
    fullName: string;
    relationship: string;
    phone: string;
    email?: string | null;
    identityNo?: string | null;
    address?: string | null;
    occupation?: string | null;
    isPrimary?: boolean;
    isEmergencyContact?: boolean;
}

/**
 * Adds a guardian and links them to a student.
 *
 * Creates a NEW guardian each time rather than matching on name or phone.
 * Two people can share either, and matching would silently merge two families'
 * records. Deduplication stays a human decision — see 04_PHASE_2.
 */
export async function addGuardian(
    studentId: string,
    input: GuardianInput
): Promise<{ success: boolean; guardianId?: string; error?: string }> {
    const db = requireSupabase();

    const { data: guardian, error: guardianError } = await db
        .from('guardians')
        .insert({
            full_name: input.fullName.trim(),
            phone: input.phone.trim(),
            email: input.email?.trim() || null,
            identity_no: input.identityNo?.trim() || null,
            address: input.address?.trim() || null,
            occupation: input.occupation?.trim() || null,
        })
        .select('id')
        .single();

    if (guardianError) return { success: false, error: guardianError.message };

    const guardianId = (guardian as unknown as { id: string }).id;

    const { error: linkError } = await db.from('student_guardians').insert({
        student_id: studentId,
        guardian_id: guardianId,
        relationship: input.relationship.trim(),
        is_primary: input.isPrimary ?? false,
        is_emergency_contact: input.isEmergencyContact ?? false,
    });

    if (linkError) {
        // The guardian row would otherwise be orphaned, attached to nobody, and
        // would reappear as a stranger on the next attempt. Remove it so the
        // operation is all-or-nothing.
        await db.from('guardians').delete().eq('id', guardianId);
        return { success: false, error: linkError.message };
    }

    return { success: true, guardianId };
}

/** Classes for the enrolment picker, from the CURRENT academic year. */
export interface ClassOption { id: string; label: string }

export async function listClassOptions(): Promise<ClassOption[]> {
    const db = requireSupabase();

    const { data: year } = await db
        .from('academic_years')
        .select('id')
        .eq('status', 'CURRENT')
        .maybeSingle();

    if (!year) return [];

    const { data, error } = await db
        .from('classes')
        .select('id, display_name')
        .eq('academic_year_id', (year as unknown as { id: string }).id)
        .eq('status', 'ACTIVE')
        .order('year_level')
        .order('name')
        // A school has a handful of classes per year, not a thousand. The explicit
        // limit records that this is a bounded list rather than an oversight.
        .limit(500);

    if (error) throw new Error(`${i18n.t('dataErrors.couldNotLoadClasses')}: ${error.message}`);
    return ((data ?? []) as unknown as ClassRow[]).map(c => ({ id: c.id, label: c.display_name }));
}

/** The CURRENT academic year id, or null when none is set. */
export async function getCurrentAcademicYearId(): Promise<string | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('academic_years')
        .select('id')
        .eq('status', 'CURRENT')
        .maybeSingle();
    if (error) return null;
    return (data as unknown as { id: string } | null)?.id ?? null;
}

/**
 * Suggests the next admission number, e.g. S-0007 after S-0006.
 *
 * A suggestion, not a reservation: two people entering students at the same
 * moment could receive the same number. The unique index is what actually
 * prevents a clash, and `createStudent` reports it plainly if one occurs.
 */
export async function suggestNextAdmissionNo(prefix = 'S-'): Promise<string> {
    const db = requireSupabase();

    // PAGED. This reads every admission number the school has ever issued, and the
    // table only grows — it holds graduates and transfers too, because the record is
    // kept. A count that silently stopped at 1,000 would suggest a number that is
    // already taken (the highest ones are missing), and `createStudent` would then
    // report a confusing clash on the unique index instead of a clear duplicate.
    const rows = await readAllPages<{ admission_no: string }>((from, to) =>
        db
            .from('students')
            .select('admission_no')
            .ilike('admission_no', `${prefix}%`)
            .order('admission_no')
            .range(from, to),
    );

    const numbers = rows
        .map(s => Number(s.admission_no.slice(prefix.length)))
        .filter(n => Number.isFinite(n));

    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * Creates a student, enrols them, and optionally records a guardian.
 *
 * Enrolment and guardian are best-effort: a student record with no class yet is
 * a normal state while data is being entered, and failing the whole creation
 * because one optional step failed would lose the record the owner just typed.
 * Each partial failure is reported back so the owner knows what to finish.
 */
export async function createStudentWithDetails(
    input: StudentInput,
    options: { classId?: string | null; guardian?: GuardianInput | null }
): Promise<StudentWriteResult & { warning?: string }> {
    const created = await createStudent(input);
    if (!created.success || !created.studentId) return created;

    const studentId = created.studentId;
    const warnings: string[] = [];

    if (options.guardian) {
        const guardian = await addGuardian(studentId, options.guardian);
        if (!guardian.success) warnings.push(`guardian was not saved: ${guardian.error}`);
    }

    if (options.classId) {
        const enrolled = await enrollStudent(studentId, options.classId, 'Initial admission');
        if (!enrolled.success) warnings.push(`class was not assigned: ${enrolled.error}`);
    }

    return { success: true, studentId, warning: warnings.length ? warnings.join('; ') : undefined };
}

/** A guardian as the guardian screen lists them. */
export interface GuardianRecord {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    identityNo: string | null;
    address: string | null;
    occupation: string | null;
    /** The children this guardian is linked to, primary contact first. */
    children: { studentId: string; fullName: string; className: string | null; relationship: string; isPrimary: boolean }[];
    /** True when this guardian has a login account. */
    hasLogin: boolean;
}

/** Every guardian, with the children they are linked to. */
export async function listGuardians(): Promise<GuardianRecord[]> {
    const db = requireSupabase();

    // PAGED, because this is the school's entire guardian roll — one row per
    // parent and carer, so ~250 today and unbounded as siblings and years are
    // added. Over 1,000 it would return a full-looking list missing people.
    let guardians: unknown[];
    try {
        guardians = await readAllPages<Record<string, unknown>>((from, to) =>
            db
                .from('guardians')
                .select('id, full_name, phone, email, identity_no, address, occupation, user_id')
                .order('full_name')
                .range(from, to),
        );
    } catch (e) {
        throw new Error(
            `Could not load guardians: ${e instanceof Error ? e.message : String(e)}`,
        );
    }

    const rows = (guardians ?? []) as unknown as {
        id: string; full_name: string; phone: string; email: string | null;
        identity_no: string | null; address: string | null; occupation: string | null;
        user_id: string | null;
    }[];
    if (rows.length === 0) return [];

    const ids = rows.map(g => g.id);

    // Links are read on their own and joined in memory: nested PostgREST selects
    // are harder to verify, and at SRIK's size the extra query is cheaper than
    // the ambiguity.
    // One row per guardian-child pair, so the count grows with family size rather
    // than with the roll. It is read in pages anyway: the cost is one extra request
    // only when there is genuinely another page, and the alternative is a silently
    // short list of children.
    let links: unknown[];
    try {
        links = await readAllPages<Record<string, unknown>>((from, to) =>
            db
                .from('student_guardians')
                .select('guardian_id, student_id, relationship, is_primary')
                .in('guardian_id', ids)
                .order('guardian_id')
                .range(from, to),
        );
    } catch {
        links = [];
    }

    const linkRows = (links ?? []) as unknown as {
        guardian_id: string; student_id: string; relationship: string; is_primary: boolean;
    }[];

    const studentIds = [...new Set(linkRows.map(l => l.student_id))];
    const studentById = new Map<string, { fullName: string; className: string | null }>();

    if (studentIds.length) {
        const { data: students } = await db
            .from('students')
            .select('id, full_name')
            .in('id', studentIds)
            .limit(10000);

        const studentRows = (students ?? []) as unknown as {
            id: string; full_name: string;
        }[];

        // A student's class lives on their open enrollment, not on the student
        // row: the same child is in Year 3 this year and Year 4 next year, and
        // the record of that change is the point. Reading a class_id off the
        // student would show nothing for every child.
        // Date-scoped, not merely `ended_at is null`.
        //
        // A promoted child has one open enrollment per year, and `Set`-ing them into
        // a Map means the LAST row the database returns wins — so which class shown
        // against the child depended on row order. Now the placement must actually
        // cover today, and the same later-start-wins rule as the database function
        // breaks any remaining tie.
        const { data: enrollments } = await db
            .from('student_enrollments')
            .select('student_id, class_id, ended_at, enrolled_at')
            .in('student_id', studentIds)
            .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
            .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`)
            .order('enrolled_at', { ascending: true })
            .limit(10000);

        const enrolledClassByStudent = new Map<string, string>();
        for (const e of (enrollments ?? []) as unknown as { student_id: string; class_id: string }[]) {
            // Ascending order means the LATEST placement is written last and wins —
            // deterministically, rather than by whatever order the rows arrived.
            enrolledClassByStudent.set(e.student_id, e.class_id);
        }

        // Class names are labels that the school renames, so they are read fresh
        // rather than stored on the student.
        const classIds = [...new Set(enrolledClassByStudent.values())];
        const classById = new Map<string, string>();
        if (classIds.length) {
            const { data: classes } = await db
                .from('classes')
                .select('id, display_name')
                .in('id', classIds)
                .limit(1000);
            for (const c of (classes ?? []) as unknown as { id: string; display_name: string }[]) {
                classById.set(c.id, c.display_name);
            }
        }

        for (const s of studentRows) {
            const classId = enrolledClassByStudent.get(s.id);
            studentById.set(s.id, {
                fullName: s.full_name,
                className: classId ? classById.get(classId) ?? null : null,
            });
        }
    }

    const childrenByGuardian = new Map<string, GuardianRecord['children']>();
    for (const l of linkRows) {
        if (!childrenByGuardian.has(l.guardian_id)) childrenByGuardian.set(l.guardian_id, []);
        const student = studentById.get(l.student_id);
        childrenByGuardian.get(l.guardian_id)!.push({
            studentId: l.student_id,
            fullName: student?.fullName ?? 'Unknown student',
            className: student?.className ?? null,
            relationship: l.relationship,
            isPrimary: l.is_primary,
        });
    }

    for (const list of childrenByGuardian.values()) {
        list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.fullName.localeCompare(b.fullName));
    }

    return rows.map((g): GuardianRecord => ({
        id: g.id,
        fullName: g.full_name,
        phone: g.phone,
        email: g.email,
        identityNo: g.identity_no,
        address: g.address,
        occupation: g.occupation,
        children: childrenByGuardian.get(g.id) ?? [],
        hasLogin: Boolean(g.user_id),
    }));
}

/** Creates a guardian, or updates the one already using that phone number. */
export async function saveGuardian(input: {
    id?: string;
    fullName: string;
    phone: string;
    email?: string | null;
    identityNo?: string | null;
    address?: string | null;
    occupation?: string | null;
}): Promise<{ success: boolean; guardianId?: string; error?: string }> {
    const db = requireSupabase();

    const payload = {
        full_name: input.fullName.trim(),
        phone: input.phone.trim(),
        email: input.email?.trim() || null,
        identity_no: input.identityNo?.trim() || null,
        address: input.address?.trim() || null,
        occupation: input.occupation?.trim() || null,
    };

    if (input.id) {
        const { error } = await db.from('guardians').update(payload).eq('id', input.id);
        if (error) return { success: false, error: error.message };
        return { success: true, guardianId: input.id };
    }

    const { data, error } = await db.from('guardians').insert(payload).select('id').single();
    if (error) return { success: false, error: error.message };
    return { success: true, guardianId: (data as unknown as { id: string }).id };
}

/**
 * Removes a guardian.
 *
 * Refused while they are still linked to a child: detaching a parent from a
 * student should be a deliberate act on the student's record, not a side effect
 * of tidying the guardian list.
 */
export async function deleteGuardian(id: string): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    // A COUNT, not a row fetch, and the difference matters for a guard like this.
    //
    // This decides whether a guardian may be deleted. Fetching the rows would cap at
    // 1,000 and the check would be "fewer than 1,000 links", which is a weaker rule
    // than it looks — and it is the wrong failure direction: a guardian with 1,001
    // children would be reported as deletable. `count: 'exact'` with `head: true`
    // makes the database do the counting, so no cap applies.
    const { count, error: linkError } = await db
        .from('student_guardians')
        .select('student_id', { count: 'exact', head: true })
        .eq('guardian_id', id);
    if (linkError) return { success: false, error: linkError.message };

    const linkedCount = count ?? 0;
    if (linkedCount > 0) {
        return {
            success: false,
            error: `This guardian is still linked to ${linkedCount} ${linkedCount === 1 ? 'student' : 'students'}. Remove the link from the student's record first.`,
        };
    }

    const { error } = await db.from('guardians').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}
