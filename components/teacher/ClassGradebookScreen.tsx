import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useAutoSync } from '../../hooks/useAutoSync';
import { listClassOptions } from '../../src/lib/supabase/academics';
import { listAssessments, getMarkRegister, getCurrentTerm } from '../../src/lib/supabase/assessments';

/**
 * AUDIT F27 — a class gradebook that reads the school's marks.
 *
 * WHAT THIS REPLACED, and why it is a summary rather than a form. The previous
 * screen was an editable grid of `test1 (20) + test2 (20) + exam (60)`, typed
 * straight into a report card, saved through an Express endpoint that is not
 * deployed. Two things were wrong with that beyond the dead endpoint:
 *
 * 1. It invented its own assessment structure. SRIK records marks against real
 *    assessments — an Ujian or a PBD that the office schedules for a class, a
 *    subject and a term. A grid whose columns are fixed at two tests and an exam
 *    cannot represent a school that schedules something else, and the marks in it
 *    were not attached to any assessment at all.
 *
 * 2. It let a teacher type the report card. In SRIK a report card is a SNAPSHOT
 *    the database builds from the marks and freezes, so what was sent home can
 *    always be shown again. A hand-typed card has no such guarantee.
 *
 * So the marks are entered where they belong — the "Enter Grades" screen, which
 * writes to `assessment_results` — and this screen SHOWS them. It is the honest
 * shape for what a gradebook is for: seeing where a class stands.
 */
interface MarksSummary {
    studentId: string;
    studentName: string;
    admissionNo: string;
    /** Per assessment title, the percentage, or null when not recorded. */
    marks: Record<string, number | null>;
    /** The average of the marks that exist, or null when there are none. */
    average: number | null;
    /** How many assessments this child has a decided result for. */
    recorded: number;
}

const ClassGradebookScreen: React.FC<{
    teacherId?: string;
    schoolId?: string;
    currentBranchId?: string;
    classInfo?: { id: string, grade: number, section: string, subject: string, studentCount?: number };
    handleBack: () => void;
}> = ({ classInfo, handleBack }) => {
    const { t } = useTranslation();
    const [classes, setClasses] = useState<{ id: string; label: string }[]>(
        classInfo ? [{ id: classInfo.id, label: `${classInfo.grade}${classInfo.section ? ' ' + classInfo.section : ''}` }] : [],
    );
    const [selectedClass, setSelectedClass] = useState<string>(classInfo?.id || '');
    const [rows, setRows] = useState<MarksSummary[]>([]);
    const [assessmentTitles, setAssessmentTitles] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    // The classes this teacher can see. Row level security decides which; this
    // only fills the picker.
    useEffect(() => {
        if (classInfo) return;
        listClassOptions()
            .then(list => setClasses(list))
            .catch(err => console.error('Could not load the classes:', err));
    }, [classInfo]);

    const loadData = async () => {
        if (!selectedClass) return;
        setLoading(true);
        try {
            const term = await getCurrentTerm();
            if (!term) {
                setRows([]);
                setAssessmentTitles([]);
                return;
            }

            // Filtered by subject when the caller named one, so a teacher opening
            // this from a subject shows that subject rather than the whole class.
            const assessments = await listAssessments(term.id, { classId: selectedClass });
            const relevant = classInfo?.subject
                ? assessments.filter(
                      a =>
                          a.subjectName === classInfo.subject ||
                          a.title === classInfo.subject ||
                          a.subjectCode === classInfo.subject,
                  )
                : assessments;

            if (relevant.length === 0) {
                setRows([]);
                setAssessmentTitles([]);
                return;
            }

            const registers = await Promise.all(
                relevant.map(a => getMarkRegister(a.id).catch(() => null)),
            );

            const byStudent = new Map<string, MarksSummary>();
            relevant.forEach((assessment, i) => {
                const reg = registers[i];
                if (!reg) return;
                const max = assessment.maxScore || 100;
                for (const row of reg.rows) {
                    const entry = byStudent.get(row.studentId) ?? {
                        studentId: row.studentId,
                        studentName: row.studentName,
                        admissionNo: row.admissionNo,
                        marks: {},
                        average: null,
                        recorded: 0,
                    };
                    // A missing mark is NOT a zero, and neither is an absence or an
                    // exemption. Only a recorded score enters the average, so a child
                    // who has not been marked yet does not appear to be failing.
                    if (row.status === 'GRADED' && row.score !== null && max > 0) {
                        entry.marks[assessment.title] =
                            Math.round((Number(row.score) / max) * 1000) / 10;
                        entry.recorded += 1;
                    } else {
                        entry.marks[assessment.title] = null;
                    }
                    byStudent.set(row.studentId, entry);
                }
            });

            const list = Array.from(byStudent.values());
            for (const entry of list) {
                const values = Object.values(entry.marks).filter(
                    (v): v is number => v !== null,
                );
                entry.average = values.length
                    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
                    : null;
            }
            // Sorted by name so the sheet does not reorder itself between loads.
            list.sort((a, b) => a.studentName.localeCompare(b.studentName));

            setRows(list);
            setAssessmentTitles(relevant.map(a => a.title));
        } catch (err) {
            console.error('Error loading gradebook:', err);
            toast.error(err instanceof Error ? err.message : 'Could not load the marks.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedClass, classInfo?.subject]);

    useAutoSync(['assessment_results', 'assessments'], loadData);

    const wholeClassAverage = useMemo(() => {
        const values = rows.map(r => r.average).filter((v): v is number => v !== null);
        if (values.length === 0) return null;
        return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    }, [rows]);

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <header className="p-4 bg-white border-b border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-800">{t('classGradebookScreen.gradebook')}</h2>
                    <button
                        onClick={handleBack}
                        className="text-sm font-semibold text-purple-600 hover:text-purple-800"
                    >
                        Back
                    </button>
                </div>
                {!classInfo && (
                    <select
                        value={selectedClass}
                        onChange={e => setSelectedClass(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
                    >
                        <option value="" disabled>{t('classGradebookScreen.selectAClass')}</option>
                        {classes.map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                )}
                {/* The whole-class average is shown only when at least one child has
                    a mark. "—" otherwise, rather than 0%, which would read as a
                    failing class instead of an unmarked one. */}
                {rows.length > 0 && (
                    <p className="text-sm text-gray-600">
                        Class average:{' '}
                        <span className="font-semibold text-purple-700">
                            {wholeClassAverage === null ? '—' : `${wholeClassAverage}%`}
                        </span>
                    </p>
                )}
            </header>

            <main className="flex-grow p-4 overflow-auto">
                {loading ? (
                    <p className="text-center py-6 text-gray-500">{t('classGradebookScreen.loadingMarks')}</p>
                ) : rows.length === 0 ? (
                    <div className="text-center py-10 space-y-2">
                        <p className="text-gray-600 font-medium">{t('classGradebookScreen.noMarksRecordedYet')}</p>
                        <p className="text-sm text-gray-500">
                            Marks are entered from a scheduled exam or PBD, using
                            &ldquo;Enter Grades&rdquo;. Nothing has been scheduled for this class yet.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto bg-white rounded-xl shadow-sm">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-left text-gray-600">
                                    <th className="px-3 py-2 font-semibold">{t('classGradebookScreen.student')}</th>
                                    {assessmentTitles.map(title => (
                                        <th key={title} className="px-3 py-2 font-semibold">{title}</th>
                                    ))}
                                    <th className="px-3 py-2 font-semibold">{t('classGradebookScreen.average')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.studentId} className="border-b border-gray-100">
                                        <td className="px-3 py-2">
                                            <p className="font-medium text-gray-800">{row.studentName}</p>
                                            <p className="text-xs text-gray-500">{row.admissionNo}</p>
                                        </td>
                                        {assessmentTitles.map(title => {
                                            const mark = row.marks[title];
                                            return (
                                                <td key={title} className="px-3 py-2 text-gray-700">
                                                    {mark === null || mark === undefined ? '—' : `${mark}%`}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 font-semibold text-purple-700">
                                            {row.average === null ? '—' : `${row.average}%`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ClassGradebookScreen;
