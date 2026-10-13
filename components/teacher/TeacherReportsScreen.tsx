
import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Student, ClassInfo } from '../../types';
import { ChevronLeftIcon, AIIcon, getFormattedClassName } from '../../constants';
import { listStudents } from '../../src/lib/supabase/students';
import {
    listAssessments,
    getMarkRegister,
    getCurrentTerm,
} from '../../src/lib/supabase/assessments';
import { getClassAttendanceSummary } from '../../src/lib/supabase/attendance';
import { useProfile } from '../../context/ProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useTeacherClasses } from '../../hooks/useTeacherClasses';

interface TeacherReportsScreenProps {
    navigateTo: (view: string, title: string, props: any) => void;
    teacherId?: string | null;
    teacherProfile?: any;
}

const TeacherReportsScreen: React.FC<TeacherReportsScreenProps> = ({ navigateTo, teacherId, teacherProfile }) => {
    const { t } = useTranslation();
    const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
    const [students, setStudents] = useState<Student[]>([]);

    // New Hook for classes
    const { classes: rawClasses, loading: loadingClasses } = useTeacherClasses(teacherId);
    
    // Deduplicate classes by formatted name
    const classes = useMemo(() => {
        const groups = new Map<string, ClassInfo>();
        rawClasses.forEach(cls => {
            const name = getFormattedClassName(cls.grade, cls.section);
            const existing = groups.get(name);
            if (existing) {
                existing.studentCount += (cls.studentCount || 0);
            } else {
                groups.set(name, { ...cls });
            }
        });
        return Array.from(groups.values());
    }, [rawClasses]);

    const [loadingStudents, setLoadingStudents] = useState(false);

    // Combine loading states
    const loading = loadingClasses || loadingStudents;

    const { profile } = useProfile();

    // Fetch Students & Stats when class selected
    useEffect(() => {
        if (!selectedClass) return;

        const fetchStudentsAndStats = async () => {
            setLoadingStudents(true);
            try {
                // The children in this class, read from the database.
                //
                // This called `api.getStudentsByClass(schoolId, grade, section)` — an
                // Express endpoint with no server behind it, matched on grade and
                // SECTION as text. That match is why the list was empty even before
                // the server went away: SRIK identifies a class by id and its labels
                // are the school's to rename.
                const all = await listStudents();
                const roster = all.filter(r => r.classId === selectedClass.id);

                if (roster.length === 0) {
                    setStudents([]);
                    return;
                }

                // Averages come from the marks actually recorded for this term, and
                // attendance from the register. Both are read rather than estimated:
                // `api.getStudentReportStats(id)` returned a ready-made summary from
                // a server that is not there, and inventing one here would put a
                // number in front of a teacher that nothing in the school supports.
                const term = await getCurrentTerm();

                // Attendance first, in ONE read for the whole class rather than one
                // per child. A class of thirty would otherwise make thirty round
                // trips, and the screen would sit on "Loading student data..." for
                // seconds on a school connection.
                const attendanceByStudent = new Map<string, number>();
                if (term) {
                    const summary = await getClassAttendanceSummary(
                        selectedClass.id,
                        term.startDate,
                        term.endDate,
                    ).catch(() => []);
                    for (const row of summary) {
                        attendanceByStudent.set(
                            row.studentId,
                            Math.round(row.attendanceRate * 10) / 10,
                        );
                    }
                }

                // Marks: every assessment for this class this term.
                const perStudent = new Map<string, number[]>();
                if (term) {
                    const assessments = await listAssessments(term.id, {
                        classId: selectedClass.id,
                    });
                    const registers = await Promise.all(
                        assessments.map(a => getMarkRegister(a.id).catch(() => null)),
                    );
                    for (const reg of registers) {
                        if (!reg) continue;
                        const max = reg.assessment.maxScore || 100;
                        for (const row of reg.rows) {
                            // A missing mark is NOT a zero. Only marks that exist are
                            // averaged, or a child who has not been marked yet appears
                            // to be failing.
                            if (row.score === null || max <= 0) continue;
                            const list = perStudent.get(row.studentId) ?? [];
                            list.push((Number(row.score) / max) * 100);
                            perStudent.set(row.studentId, list);
                        }
                    }
                }

                setStudents(roster.map((r): any => {
                    const marks = perStudent.get(r.id) ?? [];
                    return {
                        id: r.id,
                        name: r.fullName,
                        avatarUrl: null,
                        grade: r.yearLevel ?? selectedClass.grade,
                        section: selectedClass.section,
                        schoolId: r.admissionNo,
                        // null, not 0: no marks recorded yet is not an average of
                        // zero, and a teacher reading "0%" would act on it.
                        gradeAverage: marks.length
                            ? Math.round((marks.reduce((a, b) => a + b, 0) / marks.length) * 10) / 10
                            : null,
                        // null, not 100: a child with no register entries has an
                        // unknown rate, and showing 100% would claim perfect
                        // attendance nobody recorded.
                        attendancePercentage: attendanceByStudent.get(r.id) ?? null,
                    };
                }));
            } catch (err) {
                console.error(err);
            } finally {
                setLoadingStudents(false);
            }
        };

        fetchStudentsAndStats();

    }, [selectedClass]);

    if (loading && !selectedClass && classes.length === 0) return <div className="p-10 text-center">{t('teacherReportsScreen.loadingClasses')}</div>;

    if (!selectedClass) {
        return (
            <div className="p-4 space-y-4">
                <h3 className="text-xl font-bold text-gray-800">{t('teacherReportsScreen.selectAClassToViewReports')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {classes.map(cls => (
                        <button key={cls.id} onClick={() => setSelectedClass(cls)} className="p-6 bg-white rounded-xl shadow-sm text-center hover:bg-purple-50 transition-colors flex flex-col items-center justify-center space-y-2">
                            <p className="font-bold text-2xl text-purple-700">{getFormattedClassName(cls.grade, cls.section)}</p>
                            <p className="text-sm font-medium text-gray-700">{cls.subject}</p>
                            <p className="text-xs text-gray-500">{cls.studentCount} Students</p>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <header className="p-4 bg-white border-b border-gray-200">
                <button onClick={() => setSelectedClass(null)} className="flex items-center space-x-1 text-sm font-semibold text-purple-600 hover:text-purple-800">
                    <ChevronLeftIcon className="w-5 h-5" />
                    <span>{t('teacherReportsScreen.allClasses')}</span>
                </button>
                <div className="mt-2">
                    <h2 className="text-xl font-bold text-gray-800">Reports: {getFormattedClassName(selectedClass.grade, selectedClass.section)}</h2>
                </div>
                <button
                    onClick={() => navigateTo('aiPerformanceSummary', 'AI Class Summary', { students: students })}
                    className="mt-3 w-full flex items-center justify-center space-x-2 py-2 px-4 bg-purple-600 text-white font-semibold rounded-xl shadow-md hover:bg-purple-700 transition-colors">
                    <AIIcon className="w-5 h-5" />
                    <span>{t('teacherReportsScreen.generateAIClassSummary')}</span>
                </button>
            </header>
            <main className="flex-grow p-4 space-y-3 overflow-y-auto">
                {loading ? <div className="text-center py-4">{t('teacherReportsScreen.loadingStudentData')}</div> : (
                    students.length > 0 ? students.map((student: any) => (
                        <div key={student.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center space-x-3">
                            {student.avatarUrl ? (
                                <img src={student.avatarUrl} alt={student.name} className="w-12 h-12 rounded-full object-cover" />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-500 font-bold">
                                    {student.name.charAt(0)}
                                </div>
                            )}
                            <div className="flex-grow">
                                <p className="font-bold text-gray-800">{student.name}</p>
                                <div className="flex items-center space-x-3 text-sm text-gray-500">
                                    {/* "—" for a value nobody has recorded, rather than
                                        "0%". A teacher seeing 0% would act on it: chase a
                                        child for failing when no mark exists yet, or for
                                        absence on days no register was taken. */}
                                    <span>{t('teacherReportsScreen.avgScore')} <span className="font-semibold text-purple-700">{student.gradeAverage === null ? '—' : `${student.gradeAverage}%`}</span></span>
                                    <span>{t('teacherReportsScreen.attendance')} <span className="font-semibold text-purple-700">{student.attendancePercentage === null ? '—' : `${student.attendancePercentage}%`}</span></span>
                                </div>
                            </div>
                        </div>
                    )) : <div className="text-center py-10 text-gray-500">{t('teacherReportsScreen.noStudentsInThisClass')}</div>
                )}
            </main>
        </div>
    );
};

export default TeacherReportsScreen;

