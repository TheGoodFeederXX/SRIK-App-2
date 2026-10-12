/**
 * Assessments and report cards — SRIK.
 *
 * Reference: docs/srik/06_PHASE_4_ASSESSMENTS_REPORTS.md
 *
 * Four rules shape this file, and they are the same rules the database
 * enforces. They are restated here because a screen that forgets them will
 * quietly show a parent something untrue.
 *
 * 1. A BLANK MARK IS NOT A ZERO. A child with no mark entered, and a child who
 *    was away, are different facts from a child who scored nothing. Every score
 *    here is `number | null`, and a null is never turned into a 0 for display or
 *    for a total. Turning null into 0 would make an absent child look failing.
 *
 * 2. WRITES GO THROUGH THE RPC. The results table grants `authenticated`
 *    read-only access on purpose: a direct write would skip the enrollment
 *    check, the maximum-score check and the audit trail. `saveMarks` is the only
 *    way marks are written, and that is a deliberate constraint.
 *
 * 3. A PUBLISHED ASSESSMENT IS FROZEN. Once the office publishes, marks cannot
 *    be changed from a screen. That is what makes a report card trustworthy.
 *    The screen must not offer an edit that the database will refuse.
 *
 * 4. A REPORT CARD IS A SNAPSHOT. Reading one gives back the frozen copy taken
 *    when it was published, not a recomputation. If a mark is corrected later,
 *    the already-published report still says what it said. Corrections are new
 *    revisions, and both are kept.
 */

import { requireSupabase } from './client';
import { todayInKualaLumpur } from './attendance';

export type AssessmentType =
    | 'MID_YEAR_EXAM'
    | 'FINAL_EXAM'
    | 'SPECIAL_EXAM'
    | 'TEST'
    | 'QUIZ'
    | 'PBD';

export type ResultStatus = 'NOT_ENTERED' | 'GRADED' | 'ABSENT' | 'EXEMPT';
export type AssessmentStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'PUBLISHED' | 'SUPERSEDED';

/** How the school names each kind of assessment, in the language it uses. */
export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
    MID_YEAR_EXAM: 'Peperiksaan Pertengahan Tahun',
    FINAL_EXAM: 'Peperiksaan Akhir Tahun (UASA)',
    SPECIAL_EXAM: 'Peperiksaan Khas',
    TEST: 'Ujian',
    QUIZ: 'Kuiz',
    PBD: 'PBD (Pentaksiran Bilik Darjah)',
};

/** Short labels for a table column, where the full name would not fit. */
export const ASSESSMENT_TYPE_SHORT: Record<AssessmentType, string> = {
    MID_YEAR_EXAM: 'Pertengahan Tahun',
    FINAL_EXAM: 'Akhir Tahun (UASA)',
    SPECIAL_EXAM: 'Khas',
    TEST: 'Ujian',
    QUIZ: 'Kuiz',
    PBD: 'PBD',
};

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
    NOT_ENTERED: 'Belum diisi',
    GRADED: 'Ada markah',
    ABSENT: 'Tidak hadir',
    EXEMPT: 'Dikecualikan',
};

export interface Assessment {
    id: string;
    title: string;
    type: AssessmentType;
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    classId: string;
    classDisplayName: string;
    academicTermId: string;
    termName: string;
    maxScore: number;
    weight: number;
    assessmentDate: string | null;
    status: AssessmentStatus;
    /** The profile that created it. Used to show a teacher their own exams. */
    createdBy: string | null;
}

export interface AcademicTerm {
    id: string;
    name: string;
    sequence: number;
    startDate: string;
    endDate: string;
    status: string;
}

/** One child's row in the mark-entry register. */
export interface MarkRow {
    studentId: string;
    studentName: string;
    admissionNo: string;
    /** null means nobody has said anything about this child yet. */
    status: ResultStatus;
    /** null means no mark — which is NOT the same as scoring zero. */
    score: number | null;
    tp: number | null;
    comment: string | null;
}

export interface MarkRegister {
    assessment: Assessment;
    rows: MarkRow[];
    /** How many children have a decided result (marked, absent or exempt). */
    decided: number;
    /** How many still have nothing recorded. */
    awaiting: number;
}

export interface GradeBoundary {
    id: string;
    grade: string;
    minPercent: number;
    maxPercent: number;
    sortOrder: number;
}

/* -------------------------------------------------------------------------
 * Terms
 * ---------------------------------------------------------------------- */

export async function listTerms(): Promise<AcademicTerm[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('academic_terms')
        .select('id, name, sequence, start_date, end_date, status')
        .limit(2000)
        .order('sequence');

    if (error) throw new Error(`Could not load the terms: ${error.message}`);

    return ((data ?? []) as unknown as {
        id: string; name: string; sequence: number;
        start_date: string; end_date: string; status: string;
    }[]).map(t => ({
        id: t.id,
        name: t.name,
        sequence: t.sequence,
        startDate: t.start_date,
        endDate: t.end_date,
        status: t.status,
    }));
}

/** The term the school is in now, for defaulting the screen. */
export async function getCurrentTerm(): Promise<AcademicTerm | null> {
    const terms = await listTerms();
    return terms.find(t => t.status === 'CURRENT') ?? terms[0] ?? null;
}

/* -------------------------------------------------------------------------
 * Assessments
 * ---------------------------------------------------------------------- */

interface RawAssessment {
    id: string;
    title: string;
    type: AssessmentType;
    subject_id: string;
    class_id: string;
    academic_term_id: string;
    max_score: number;
    weight: number;
    assessment_date: string | null;
    status: AssessmentStatus;
    created_by: string | null;
    subjects: { code: string; name: string } | null;
    classes: { display_name: string } | null;
    academic_terms: { name: string } | null;
}

function toAssessment(a: RawAssessment): Assessment {
    return {
        id: a.id,
        title: a.title,
        type: a.type,
        subjectId: a.subject_id,
        subjectCode: a.subjects?.code ?? '',
        subjectName: a.subjects?.name ?? '',
        classId: a.class_id,
        classDisplayName: a.classes?.display_name ?? '',
        academicTermId: a.academic_term_id,
        termName: a.academic_terms?.name ?? '',
        maxScore: Number(a.max_score),
        weight: Number(a.weight),
        assessmentDate: a.assessment_date,
        status: a.status,
        createdBy: a.created_by,
    };
}

const ASSESSMENT_SELECT =
    'id, title, type, subject_id, class_id, academic_term_id, max_score, weight, ' +
    'assessment_date, status, created_by, subjects(code, name), classes(display_name), ' +
    'academic_terms(name)';

/**
 * Assessments for one term, newest first.
 *
 * Filtering by class or subject is done by the caller so that the same query
 * serves both the office and a teacher; row level security already decides what
 * the caller is allowed to see.
 */
export async function listAssessments(
    termId: string,
    filter?: { classId?: string; subjectId?: string }
): Promise<Assessment[]> {
    const db = requireSupabase();
    let query = db
        .from('assessments')
        .select(ASSESSMENT_SELECT)
        .limit(2000)
        .eq('academic_term_id', termId);

    if (filter?.classId) query = query.eq('class_id', filter.classId);
    if (filter?.subjectId) query = query.eq('subject_id', filter.subjectId);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(`Could not load the assessments: ${error.message}`);

    return ((data ?? []) as unknown as RawAssessment[]).map(toAssessment);
}

export async function getAssessment(id: string): Promise<Assessment | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('assessments')
        .select(ASSESSMENT_SELECT)
        .limit(2000)
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(`Could not load the assessment: ${error.message}`);
    return data ? toAssessment(data as unknown as RawAssessment) : null;
}

export async function createAssessment(input: {
    title: string;
    type: AssessmentType;
    subjectId: string;
    classId: string;
    academicTermId: string;
    maxScore: number;
    weight?: number;
    assessmentDate?: string | null;
}): Promise<string> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('assessments')
        .insert({
            title: input.title,
            type: input.type,
            subject_id: input.subjectId,
            class_id: input.classId,
            academic_term_id: input.academicTermId,
            max_score: input.maxScore,
            weight: input.weight ?? 100,
            assessment_date: input.assessmentDate ?? null,
        })
        .select('id')
            .limit(2000)
        .single();

    if (error) throw new Error(friendlyAssessmentError(error.message));
    return (data as unknown as { id: string }).id;
}

export async function updateAssessment(
    id: string,
    patch: {
        title?: string;
        type?: AssessmentType;
        /** Move the exam to a different class. A mis-filed exam may be corrected
         *  without deleting it and losing the marks already recorded against it. */
        classId?: string;
        maxScore?: number;
        weight?: number;
        assessmentDate?: string | null;
    }
): Promise<void> {
    const db = requireSupabase();
    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.type !== undefined) update.type = patch.type;
    if (patch.classId !== undefined) update.class_id = patch.classId;
    if (patch.maxScore !== undefined) update.max_score = patch.maxScore;
    if (patch.weight !== undefined) update.weight = patch.weight;
    if (patch.assessmentDate !== undefined) update.assessment_date = patch.assessmentDate;

    const { error } = await db.from('assessments').update(update).eq('id', id);
    if (error) throw new Error(friendlyAssessmentError(error.message));
}

export async function deleteAssessment(id: string): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.from('assessments').delete().eq('id', id);
    if (error) throw new Error(friendlyAssessmentError(error.message));
}

/* -------------------------------------------------------------------------
 * The mark register
 * ---------------------------------------------------------------------- */

/**
 * The class list with whatever marks exist, for one assessment.
 *
 * Built from the enrollments that are OPEN NOW rather than from the results
 * table, so a child with no mark at all still appears in the register and can
 * be marked. Reading only the results would hide exactly the children the
 * teacher still has to deal with.
 */
export async function getMarkRegister(assessmentId: string): Promise<MarkRegister> {
    const db = requireSupabase();

    const assessment = await getAssessment(assessmentId);
    if (!assessment) throw new Error('This assessment could not be found.');

    // The class list AS OF TODAY, by the interval — not merely "still open".
    //
    // A promoted child has one open enrollment per year, so `ended_at is null` would
    // put them on BOTH this year's and next year's mark sheet. A child appears on a
    // register because they are in that class on that day.
    const { data: enrollments, error: enrollError } = await db
        .from('student_enrollments')
        .select('student_id')
        .eq('class_id', assessment.classId)
        .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
        .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`)
        .limit(2000);

    if (enrollError) throw new Error(`Could not load the class list: ${enrollError.message}`);

    const studentIds = ((enrollments ?? []) as unknown as { student_id: string }[])
        .map(e => e.student_id);

    if (studentIds.length === 0) {
        return { assessment, rows: [], decided: 0, awaiting: 0 };
    }

    const [studentsRes, resultsRes] = await Promise.all([
        db.from('students').select('id, full_name, admission_no, status').in('id', studentIds)
            .limit(2000),
        db.from('assessment_results')
            .select('student_id, status, score, tp, comment')
            .limit(2000)
            .eq('assessment_id', assessmentId)
            .in('student_id', studentIds),
    ]);

    if (studentsRes.error) throw new Error(`Could not load the students: ${studentsRes.error.message}`);
    if (resultsRes.error) throw new Error(`Could not load the marks: ${resultsRes.error.message}`);

    const students = (studentsRes.data ?? []) as unknown as {
        id: string; full_name: string; admission_no: string; status: string;
    }[];
    const results = (resultsRes.data ?? []) as unknown as {
        student_id: string; status: ResultStatus;
        score: number | null; tp: number | null; comment: string | null;
    }[];

    const resultByStudent = new Map(results.map(r => [r.student_id, r]));

    const rows = students
        // A withdrawn pupil still appears in the class list history but must not
        // be on this term's register.
        .filter(s => s.status === 'ACTIVE')
        .map((s): MarkRow => {
            const r = resultByStudent.get(s.id);
            return {
                studentId: s.id,
                studentName: s.full_name,
                admissionNo: s.admission_no,
                // NOT_ENTERED, not GRADED: nobody has said anything yet.
                status: r?.status ?? 'NOT_ENTERED',
                // Null is preserved. A blank mark must never become a zero.
                score: r?.score ?? null,
                tp: r?.tp ?? null,
                comment: r?.comment ?? null,
            };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName));

    const decided = rows.filter(r => r.status !== 'NOT_ENTERED').length;

    return {
        assessment,
        rows,
        decided,
        awaiting: rows.length - decided,
    };
}

/**
 * Save a whole register in one call.
 *
 * Sent as one request rather than one per child: a class of thirty saved
 * individually would leave the assessment half-entered whenever a request
 * failed, and the teacher would have no way to see which half went in. The
 * database function is idempotent, so re-sending after a dropped connection is
 * safe.
 */
export async function saveMarks(
    assessmentId: string,
    rows: MarkRow[],
    reason?: string
): Promise<{ graded: number; cleared: number; unchanged: number }> {
    const db = requireSupabase();

    const entries = rows.map(r => {
        // Only a graded row carries a score. Sending a score alongside "absent"
        // would be refused, correctly, so it is dropped here rather than
        // surfacing as a confusing error.
        const payload: Record<string, unknown> = {
            student_id: r.studentId,
            status: r.status,
        };
        if (r.status === 'GRADED') payload.score = r.score;
        if (r.tp !== null) payload.tp = r.tp;
        if (r.comment) payload.comment = r.comment;
        return payload;
    });

    const { data, error } = await db.rpc('save_assessment_marks', {
        p_assessment_id: assessmentId,
        p_entries: entries,
        p_reason: reason ?? null,
    });

    if (error) throw new Error(friendlyMarkError(error.message));

    return data as unknown as { graded: number; cleared: number; unchanged: number };
}

/** Publish an assessment, refusing while any child still has no decision. */
export async function publishAssessment(
    assessmentId: string,
    reason?: string
): Promise<{ published: boolean; students: number }> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('publish_assessment', {
        p_assessment_id: assessmentId,
        p_reason: reason ?? null,
    });

    if (error) throw new Error(friendlyMarkError(error.message));
    return data as unknown as { published: boolean; students: number };
}

/* -------------------------------------------------------------------------
 * Grade scale
 * ---------------------------------------------------------------------- */

export async function listGradeBoundaries(): Promise<GradeBoundary[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('grade_boundaries')
        .select('id, grade, min_percent, max_percent, sort_order')
        .limit(2000)
        .eq('status', 'ACTIVE')
        .order('sort_order');

    if (error) throw new Error(`Could not load the grade scale: ${error.message}`);

    return ((data ?? []) as unknown as {
        id: string; grade: string; min_percent: number;
        max_percent: number; sort_order: number;
    }[]).map(g => ({
        id: g.id,
        grade: g.grade,
        minPercent: Number(g.min_percent),
        maxPercent: Number(g.max_percent),
        sortOrder: g.sort_order,
    }));
}

/**
 * The grade a percentage falls into, using the school's own scale.
 *
 * Returns null when the scale does not cover the percentage, rather than
 * inventing a grade. A gap in the school's boundaries is the school's to fix,
 * and silently guessing would hide it.
 */
export function gradeFor(percent: number, boundaries: GradeBoundary[]): string | null {
    const match = boundaries.find(b => percent >= b.minPercent && percent <= b.maxPercent);
    return match ? match.grade : null;
}

/* -------------------------------------------------------------------------
 * Report cards
 * ---------------------------------------------------------------------- */

export interface ReportCardRow {
    id: string;
    studentId: string;
    studentName: string;
    academicTermId: string;
    termName: string;
    classDisplayName: string;
    version: number;
    status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
    publishedAt: string | null;
    hasSnapshot: boolean;
}

/** Who already has a report card this term, and at which revision. */
export async function listReportCards(termId: string): Promise<ReportCardRow[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('report_cards')
        .select('id, student_id, academic_term_id, version, status, published_at, ' +
                'students(full_name), classes(display_name), academic_terms(name)')
                    .limit(2000)
        .eq('academic_term_id', termId)
        .order('version', { ascending: false });

    if (error) throw new Error(`Could not load the report cards: ${error.message}`);

    return ((data ?? []) as unknown as {
        id: string; student_id: string; academic_term_id: string; version: number;
        status: ReportCardRow['status']; published_at: string | null;
        students: { full_name: string } | null;
        classes: { display_name: string } | null;
        academic_terms: { name: string } | null;
    }[]).map(r => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.students?.full_name ?? '',
        academicTermId: r.academic_term_id,
        termName: r.academic_terms?.name ?? '',
        classDisplayName: r.classes?.display_name ?? '',
        version: r.version,
        status: r.status,
        publishedAt: r.published_at,
        hasSnapshot: true,
    }));
}

export interface SnapshotAssessment {
    assessmentId: string;
    title: string;
    type: AssessmentType;
    subjectCode: string;
    subjectName: string;
    maxScore: number;
    weight: number;
    status: ResultStatus;
    score: number | null;
    percent: number | null;
    grade: string | null;
    tp: number | null;
    comment: string | null;
}

/** The frozen contents of one report card. */
export interface ReportSnapshot {
    schemaVersion: number;
    generatedAt: string;
    term: { id: string; name: string; startDate: string; endDate: string };
    student: { id: string; fullName: string; admissionNo: string; gender: string | null };
    class: { id: string; displayName: string; yearLevel: number } | null;
    assessments: SnapshotAssessment[];
    attendance: { daysRecorded: number; daysPresent: number; rate: number | null };
}

function toSnapshot(raw: any): ReportSnapshot {
    return {
        schemaVersion: raw.schema_version ?? 1,
        generatedAt: raw.generated_at,
        term: {
            id: raw.term?.id,
            name: raw.term?.name ?? '',
            startDate: raw.term?.start_date,
            endDate: raw.term?.end_date,
        },
        student: {
            id: raw.student?.id,
            fullName: raw.student?.full_name ?? '',
            admissionNo: raw.student?.admission_no ?? '',
            gender: raw.student?.gender ?? null,
        },
        class: raw.class
            ? {
                id: raw.class.id,
                displayName: raw.class.display_name ?? '',
                yearLevel: raw.class.year_level ?? 0,
            }
            : null,
        assessments: (raw.assessments ?? []).map((a: any): SnapshotAssessment => ({
            assessmentId: a.assessment_id,
            title: a.title,
            type: a.type,
            subjectCode: a.subject_code ?? '',
            subjectName: a.subject_name ?? '',
            maxScore: Number(a.max_score),
            weight: Number(a.weight ?? 100),
            status: a.status,
            // Preserved as null: a blank mark is not a zero on a report either.
            score: a.score === null || a.score === undefined ? null : Number(a.score),
            percent: a.percent === null || a.percent === undefined ? null : Number(a.percent),
            grade: a.grade ?? null,
            tp: a.tp ?? null,
            comment: a.comment ?? null,
        })),
        attendance: {
            daysRecorded: Number(raw.attendance?.days_recorded ?? 0),
            daysPresent: Number(raw.attendance?.days_present ?? 0),
            rate: raw.attendance?.rate === null || raw.attendance?.rate === undefined
                ? null
                : Number(raw.attendance.rate),
        },
    };
}

/**
 * The frozen report for a child, or null if none has been issued.
 *
 * Returns the stored snapshot, never a recomputation. That is the whole point
 * of a snapshot: correcting a mark afterwards must not change a report the
 * parent has already been given.
 */
export async function getReportSnapshot(
    studentId: string,
    termId: string
): Promise<{ id: string; version: number; status: string; snapshot: ReportSnapshot } | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('report_cards')
        .select('id, version, status, snapshot')
        .limit(2000)
        .eq('student_id', studentId)
        .eq('academic_term_id', termId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`Could not load the report card: ${error.message}`);
    if (!data) return null;

    const row = data as unknown as {
        id: string; version: number; status: string; snapshot: any;
    };
    return {
        id: row.id,
        version: row.version,
        status: row.status,
        snapshot: toSnapshot(row.snapshot),
    };
}

/** A preview of what the report WOULD say right now, without publishing it. */
export async function previewReport(
    studentId: string,
    termId: string
): Promise<ReportSnapshot> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('build_report_snapshot', {
        p_student_id: studentId,
        p_academic_term_id: termId,
    });

    if (error) throw new Error(`Could not build the report preview: ${error.message}`);
    return toSnapshot(data);
}

/**
 * Issue a report card, freezing the current marks into a snapshot.
 *
 * If one is already live for this child and term, this becomes a NEW revision
 * and the previous one is marked superseded but kept on file. A correction that
 * erased its predecessor would destroy the record of what was originally sent
 * home, which is exactly what a school needs to be able to show.
 */
export async function publishReportCard(
    studentId: string,
    termId: string,
    reason?: string
): Promise<{ reportCardId: string; version: number; supersededId: string | null }> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('publish_report_card', {
        p_student_id: studentId,
        p_academic_term_id: termId,
        p_reason: reason ?? null,
    });

    if (error) throw new Error(friendlyMarkError(error.message));

    const d = data as unknown as {
        report_card_id: string; version: number; superseded_id: string | null;
    };
    return {
        reportCardId: d.report_card_id,
        version: d.version,
        supersededId: d.superseded_id,
    };
}


/* -------------------------------------------------------------------------
 * The school's own details, for the head of a report card
 * ---------------------------------------------------------------------- */

export interface SchoolDetails {
    name: string;
    shortName: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    principalName: string;
    logoStorageKey: string | null;
}

/**
 * The school's details, used to head a printed report card.
 *
 * Read live rather than frozen into the snapshot: a report card is a document
 * about a CHILD, and the school's address is not part of what the report
 * asserts. Freezing it would mean every old report still showed a wrong phone
 * number after the school moved, which helps nobody.
 *
 * A missing profile returns blanks rather than throwing, so a report can still
 * be printed while the office is filling the details in.
 */
export async function getSchoolDetails(): Promise<SchoolDetails | null> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('school_profile')
        .select('name, short_name, address, phone, email, website, principal_name, logo_storage_key')
        .limit(2000)
        .maybeSingle();

    if (error) throw new Error(`Could not load the school details: ${error.message}`);
    if (!data) return null;

    const d = data as unknown as {
        name: string | null; short_name: string | null; address: string | null;
        phone: string | null; email: string | null; website: string | null;
        principal_name: string | null; logo_storage_key: string | null;
    };

    return {
        name: d.name ?? '',
        shortName: d.short_name ?? '',
        address: d.address ?? '',
        phone: d.phone ?? '',
        email: d.email ?? '',
        website: d.website ?? '',
        principalName: d.principal_name ?? '',
        logoStorageKey: d.logo_storage_key ?? null,
    };
}

/* -------------------------------------------------------------------------
 * Who is in the class, so a report can be printed for each of them
 * ---------------------------------------------------------------------- */

export interface ClassStudent {
    studentId: string;
    fullName: string;
    admissionNo: string;
}

/**
 * The children currently in a class, for printing a whole class at once.
 *
 * Taken from the open enrollments, matching how the register is built, so a
 * child who has left does not get a report for a class they are no longer in.
 */
export async function listClassStudents(classId: string): Promise<ClassStudent[]> {
    const db = requireSupabase();

    const { data: enrollments, error: enrollError } = await db
        .from('student_enrollments')
        .select('student_id')
        .limit(2000)
        .eq('class_id', classId)
        .lte('enrolled_at', `${todayInKualaLumpur()}T23:59:59`)
        .or(`ended_at.is.null,ended_at.gte.${todayInKualaLumpur()}T00:00:00`);

    if (enrollError) throw new Error(`Could not load the class list: ${enrollError.message}`);

    const ids = ((enrollments ?? []) as unknown as { student_id: string }[]).map(e => e.student_id);
    if (ids.length === 0) return [];

    const { data, error } = await db
        .from('students')
        .select('id, full_name, admission_no, status')
        .limit(2000)
        .in('id', ids);

    if (error) throw new Error(`Could not load the students: ${error.message}`);

    return ((data ?? []) as unknown as {
        id: string; full_name: string; admission_no: string; status: string;
    }[])
        .filter(s => s.status === 'ACTIVE')
        .map(s => ({ studentId: s.id, fullName: s.full_name, admissionNo: s.admission_no }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * A whole-term average for one child, or null when nothing has been marked.
 *
 * Null rather than zero: a child with no marks has no average, and showing 0%
 * would read as a failing result the school never gave.
 *
 * Marks are weighted by each assessment's weight, and only assessments that
 * actually carry a mark take part. Including an unmarked assessment as zero
 * would drag an average down for work that was never assessed.
 */
export function averagePercent(assessments: SnapshotAssessment[]): number | null {
    let weighted = 0;
    let totalWeight = 0;

    for (const a of assessments) {
        if (a.percent === null) continue;
        weighted += a.percent * a.weight;
        totalWeight += a.weight;
    }

    if (totalWeight === 0) return null;
    return Math.round((weighted / totalWeight) * 100) / 100;
}

/* -------------------------------------------------------------------------
 * Messages
 * ---------------------------------------------------------------------- */

/**
 * Turn a database message into something a teacher can act on.
 *
 * The database speaks in constraint names and column names. None of that helps
 * somebody who just wants to enter marks, so the known cases get a sentence in
 * plain Malay and anything unrecognised is passed through rather than hidden.
 */
export function friendlyMarkError(message: string): string {
    const m = message ?? '';

    if (/above the maximum/i.test(m)) return 'Markah itu melebihi markah penuh. Sila betulkan.';
    if (/cannot be negative/i.test(m)) return 'Markah tidak boleh negatif.';
    if (/graded mark needs a score/i.test(m))
        return 'Markah kosong untuk pelajar yang bertanda "Ada markah". Sila isi markah atau tukar status.';
    if (/not assigned to this class|not assigned/i.test(m))
        return 'Anda tidak ditugaskan untuk kelas ini, jadi markahnya tidak boleh diisi.';
    if (/is published/i.test(m))
        return 'Penilaian ini sudah diterbitkan. Tarik balik penerbitannya dahulu sebelum mengubah markah.';
    if (/still missing for/i.test(m)) return m;
    if (/not enrolled in this class/i.test(m))
        return 'Pelajar itu tidak berada dalam kelas ini.';
    if (/no students enrolled/i.test(m)) return 'Tiada pelajar berdaftar dalam kelas ini.';
    if (/you do not have permission/i.test(m))
        return 'Anda tiada kebenaran untuk melakukan ini.';
    if (/only a graded mark may carry a score/i.test(m))
        return 'Hanya pelajar bertanda "Ada markah" boleh ada markah.';

    return message;
}

export function friendlyAssessmentError(message: string): string {
    const m = message ?? '';
    if (/max_score_positive/i.test(m)) return 'Markah penuh mesti lebih besar daripada sifar.';
    if (/weight_positive/i.test(m)) return 'Pemberat mesti lebih besar daripada sifar.';
    if (/you do not have permission/i.test(m)) return 'Anda tiada kebenaran untuk melakukan ini.';
    if (/already exists/i.test(m)) return 'Penilaian seumpama ini sudah wujud.';
    if (/violates foreign key/i.test(m))
        return 'Kelas, subjek atau penggal itu tidak sah.';
    return message;
}

/* -------------------------------------------------------------------------
 * Academic analytics
 * ---------------------------------------------------------------------- */

export interface AcademicAnalytics {
    /** Marks per grade, from the school's own scale. */
    gradeDistribution: { grade: string; count: number }[];
    subjectPerformance: { subjectId: string; subject: string | null; average: number; count: number }[];
    classComparison: { classId: string; className: string | null; average: number; count: number }[];
    metrics: {
        /**
         * NULL when no marks have been published for the term — deliberately not 0.
         * "Nobody passed" and "nothing marked yet" are different claims, and a screen
         * showing 0% for an unmarked term tells the school something untrue.
         */
        passRate: number | null;
        marksCounted: number;
        topPerformer: string | null;
        topPerformerAverage: number | null;
        overallAverage: number | null;
    };
}

/**
 * School-wide academic figures for a term, computed by the database.
 *
 * The counting is done where the rows are, not in the browser: a pass rate built from a
 * partial download is wrong in a way nobody can see (audit F28), and the grade scale has
 * to be the same one the report card uses.
 */
export async function getAcademicAnalytics(
    termId: string,
    classId?: string | null,
): Promise<AcademicAnalytics> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('academic_analytics', {
        p_academic_term_id: termId,
        p_class_id: classId || null,
    });

    if (error) throw new Error(`Could not load academic analytics: ${error.message}`);
    return data as unknown as AcademicAnalytics;
}

/* -------------------------------------------------------------------------
 * Per-subject marks, for reporting
 * ---------------------------------------------------------------------- */

export interface SubjectMarkRow {
    studentId: string;
    studentName: string;
    subjectId: string;
    subjectName: string | null;
    /** Average percentage this child scored in this subject, or null if no mark. */
    averagePercent: number | null;
    marksCounted: number;
}

/**
 * Every child's average mark per subject for a term.
 *
 * Returns ONE ROW PER CHILD PER SUBJECT rather than a school-wide aggregate, because the
 * two reports the school actually asks for — subject averages and a ranked list of children
 * — are both built from it. Aggregating here would force the screen to fetch every mark to
 * rebuild the child-level figures, which is the download the 1,000-row cap truncates
 * (audit F28).
 *
 * Only PUBLISHED assessments count, and only marks that carry a number. A child with no
 * mark in a subject gets `averagePercent: null`, not 0 — "not marked" and "scored zero" are
 * different, and a report that treats them alike ranks a child last for a subject they were
 * never assessed in.
 */
export async function listSubjectMarks(termId: string): Promise<SubjectMarkRow[]> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('subject_marks_for_term', { p_academic_term_id: termId });

    if (error) throw new Error(`Could not load subject marks: ${error.message}`);
    return ((data ?? []) as unknown as {
        student_id: string; student_name: string; subject_id: string; subject_name: string | null;
        average_percent: number | string | null; marks_counted: number;
    }[]).map(r => ({
        studentId: r.student_id,
        studentName: r.student_name,
        subjectId: r.subject_id,
        subjectName: r.subject_name,
        averagePercent: r.average_percent === null ? null : Number(r.average_percent),
        marksCounted: r.marks_counted,
    }));
}
