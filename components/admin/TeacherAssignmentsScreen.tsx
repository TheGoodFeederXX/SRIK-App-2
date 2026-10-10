/**
 * Teacher duties — SRIK.
 *
 * Rewritten from the multi-tenant original. It posted to raw REST endpoints
 * (`/teacher-assignments/class-teacher`, `/subject-teacher`), kept a
 * "co-class teachers" setting, and modelled a school year as a "session" with
 * numbered terms. None of that applies here: SRIK uses academic years, and a
 * teacher's duties are a set that is replaced as a whole.
 *
 * Why the whole set is replaced at once: a teacher's duties are edited as a
 * list ("these are your classes and subjects"). Applying the list wholesale is
 * what the owner means, and it is also what the `set_teacher_assignments` RPC
 * does — closing the previous duties and opening the new ones in one audited
 * step, so the old set is kept as history rather than deleted.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    BookOpen, BarChart3, UserCheck, Users, PlusIcon, ArrowLeft, XIcon, Trash2,
} from 'lucide-react';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listTeachers,
    listAssignments,
    setTeacherAssignments,
    getCurrentAcademicYearId,
    getTeacherDuties,
    type TeacherRecord,
    type AssignmentRecord,
} from '../../src/lib/supabase/teachers';
import { listClassOptions, listSubjectOptions, type ClassOption } from '../../src/lib/supabase/academics';

interface TeacherAssignmentsScreenProps {
    /** When opened from a teacher's page: scopes everything to that teacher. */
    teacherId?: string;
    teacherName?: string;
    handleBack?: () => void;
}

const TABS = [
    { key: 'class', label: 'Class Teachers', icon: <UserCheck className="w-4 h-4" /> },
    { key: 'subject', label: 'Subject Teachers', icon: <BookOpen className="w-4 h-4" /> },
    { key: 'workload', label: 'Workload', icon: <BarChart3 className="w-4 h-4" /> },
] as const;

type TabKey = typeof TABS[number]['key'];

/** A teacher's duties summarised for the workload view. */
interface WorkloadRow {
    teacherId: string;
    teacherName: string;
    staffCode: string;
    /** Classes this teacher is responsible for. */
    classTeacherOf: string[];
    /** What they teach, e.g. "Matematik · 3 Al-Junaidi". */
    subjectClasses: string[];
    totalPeriods: number;
    level: 'Light' | 'Balanced' | 'Heavy';
}

const TeacherAssignmentsScreen: React.FC<TeacherAssignmentsScreenProps> = ({
    teacherId,
    teacherName,
    handleBack,
}) => {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const [tab, setTab] = useState<TabKey>(teacherId ? 'class' : 'class');
    const [showAssign, setShowAssign] = useState(false);
    const [form, setForm] = useState<{ teacherId: string; classIds: string[]; subjectIds: string[]; isClassTeacher: boolean }>(
        { teacherId: teacherId ?? '', classIds: [], subjectIds: [], isClassTeacher: false }
    );
    const [isSaving, setIsSaving] = useState(false);

    const teachersQuery = useQuery({
        queryKey: ['teachers'],
        queryFn: () => listTeachers(),
        enabled: Boolean(user),
    });

    const assignmentsQuery = useQuery({
        queryKey: ['assignments'],
        queryFn: () => listAssignments(),
        enabled: Boolean(user),
    });

    const classesQuery = useQuery({
        queryKey: ['classOptions'],
        queryFn: () => listClassOptions(),
        enabled: Boolean(user),
    });

    const subjectsQuery = useQuery({
        queryKey: ['subjectOptions'],
        queryFn: () => listSubjectOptions(),
        enabled: Boolean(user),
    });

    const teachers = teachersQuery.data ?? [];
    const assignments = assignmentsQuery.data ?? [];
    const classes: ClassOption[] = classesQuery.data ?? [];
    const subjects: ClassOption[] = subjectsQuery.data ?? [];

    const isLoading =
        teachersQuery.isLoading || assignmentsQuery.isLoading ||
        classesQuery.isLoading || subjectsQuery.isLoading;

    const refreshAll = async () => {
        await queryClient.invalidateQueries({ queryKey: ['assignments'] });
        await queryClient.invalidateQueries({ queryKey: ['teachers'] });
    };

    /** The current duties grouped for display. */
    const classTeacherRows = useMemo(
        () => assignments.filter(a => a.type === 'CLASS_TEACHER'),
        [assignments]
    );
    const subjectTeacherRows = useMemo(
        () => assignments.filter(a => a.type === 'SUBJECT_TEACHER'),
        [assignments]
    );

    /**
     * One row per teacher, summarising their load.
     *
     * "Balanced" thresholds are a guide for the owner, not a rule the system
     * enforces: what counts as heavy depends on the school, so nothing is
     * blocked based on this.
     */
    const workload = useMemo<WorkloadRow[]>(() => {
        const rows: WorkloadRow[] = teachers.map(t => {
            const mine = assignments.filter(a => a.teacherId === t.id);
            const periods = mine.reduce((n, a) => n + (a.periodsPerWeek ?? 0), 0);
            return {
                teacherId: t.id,
                teacherName: t.fullName,
                staffCode: t.staffCode,
                classTeacherOf: mine.filter(a => a.type === 'CLASS_TEACHER').map(a => a.className),
                subjectClasses: mine
                    .filter(a => a.type === 'SUBJECT_TEACHER')
                    .map(a => `${a.subjectName ?? 'Subject'} · ${a.className}`),
                totalPeriods: periods,
                level: periods === 0 ? 'Light' : periods <= 20 ? 'Balanced' : 'Heavy',
            };
        });
        return rows.sort((a, b) => b.totalPeriods - a.totalPeriods);
    }, [teachers, assignments]);

    const teacherById = useMemo(
        () => new Map(teachers.map(t => [t.id, t])),
        [teachers]
    );

    const openAssign = (type: 'class' | 'subject', forTeacherId?: string) => {
        setForm({
            teacherId: forTeacherId ?? teacherId ?? '',
            classIds: [],
            subjectIds: [],
            isClassTeacher: type === 'class',
        });
        setShowAssign(true);
    };

    /** Opens the form pre-filled with what the teacher already has. */
    const editTeacher = async (t: TeacherRecord) => {
        try {
            const duties = await getTeacherDuties(t.id);
            setForm({
                teacherId: t.id,
                classIds: duties.classIds,
                subjectIds: duties.subjectIds,
                isClassTeacher: classTeacherRows.some(a => a.teacherId === t.id),
            });
            setShowAssign(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not load this teacher\'s duties.');
        }
    };

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!form.teacherId) {
            toast.error('Please choose a teacher.');
            return;
        }
        if (form.classIds.length === 0 && form.subjectIds.length === 0) {
            toast.error('Choose at least one class or subject.');
            return;
        }

        setIsSaving(true);
        try {
            const yearId = await getCurrentAcademicYearId();
            if (!yearId) {
                toast.error('No academic year is set as current.');
                return;
            }

            const result = await setTeacherAssignments(
                form.teacherId,
                yearId,
                form.classIds,
                form.isClassTeacher ? [] : form.subjectIds
            );

            if (!result.success) {
                toast.error(result.error ?? 'Could not save the duties.');
                return;
            }

            toast.success('Duties saved.');
            await refreshAll();
            setShowAssign(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    /** Clears every duty for a teacher, keeping the old set as history. */
    const handleClear = async (t: TeacherRecord) => {
        if (!window.confirm(`Remove all duties for ${t.fullName}? The previous duties are kept on record.`)) return;

        const yearId = await getCurrentAcademicYearId();
        if (!yearId) {
            toast.error('No academic year is set as current.');
            return;
        }

        const result = await setTeacherAssignments(t.id, yearId, [], []);
        if (!result.success) {
            toast.error(result.error ?? 'Could not clear the duties.');
            return;
        }
        toast.success(`${t.fullName}'s duties were cleared.`);
        await refreshAll();
    };

    if (isLoading) {
        return <CenteredLoader fullScreen={false} message="Loading teacher duties..." className="h-screen" />;
    }

    const selectedTeacher = teacherById.get(form.teacherId);

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                <div className="flex items-start justify-between gap-3 px-1">
                    <div>
                        {teacherId && handleBack && (
                            <button
                                onClick={handleBack}
                                className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-700 mb-1"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back
                            </button>
                        )}
                        <h1 className="text-lg font-bold text-gray-800">
                            {teacherId ? `Duties — ${teacherName ?? 'Teacher'}` : 'Teacher Duties'}
                        </h1>
                        <p className="text-xs text-gray-500">
                            Who is responsible for which class, and who teaches which subject.
                        </p>
                    </div>
                    <button
                        onClick={() => openAssign(tab === 'subject' ? 'subject' : 'class')}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all shrink-0"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Assign
                    </button>
                </div>

                <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-lg transition-colors ${
                                tab === t.key ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            {t.icon}
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'class' && (
                    <DutyList
                        emptyText="No class teachers yet."
                        rows={classTeacherRows}
                        teachers={teachers}
                        renderDetail={a => a.className}
                        renderCount={a => (a.periodsPerWeek ? `${a.periodsPerWeek} periods/week` : 'Responsible for this class')}
                        onEdit={editTeacher}
                        onClear={handleClear}
                    />
                )}

                {tab === 'subject' && (
                    <DutyList
                        emptyText="No subject teachers yet."
                        rows={subjectTeacherRows}
                        teachers={teachers}
                        renderDetail={a => `${a.subjectName ?? 'Subject'} · ${a.className}`}
                        renderCount={a => (a.periodsPerWeek ? `${a.periodsPerWeek} periods/week` : '—')}
                        onEdit={editTeacher}
                        onClear={handleClear}
                    />
                )}

                {tab === 'workload' && (
                    <div className="space-y-2">
                        {workload.length === 0 ? (
                            <EmptyCard text="No teachers to show." />
                        ) : (
                            workload.map((row, i) => (
                                <motion.div
                                    key={row.teacherId}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: Math.min(i, 10) * 0.03 }}
                                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-800 truncate">{row.teacherName}</p>
                                            <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                                                {row.staffCode}
                                            </p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-lg text-xs font-bold shrink-0 ${
                                            row.level === 'Heavy' ? 'bg-amber-100 text-amber-700'
                                                : row.level === 'Balanced' ? 'bg-green-100 text-green-700'
                                                    : 'bg-gray-100 text-gray-500'
                                        }`}>
                                            {row.totalPeriods} periods
                                        </span>
                                    </div>

                                    {(row.classTeacherOf.length > 0 || row.subjectClasses.length > 0) && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {row.classTeacherOf.map((c, k) => (
                                                <span key={`c-${k}`} className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                                                    {c}
                                                </span>
                                            ))}
                                            {row.subjectClasses.map((c, k) => (
                                                <span key={`s-${k}`} className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                                                    {c}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            ))
                        )}
                    </div>
                )}
            </main>

            <AnimatePresence>
                {showAssign && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAssign(false)}
                        className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-lg space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex items-start justify-between">
                                <h2 className="text-lg font-bold text-gray-900">Assign duties</h2>
                                <button
                                    onClick={() => setShowAssign(false)}
                                    aria-label="Close"
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <XIcon className="w-4 h-4" />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-4">
                                <div>
                                    <label htmlFor="dutyTeacher" className="block text-sm font-medium text-gray-700 mb-1">
                                        Teacher
                                    </label>
                                    <select
                                        id="dutyTeacher"
                                        value={form.teacherId}
                                        onChange={e => setForm({ ...form, teacherId: e.target.value })}
                                        disabled={Boolean(teacherId)}
                                        className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60"
                                        required
                                    >
                                        <option value="">Choose a teacher</option>
                                        {teachers.filter(t => t.status === 'ACTIVE').map(t => (
                                            <option key={t.id} value={t.id}>{t.fullName}</option>
                                        ))}
                                    </select>
                                </div>

                                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.isClassTeacher}
                                        onChange={e => setForm({ ...form, isClassTeacher: e.target.checked })}
                                        className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                        Responsible for a class (class teacher)
                                    </span>
                                </label>

                                <div>
                                    <p className="text-sm font-medium text-gray-700 mb-2">Classes</p>
                                    {classes.length === 0 ? (
                                        <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg p-3">
                                            No classes are set up for the current year.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {classes.map(c => {
                                                const checked = form.classIds.includes(c.id);
                                                return (
                                                    <label
                                                        key={c.id}
                                                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                                            checked ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => setForm({
                                                                ...form,
                                                                classIds: checked
                                                                    ? form.classIds.filter(x => x !== c.id)
                                                                    : [c.id],
                                                            })}
                                                            className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                        />
                                                        <span className="text-sm text-gray-700">{c.label}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {form.isClassTeacher && form.classIds.length > 1 && (
                                        <p className="text-xs text-amber-600 mt-2">
                                            A class teacher is usually responsible for one class. Only the first will be used.
                                        </p>
                                    )}
                                </div>

                                {!form.isClassTeacher && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-700 mb-2">Subjects taught</p>
                                        {subjects.length === 0 ? (
                                            <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg p-3">
                                                No subjects have been set up yet.
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {subjects.map(s => {
                                                    const checked = form.subjectIds.includes(s.id);
                                                    return (
                                                        <label
                                                            key={s.id}
                                                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                                                checked ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => setForm({
                                                                    ...form,
                                                                    subjectIds: checked
                                                                        ? form.subjectIds.filter(x => x !== s.id)
                                                                        : [...form.subjectIds, s.id],
                                                                })}
                                                                className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                            />
                                                            <span className="text-sm text-gray-700">{s.label}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedTeacher && (
                                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                                        Saving replaces everything {selectedTeacher.fullName} currently has.
                                        The previous duties stay on record as history.
                                    </p>
                                )}

                                <div className="flex gap-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowAssign(false)}
                                        className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                    >
                                        {isSaving ? 'Saving...' : 'Save duties'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

/** A list of duty rows, grouped by teacher. */
const DutyList: React.FC<{
    rows: AssignmentRecord[];
    teachers: TeacherRecord[];
    emptyText: string;
    renderDetail: (a: AssignmentRecord) => string;
    renderCount: (a: AssignmentRecord) => string;
    onEdit: (t: TeacherRecord) => void;
    onClear: (t: TeacherRecord) => void;
}> = ({ rows, teachers, emptyText, renderDetail, renderCount, onEdit, onClear }) => {
    const byTeacher = useMemo(() => {
        const map = new Map<string, AssignmentRecord[]>();
        for (const a of rows) {
            if (!map.has(a.teacherId)) map.set(a.teacherId, []);
            map.get(a.teacherId)!.push(a);
        }
        return [...map.entries()];
    }, [rows]);

    if (byTeacher.length === 0) return <EmptyCard text={emptyText} />;

    return (
        <div className="space-y-2">
            {byTeacher.map(([id, list]) => {
                const teacher = teachers.find(t => t.id === id);
                return (
                    <motion.div
                        key={id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold text-gray-800 truncate">{list[0].teacherName}</p>
                                <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                                    {list[0].teacherStaffCode}
                                </p>
                            </div>
                            {teacher && (
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => onEdit(teacher)}
                                        aria-label={`Edit duties for ${teacher.fullName}`}
                                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    >
                                        <Users className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onClear(teacher)}
                                        aria-label={`Clear duties for ${teacher.fullName}`}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="mt-2 space-y-1">
                            {list.map(a => (
                                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-gray-700">{renderDetail(a)}</span>
                                    <span className="text-xs text-gray-400 shrink-0">{renderCount(a)}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
};

const EmptyCard: React.FC<{ text: string }> = ({ text }) => (
    <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300">
        <UserCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 font-medium">{text}</p>
    </div>
);

export default TeacherAssignmentsScreen;
