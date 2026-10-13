import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { getMarkRegister, saveMarks, type ResultStatus } from '../../src/lib/supabase/assessments';
import { Exam, Student } from '../../types';
import { CheckCircleIcon } from '../../constants';
import { useAutoSync } from '../../hooks/useAutoSync';

const getScoreIndicatorStyle = (scoreStr: string): string => {
    const score = parseInt(scoreStr, 10);
    if (scoreStr === '' || isNaN(score)) return 'border-gray-300 bg-gray-50 focus:bg-white';
    if (score >= 90) return 'border-green-400 bg-green-100 text-green-900 font-bold';
    if (score >= 75) return 'border-sky-400 bg-sky-100 text-sky-900 font-bold';
    if (score >= 60) return 'border-amber-400 bg-amber-100 text-amber-900 font-bold';
    return 'border-red-400 bg-red-100 text-red-900 font-bold';
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SaveStatusIndicator: React.FC<{ status: SaveStatus }> = ({ status }) => {
    const { t } = useTranslation();
    switch (status) {
        case 'saving':
            return <span className="text-sm text-gray-500 animate-pulse">{t('gradeEntryScreen.saving')}</span>;
        case 'saved':
            return <span className="text-sm text-green-600 flex items-center"><CheckCircleIcon className="w-4 h-4 mr-1" /> {t('gradeEntryScreen.allChangesSaved')}</span>;
        case 'error':
            return <span className="text-sm text-red-600">{t('gradeEntryScreen.someGradesCouldNotBeSavedReEnterThemToRetry')}</span>;
        default:
            return <span className="text-sm text-gray-400">{t('gradeEntryScreen.gradesWillAutoSave')}</span>;
    }
};

interface GradeEntryScreenProps {
    exam: Exam;
    handleBack?: () => void;
}

const GradeEntryScreen: React.FC<GradeEntryScreenProps> = ({ exam, handleBack }) => {
    const { t } = useTranslation();
    const [scores, setScores] = useState<{ [studentId: string | number]: string }>({});
    const [students, setStudents] = useState<Student[]>([]);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    const [loading, setLoading] = useState(true);
    // One debounce timer PER STUDENT. A single shared timer meant that typing a
    // score for the next student cancelled the pending save for the previous one,
    // silently discarding it.
    const debounceTimeoutsRef = useRef<Map<string | number, number>>(new Map());
    // Students whose most recent save attempt failed, so the indicator can stay in
    // the error state until every outstanding save has succeeded.
    const failedSavesRef = useRef<Set<string | number>>(new Set());

    // Never leave timers running against an unmounted screen.
    useEffect(() => {
        const timeouts = debounceTimeoutsRef.current;
        return () => {
            timeouts.forEach(id => clearTimeout(id));
            timeouts.clear();
        };
    }, []);

    /**
     * The children in this exam's class, and the marks already recorded.
     *
     * This called `api.getStudentsByClassId` and `api.getGrades` on an Express
     * server that is not deployed, so the sheet was empty and nothing saved.
     *
     * It also guessed the roster from a class NAME by regex — "JSS 1" yielded grade
     * 1, which was never the real year level. The class ID the exam carries is the
     * authoritative source, and there is no fallback: guessing which children sat
     * an exam is not something to do quietly.
     */
    const fetchData = useCallback(async () => {
        if (!exam?.id) return;
        setLoading(true);
        try {
            const register = await getMarkRegister(exam.id);

            setStudents(register.rows.map((r) => ({
                id: r.studentId,
                full_name: r.studentName,
                name: r.studentName,
                school_generated_id: r.admissionNo,
                avatar_url: undefined,
            } as unknown as Student)));

            // A mark that does not exist is NOT zero. Only what has actually been
            // recorded is filled in, so the boxes a teacher has not touched stay
            // empty and `saveMarks` can tell "not entered" from "scored zero".
            const scoreMap: { [key: string]: string } = {};
            for (const row of register.rows) {
                if (row.score !== null) scoreMap[row.studentId] = String(row.score);
            }
            setScores(scoreMap);
        } catch (err) {
            console.error('Error loading grade entry data:', err);
            toast.error(err instanceof Error ? err.message : 'Could not load the marks.');
        } finally {
            setLoading(false);
        }
    }, [exam?.id]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Auto-sync
    useAutoSync(['assessment_results', 'assessments'], fetchData);

    /**
     * Save one child's mark.
     *
     * The database owns the rules — it refuses a mark from a teacher who does not
     * teach this class and this subject, and it refuses to touch a published
     * assessment. Those refusals are surfaced rather than swallowed: a teacher who
     * is told "saved" when nothing was written stops checking.
     */
    const saveGrade = async (studentId: string | number, value: string) => {
        if (!exam?.id) return;
        const numericScore = parseInt(value, 10);

        try {
            await saveMarks(exam.id, [{
                studentId: String(studentId),
                // These three are display fields on a READ row and `saveMarks`
                // ignores them; they are supplied because the row shape carries them.
                studentName: '',
                admissionNo: '',
                // An empty box CLEARS the mark rather than scoring zero — "nobody has
                // said anything yet" and "this child scored nothing" are different
                // facts, and only one of them belongs on a report card.
                status: (value === '' ? 'NOT_ENTERED' : 'GRADED') as ResultStatus,
                score: value === '' || Number.isNaN(numericScore) ? null : numericScore,
                tp: null,
                comment: null,
            }]);

            failedSavesRef.current.delete(studentId);
            if (failedSavesRef.current.size === 0 && debounceTimeoutsRef.current.size === 0) {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev)), 2000);
            }
        } catch (err) {
            // Without this the status was left on 'saving' forever, which also kept
            // the Done button disabled — the teacher was trapped on the screen and
            // never told the grade had not been saved.
            console.error(`Failed to auto-save grade for student ${studentId}`, err);
            failedSavesRef.current.add(studentId);
            setSaveStatus('error');
            toast.error(
                err instanceof Error && err.message
                    ? err.message
                    : 'A grade could not be saved. Re-enter it to try again.',
            );
        }
    };

    const handleScoreChange = (studentId: string | number, value: string) => {
        const numericValue = parseInt(value, 10);
        if (value === '' || (numericValue >= 0 && numericValue <= 100)) {
            setScores(prev => ({ ...prev, [studentId]: value }));

            const timeouts = debounceTimeoutsRef.current;
            const pending = timeouts.get(studentId);
            if (pending) clearTimeout(pending);

            setSaveStatus('saving');

            timeouts.set(studentId, window.setTimeout(() => {
                timeouts.delete(studentId);
                if (value !== '') {
                    saveGrade(studentId, value);
                }
            }, 1200));
        }
    };


    if (!exam) return <div className="flex items-center justify-center min-h-[40vh] p-8 text-center text-gray-500">{t('gradeEntryScreen.selectAnExamToEnterGrades')}</div>;

    return (
        <div className="flex flex-col h-full bg-gray-100">
            {/* Header section */}
            <div className="p-4 bg-white border-b border-gray-200">
                <h3 className="font-bold text-lg text-gray-800">{exam.subject} - {exam.type}</h3>
                <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-500">{exam.className}</p>
                    <SaveStatusIndicator status={saveStatus} />
                </div>
            </div>

            {/* Student List */}
            <main className="flex-grow overflow-y-auto">
                {loading ? (
                    <div className="p-10 text-center text-gray-500">{t('gradeEntryScreen.loadingStudentList')}</div>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {students.map(student => (
                            <li key={student.id} className="p-4 flex items-center justify-between bg-white hover:bg-gray-50">
                                <div className="flex items-center space-x-4">
                                    {student.avatarUrl ? (
                                        <img src={student.avatarUrl} alt={student.name} className="w-12 h-12 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                            <span className="font-bold">{student.name.charAt(0)}</span>
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-bold text-gray-800">{student.name}</p>
                                        <p className="text-sm text-gray-500">ID: {student.schoolGeneratedId || t('gradeEntryScreen.pending')}</p>
                                    </div>
                                </div>
                                <input
                                    type="number"
                                    value={scores[student.id] || ''}
                                    onChange={(e) => handleScoreChange(student.id, e.target.value)}
                                    placeholder="--"
                                    max={100}
                                    min={0}
                                    aria-label={`Score for ${student.name}`}
                                    className={`w-16 sm:w-20 h-12 text-center text-lg rounded-lg border-2 transition-colors ${getScoreIndicatorStyle(scores[student.id] || '')}`}
                                />
                            </li>
                        ))}
                        {students.length === 0 && (
                            <div className="text-center py-10 bg-white">
                                <p className="text-gray-500">No students found for this class ({exam.className}).</p>
                            </div>
                        )}
                    </ul>
                )}
            </main>

            {/* Footer action button — grades already autosave per score (see
                SaveStatusIndicator above), so this just confirms the teacher is
                done and takes them back rather than performing a separate "submit". */}
            <div className="p-4 bg-white border-t border-gray-200">
                <button
                    onClick={() => handleBack?.()}
                    disabled={saveStatus === 'saving'}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-gray-400"
                >
                    Done
                </button>
            </div>
        </div>
    );
};

export default GradeEntryScreen;
