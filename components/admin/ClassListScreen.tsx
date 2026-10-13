/**
 * Class list — SRIK.
 *
 * Rewritten from the multi-tenant original, which grouped classes by "grade"
 * and "section" (Nigerian forms and streams), offered to generate a "standard
 * class set", and gave every class a printable QR code for teachers to scan.
 * SRIK has none of that: classes are named (Al-Junaidi, Na'im, Ma'wa), each
 * belongs to a year level and an academic year, and the school does not use
 * classroom QR scanning.
 *
 * Grouping is by YEAR LEVEL, taken from its own database column. Class names are
 * labels the school renames whenever it likes, so nothing here reads meaning out
 * of the text — see `academics.ts`.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    StudentsIcon,
    ChevronRightIcon,
    gradeColors,
    BookOpenIcon,
    PlusIcon,
    EditIcon,
    TrashIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import { useAutoSync } from '../../hooks/useAutoSync';
import { listClasses, deleteClass, type ClassRecord } from '../../src/lib/supabase/academics';
import { listStudents } from '../../src/lib/supabase/students';

interface ClassListScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    schoolId?: string;
    currentBranchId?: string | null;
}

/** A student row, in the shape this screen renders. */
interface ClassStudentRow {
    id: string;
    name: string;
    admissionNo: string;
    avatarUrl: string;
    gender: string | null;
    birthDate: string | null;
    status: string;
}

const ClassListScreen: React.FC<ClassListScreenProps> = ({ navigateTo }) => {
    const { t } = useTranslation();
    const queryKey = ['classes'];
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const { data: classes = [], isLoading } = useQuery({
        queryKey,
        queryFn: () => listClasses(),
        enabled: Boolean(user),
    });

    useAutoSync(['classes'], () => {
        queryClient.invalidateQueries({ queryKey });
    });

    const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
    const [classStudents, setClassStudents] = useState<Record<string, ClassStudentRow[]>>({});
    const [loadingStudents, setLoadingStudents] = useState<Record<string, boolean>>({});

    /**
     * Loads a class's students on first expand.
     *
     * The whole roster is fetched and filtered here rather than fetched per
     * class. At SRIK's ~250 students that is cheaper than asking the database
     * again for every class the owner opens.
     */
    const toggleExpandClass = async (classId: string) => {
        if (expandedClassId === classId) {
            setExpandedClassId(null);
            return;
        }
        setExpandedClassId(classId);

        if (classStudents[classId] || loadingStudents[classId]) return;

        setLoadingStudents(prev => ({ ...prev, [classId]: true }));
        try {
            const roster = await listStudents();
            const rows: ClassStudentRow[] = roster
                .filter(s => s.classId === classId && s.status === 'ACTIVE')
                .map(s => ({
                    id: s.id,
                    name: s.fullName,
                    admissionNo: s.admissionNo,
                    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(s.fullName)}`,
                    gender: s.gender,
                    birthDate: s.birthDate,
                    status: s.status,
                }));
            setClassStudents(prev => ({ ...prev, [classId]: rows }));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not load the students.');
        } finally {
            setLoadingStudents(prev => ({ ...prev, [classId]: false }));
        }
    };

    const handleDeleteClass = async (cls: ClassRecord) => {
        // The confirmation names the class, so a wrong click is obvious before
        // anything is removed.
        if (!window.confirm(`Remove ${cls.displayName}? This cannot be undone.`)) return;

        const result = await deleteClass(cls.id);
        if (!result.success) {
            toast.error(result.error ?? 'Could not remove the class.');
            return;
        }
        toast.success(`${cls.displayName} was removed.`);
        await queryClient.invalidateQueries({ queryKey });
    };

    /**
     * Classes grouped by year level, ordered Year 1 upward.
     *
     * `yearLevel` is the database column, never a number read out of the name.
     */
    const byYear = useMemo(() => {
        const map = new Map<number, ClassRecord[]>();
        for (const c of classes) {
            if (!map.has(c.yearLevel)) map.set(c.yearLevel, []);
            map.get(c.yearLevel)!.push(c);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]);
    }, [classes]);

    const totalStudents = classes.reduce((n, c) => n + c.studentCount, 0);

    if (isLoading && classes.length === 0) {
        return <CenteredLoader fullScreen={false} message={t('classListScreen.loadingClasses')} className="h-screen" />;
    }

    return (
        <div className="flex flex-col h-full bg-gray-100 relative">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                <div className="flex justify-between items-center px-2">
                    <div className="flex flex-col">
                        <p className="text-sm font-bold text-gray-800">
                            {classes.length} {classes.length === 1 ? 'Class' : 'Classes'}
                        </p>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            {totalStudents} {totalStudents === 1 ? t('classListScreen.student') : t('classListScreen.students')} placed
                        </p>
                    </div>
                    <button
                        onClick={() => navigateTo('classForm', t('classListScreen.addNewClass'))}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Add Class
                    </button>
                </div>

                {byYear.map(([yearLevel, group], gi) => {
                    const colorClass = gradeColors[yearLevel] || 'bg-gray-200 text-gray-800';
                    const [bgColor, textColor] = colorClass.split(' ');
                    const yearTotal = group.reduce((n, c) => n + c.studentCount, 0);

                    return (
                        <motion.div
                            key={yearLevel}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(gi, 10) * 0.04 }}
                            className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100"
                        >
                            <div className={`${bgColor} p-4 flex items-center justify-between`}>
                                <h3 className={`font-bold text-lg ${textColor}`}>Year {yearLevel}</h3>
                                <span className={`text-xs font-bold ${textColor} opacity-80`}>
                                    {group.length} {group.length === 1 ? 'class' : 'classes'} · {yearTotal} students
                                </span>
                            </div>

                            <div className="p-4 space-y-3">
                                {group.map(cls => (
                                    <div
                                        key={cls.id}
                                        className={`w-full bg-gray-50 rounded-xl border transition-colors ${expandedClassId === cls.id ? 'border-indigo-200 ring-2 ring-indigo-100 bg-white' : 'border-gray-200/50 hover:bg-gray-100'}`}
                                    >
                                        <div className="flex items-center justify-between p-3">
                                            <button
                                                onClick={() => toggleExpandClass(cls.id)}
                                                className="flex items-center space-x-3 flex-grow text-left"
                                            >
                                                <div className={`p-2 rounded-lg border border-gray-200 transition-colors ${expandedClassId === cls.id ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-gray-500'}`}>
                                                    {expandedClassId === cls.id
                                                        ? <ChevronRightIcon className="h-5 w-5 rotate-90 transition-transform" />
                                                        : <StudentsIcon className={`h-5 w-5 ${textColor}`} />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <p className="font-bold text-gray-700 leading-tight">{cls.displayName}</p>
                                                        {cls.code && (
                                                            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs font-bold uppercase">
                                                                {cls.code}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-gray-400 font-medium">
                                                        {cls.studentCount} {cls.studentCount === 1 ? 'student' : 'students'}
                                                    </p>
                                                </div>
                                            </button>

                                            <div className="flex items-center space-x-1">
                                                <button
                                                    onClick={() => navigateTo('classForm', `Edit ${cls.displayName}`, { classToEdit: cls })}
                                                    aria-label={`Edit ${cls.displayName}`}
                                                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                >
                                                    <EditIcon className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteClass(cls)}
                                                    aria-label={`Remove ${cls.displayName}`}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {expandedClassId === cls.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="border-t border-gray-100 p-3 bg-gray-50/30 overflow-hidden"
                                                >
                                                    {loadingStudents[cls.id] ? (
                                                        <div className="py-4">
                                                            <CenteredLoader size="sm" className="min-h-[50px]" />
                                                        </div>
                                                    ) : (classStudents[cls.id]?.length || 0) > 0 ? (
                                                        <div className="space-y-3">
                                                            {classStudents[cls.id].map(student => (
                                                                <div
                                                                    key={student.id}
                                                                    className="w-full bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-indigo-200 transition-all"
                                                                >
                                                                    <div className="flex items-center gap-4">
                                                                        <img
                                                                            src={student.avatarUrl}
                                                                            alt={student.name}
                                                                            className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-50"
                                                                        />
                                                                        <div className="flex-1 min-w-0">
                                                                            <p className="text-sm font-bold text-gray-800 truncate">{student.name}</p>
                                                                            <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                                                                                {student.admissionNo}
                                                                            </p>
                                                                        </div>
                                                                        {student.gender && (
                                                                            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs font-bold uppercase">
                                                                                {student.gender === 'MALE' ? 'L' : 'P'}
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            onClick={() => navigateTo('studentProfileAdminView', student.name, {
                                                                                student: { id: student.id, name: student.name },
                                                                            })}
                                                                            aria-label={`Open ${student.name}`}
                                                                            className="p-1.5 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                                        >
                                                                            <ChevronRightIcon className="w-4 h-4" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-center py-6 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                                                            <p className="text-sm text-gray-400 italic font-medium">
                                                                No students in this class yet
                                                            </p>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    );
                })}

                {classes.length === 0 && !isLoading && (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                        <BookOpenIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold text-gray-800">{t('classListScreen.noClassesYet')}</h3>
                        <p className="text-gray-500 max-w-xs mx-auto mt-2">
                            Add the school's first class to begin placing students.
                        </p>
                        <button
                            onClick={() => navigateTo('classForm', t('classListScreen.addNewClass'))}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all mt-6"
                        >
                            <PlusIcon className="w-4 h-4 inline mr-2" />
                            Add First Class
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ClassListScreen;
