import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { EXAM_TYPE_COLORS, EnterResultsIcon } from '../../constants';
import { Exam } from '../../types';
import {
    ASSESSMENT_TYPE_LABELS,
    listAssessments,
    getCurrentTerm,
    type AssessmentType,
} from '../../src/lib/supabase/assessments';
import { toExamRow } from '../../src/lib/supabase/exams';
import { useAutoSync } from '../../hooks/useAutoSync';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useProfile } from '../../context/ProfileContext';


interface TeacherExamManagementProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    forceUpdate: () => void;
    handleBack: () => void;
    schoolId: string;
    teacherId: string | null;
    branchId?: string | null;
}

const TeacherExamManagement: React.FC<TeacherExamManagementProps> = ({ navigateTo, forceUpdate, handleBack, schoolId, teacherId, branchId }) => {
    const { t } = useTranslation();
    const { profile } = useProfile();
    const [exams, setExams] = useState<Exam[]>([]);
    const [loading, setLoading] = useState(true);

    /**
     * The exams the school has recorded, read from the database.
     *
     * This called `api.getExams(schoolId, branchId, teacherId)` on an Express server
     * that is not deployed, so the grid was empty for everyone. Two of those
     * arguments explain the old shape and are gone: SRIK is one school, so there is
     * no branch to filter by.
     */
    const fetchExams = async () => {
        setLoading(true);
        try {
            // An assessment belongs to a TERM, so the term has to be known before
            // anything can be listed. Without one the school has no exams yet,
            // which is an empty grid rather than an error.
            const term = await getCurrentTerm();
            if (!term) {
                setExams([]);
                return;
            }

            const all = await listAssessments(term.id);
            // A teacher sees the exams for the classes they teach. The list is
            // filtered here rather than in the query because the same loader feeds
            // the office's screen, which must see all of them.
            const mine = teacherId
                ? all.filter(a => a.createdBy === teacherId)
                : all;
            setExams(mine.map(toExamRow));
        } catch (error: any) {
            toast.error(error.message || 'Failed to load exams');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExams();
        // Note what is NOT here: `schoolId`, `branchId`, `profile?.branchId`. The
        // old dependencies included a branch that never changes and a school id
        // that is now only used by the layout, so the grid re-fetched on renders
        // that could not have changed the answer.
    }, [teacherId]);

    // Auto-sync when exams change
    useAutoSync(['assessments'], () => {
        fetchExams();
    });

    useRealtimeRefresh(['assessments'], fetchExams);

    return (
        <div className="flex flex-col h-full bg-gray-100 relative">
            <main className="flex-grow p-4 overflow-y-auto pb-20">
                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {exams.map(exam => (
                            <div key={exam.id} className="bg-white rounded-xl shadow-sm p-4 flex flex-col justify-between space-y-3">
                                <div>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-bold text-gray-800">{exam.subject}</p>
                                            <p className="text-sm text-gray-500">{exam.className}</p>
                                        </div>
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${EXAM_TYPE_COLORS[exam.type] || 'bg-gray-100 text-gray-800 border-gray-300'}`}>
                                            {/* The school's own wording, not the database's
                                                constant: "Peperiksaan Pertengahan Tahun" is
                                                what a teacher calls it, MID_YEAR_EXAM is not. */}
                                            {ASSESSMENT_TYPE_LABELS[exam.type as AssessmentType] ?? exam.type}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <p className="text-sm font-medium">Status:
                                            {exam.isPublished
                                                ? <span className="text-green-600 ml-1">{t('teacherExamManagement.published')}</span>
                                                : <span className="text-amber-600 ml-1">{t('teacherExamManagement.pending')}</span>
                                            }
                                        </p>
                                        <p className="text-sm text-gray-600 font-medium">{new Date(exam.date).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                                    <button
                                        onClick={() => navigateTo('gradeEntry', `Grades: ${exam.subject}`, { exam })}
                                        className="text-green-600 p-1 flex items-center space-x-1.5 text-sm font-semibold hover:bg-green-50 rounded-md"
                                    >
                                        <EnterResultsIcon className="w-5 h-5" />
                                        <span>{t('teacherExamManagement.enterGrades')}</span>
                                    </button>
                                    {/* NO EDIT OR DELETE HERE, deliberately.
                                        A teacher holds `assessments.enter_scores` but
                                        not `assessments.create`, and the database
                                        enforces that: an insert is refused by row level
                                        security. Offering buttons that cannot work is
                                        how a teacher concludes the system is broken
                                        rather than that the office owns this step. */}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && exams.length === 0 && <p className="text-center text-gray-500 py-8">{t('teacherExamManagement.noExamsHaveBeenScheduledForYourClassesYet')}</p>}
            </main>

        </div>
    );
};

export default TeacherExamManagement;
