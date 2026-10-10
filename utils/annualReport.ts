import { ReportCard, ReportCardAcademicRecord } from '../types';

/**
 * The three terms every school year is built from, in order.
 *
 * These strings are KEYS, not labels: a report card is filed under one of them
 * and the annual view finds it by matching. So a term named "First Term" is
 * invisible to a school that calls it "Penggal 1", and the annual report comes
 * back empty — which reads as "no results" rather than "the names disagree".
 */
export const CANONICAL_TERMS = ['Penggal 1', 'Penggal 2', 'Penggal 3'];

/**
 * A grade from a total, on the school's scale.
 *
 * The bands here were A 70, B 60, C 50, D 45, F — a FOURTH scale in the
 * codebase, and the only one that ends in F. The school agreed in phase 4:
 * A 80, B 65, C 50, D 35, E below that. A grade computed for an annual report
 * has to agree with the one printed on the term report card it summarises, or
 * the same marks produce two different letters.
 */
export function gradeFromTotal(total: number): string {
    if (total >= 80) return 'A';
    if (total >= 65) return 'B';
    if (total >= 50) return 'C';
    if (total >= 35) return 'D';
    return 'E';
}

/**
 * Combines a set of already-published term report cards (Penggal 1/2/3, same
 * session) into one cumulative result — the standard "annual" view shown
 * alongside a Penggal 3 report card. Each subject's total is
 * the average of whichever terms actually have a score for it, so a
 * subject missing one term's result still gets averaged from the terms it
 * does have rather than being blocked entirely. Attendance is summed
 * across the terms used, since it's a running count for the whole session
 * rather than a per-term rate.
 */
export function buildAnnualReportCard(termReports: ReportCard[]): ReportCard | null {
    const usable = termReports.filter(r => CANONICAL_TERMS.includes(r.term));
    if (usable.length === 0) return null;

    const bySubject = new Map<string, number[]>();
    usable.forEach(r => {
        (r.academicRecords || []).forEach(rec => {
            const total = Number(rec.total);
            if (!rec.subject || Number.isNaN(total)) return;
            if (!bySubject.has(rec.subject)) bySubject.set(rec.subject, []);
            bySubject.get(rec.subject)!.push(total);
        });
    });

    const academicRecords: ReportCardAcademicRecord[] = Array.from(bySubject.entries()).map(([subject, totals]) => {
        const avg = Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10;
        return {
            subject,
            test1: 0,
            test2: 0,
            exam: 0,
            total: avg,
            grade: gradeFromTotal(avg),
            remark: '',
        };
    });

    const attendance = usable.reduce((acc, r) => ({
        total: acc.total + (r.attendance?.total || 0),
        present: acc.present + (r.attendance?.present || 0),
        absent: acc.absent + (r.attendance?.absent || 0),
        late: acc.late + (r.attendance?.late || 0),
    }), { total: 0, present: 0, absent: 0, late: 0 });

    const last = usable[usable.length - 1];
    return {
        term: 'Third Term',
        session: last.session,
        academicRecords,
        skills: {},
        psychomotor: {},
        attendance,
        teacherComment: '',
        principalComment: '',
        status: 'Published',
    };
}
