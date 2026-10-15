/**
 * Exams, as the school's screens present them.
 *
 * SRIK stores an exam as an ASSESSMENT: a title, a type, a subject, a class, a
 * term and a date. Two screens — the office's list and a teacher's list — both
 * render it, and this module holds the one definition of how a stored assessment
 * becomes the `Exam` the UI already knows. Two definitions would be two answers to
 * "does this exam have a date", which is how one screen shows a blank where the
 * other shows a day.
 */
import type { Assessment, AssessmentType } from './assessments';

/** The shape the exam screens render. Mirrors the app's own `Exam` type. */
export interface ExamRow {
    id: string;
    type: string;
    date: string;
    className: string;
    classId?: string;
    subject: string;
    isPublished: boolean;
    teacherId?: string;
}

/**
 * A stored assessment, shaped for the screens.
 *
 * `isPublished` is DERIVED from the assessment's own status rather than stored
 * alongside it. A published or closed assessment is one the office has finished
 * with, and the screens refuse to edit or delete those; reading a separate boolean
 * would let the two disagree and permit an edit to something already issued.
 */
export function toExamRow(a: Assessment): ExamRow {
    return {
        id: a.id,
        type: a.type,
        date: a.assessmentDate ?? '',
        className: a.classDisplayName,
        classId: a.classId,
        subject: a.subjectName || a.title,
        isPublished: a.status === 'PUBLISHED' || a.status === 'CLOSED',
        teacherId: a.createdBy ?? undefined,
    };
}

/**
 * The form's wording, as a value the database accepts.
 *
 * The forms offer the words the school uses ("Mid-term", "Ujian"). The column is
 * an enum, so an unrecognised label becomes a class test rather than being written
 * as free text — which the database would refuse at the last moment with a message
 * nobody can act on.
 */
export function toAssessmentType(type: string): AssessmentType {
    const known: Record<string, AssessmentType> = {
        MIDTERM: 'MID_YEAR_EXAM',
        MIDYEAR: 'MID_YEAR_EXAM',
        FINAL: 'FINAL_EXAM',
        // IGCSE and CHECKPOINT were mapped here as Cambridge qualifications. This
        // school sits neither, so the mapping only ever named an exam that cannot
        // be set here. A stored value would be unknown and fall through below.
        QUIZ: 'QUIZ',
        TEST: 'TEST',
        UJIAN: 'TEST',
        ASSESSMENT: 'PBD',
        PBD: 'PBD',
    };
    const key = String(type || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    return known[key] ?? 'TEST';
}

/** The reverse, for showing a stored value in the school's own words. */
export function fromAssessmentType(type: string, labels: Record<string, string>): string {
    return labels[type] ?? type;
}
