/**
 * Timetable editor — SRIK.
 *
 * The viewing screen answers "what is the week?". This one changes it. They are
 * kept apart because editing is a deliberate act: a teacher checking their
 * Friday should not be one stray tap away from moving a lesson.
 *
 * Two rules shape every interaction here, and both come from the database:
 *
 *   A TEACHER CANNOT BE IN TWO PLACES AT ONCE. Before a lesson is placed, the
 *   clash is looked up and shown, so the school is warned rather than being
 *   refused after the fact. The database enforces it regardless.
 *
 *   A TEACHER MUST BE ASSIGNED TO THE SUBJECT IN THAT CLASS. The subject list is
 *   therefore not "all subjects" but "the subjects this class's teachers are
 *   assigned to". Offering a subject nobody is assigned to would produce a
 *   lesson the database rejects, which is a worse experience than not offering
 *   it at all.
 *
 * Publishing is separate again, and irreversible in the sense that matters: the
 * previous published timetable is superseded, so the school follows one week,
 * not two.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    XIcon, SaveIcon, TrashIcon, AlertTriangleIcon, CheckIcon, CalendarIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    getActiveTimetable,
    getClassTimetable,
    listTimetableClasses,
    listAssignableSubjects,
    setLesson,
    clearLesson,
    publishTimetable,
    findTeacherClash,
    describePeriod,
    SCHOOL_DAYS,
    type PeriodRecord,
    type EntryRecord,
    type DayOfWeek,
} from '../../src/lib/supabase/timetable';

interface TimetableEditorScreenProps {
    selectedClassId?: string;
}

/** The slot the editor is currently working on. */
interface EditingSlot {
    period: PeriodRecord;
    existing: EntryRecord | null;
}

const TimetableEditorScreen: React.FC<TimetableEditorScreenProps> = ({ selectedClassId }) => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const [classId, setClassId] = useState(selectedClassId ?? '');
    const [slot, setSlot] = useState<EditingSlot | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);

    const timetableQuery = useQuery({
        queryKey: ['activeTimetable'],
        queryFn: getActiveTimetable,
        enabled: Boolean(user),
    });
    const timetable = timetableQuery.data ?? null;

    const classesQuery = useQuery({
        queryKey: ['timetableClasses', timetable?.id],
        queryFn: () => listTimetableClasses(timetable!.id),
        enabled: Boolean(user && timetable?.id),
    });
    const classes = classesQuery.data ?? [];

    React.useEffect(() => {
        if (!classId && classes.length > 0) setClassId(classes[0].id);
    }, [classes, classId]);

    const yearQuery = useQuery({
        queryKey: ['currentAcademicYear'],
        queryFn: async () => {
            const { requireSupabase } = await import('../../src/lib/supabase/client');
            const db = requireSupabase();
            const { data } = await db.from('academic_years').select('id').eq('status', 'CURRENT').maybeSingle();
            return (data as unknown as { id: string } | null)?.id ?? null;
        },
        enabled: Boolean(user),
    });
    const academicYearId = yearQuery.data ?? null;

    const timetableQueryKey = ['classTimetable', timetable?.id, classId];

    const weekQuery = useQuery({
        queryKey: timetableQueryKey,
        queryFn: () => getClassTimetable(timetable!.id, classId),
        enabled: Boolean(user && timetable?.id && classId),
    });

    const subjectsQuery = useQuery({
        queryKey: ['assignableSubjects', academicYearId, classId],
        queryFn: () => listAssignableSubjects(academicYearId!, classId),
        enabled: Boolean(user && academicYearId && classId),
    });

    const subjects = subjectsQuery.data ?? [];
    const selectedClass = classes.find(c => c.id === classId);

    const teachingSlots = useMemo(() => {
        const periods = weekQuery.data?.periods ?? [];
        const bySlot = new Map<string, EntryRecord>();
        for (const e of weekQuery.data?.entries ?? []) bySlot.set(e.periodId, e);

        return periods
            .filter((p): p is PeriodRecord => Boolean(p))
            .filter(p => describePeriod(p).isTeaching)
            .sort((a, b) => a.periodNumber - b.periodNumber)
            .map(period => ({ period, entry: bySlot.get(period.id) ?? null }));
    }, [weekQuery.data]);

    // Derived from the same list that is rendered, so the count and the grid
    // can never disagree about whether there is anything to publish.
    const filled = teachingSlots.filter(s => s.entry !== null).length;

    const handleClear = async (period: PeriodRecord) => {
        setSlot(null);
        const result = await clearLesson(period.id, classId);
        if (!result.success) {
            toast.error(result.error ?? 'Could not clear that lesson.');
            return;
        }
        toast.success(t('timetableEditorScreen.lessonRemoved'));
        await queryClient.invalidateQueries({ queryKey: timetableQueryKey });
    };

    const handlePublish = async () => {
        if (!timetable) return;
        const proceed = window.confirm(
            'Publishing makes this the timetable the school follows. ' +
            'Any timetable currently published will be replaced. Continue?'
        );
        if (!proceed) return;

        setIsPublishing(true);
        try {
            const result = await publishTimetable(timetable.id, 'Published from the editor');
            if (!result.success) {
                toast.error(result.error ?? 'Could not publish.');
                return;
            }
            toast.success(t('timetableEditorScreen.timetablePublished'));
            await queryClient.invalidateQueries({ queryKey: ['activeTimetable'] });
        } finally {
            setIsPublishing(false);
        }
    };

    if (timetableQuery.isLoading) {
        return <CenteredLoader fullScreen={false} message={t('timetableEditorScreen.loading')} className="h-64" />;
    }

    if (!timetable) {
        return (
            <div className="text-center py-20 m-4 bg-white rounded-3xl border border-dashed border-gray-300">
                <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-bold text-gray-800">{t('timetableEditorScreen.noTimetableYet')}</h3>
                <p className="text-gray-500 max-w-sm mx-auto mt-2">
                    There is nothing to edit until a timetable has been set up.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h1 className="text-lg font-bold text-gray-800">{timetable.name}</h1>
                            <p className="text-xs text-gray-500">
                                Version {timetable.version} ·{' '}
                                <span className={timetable.status === 'PUBLISHED' ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                    {timetable.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                                </span>
                            </p>
                        </div>

                        {timetable.status !== 'PUBLISHED' && (
                            <button
                                onClick={handlePublish}
                                disabled={isPublishing || filled === 0}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                                <CheckIcon className="w-4 h-4" />
                                {isPublishing ? 'Publishing...' : 'Publish Timetable'}
                            </button>
                        )}
                    </div>

                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2">
                        <AlertTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800">
                            {timetable.status === 'PUBLISHED'
                                ? 'This timetable is published, so the school is following it. Changes made here take effect immediately.'
                                : 'A draft. Teachers should not follow it until it is published.'}
                        </p>
                    </div>
                </div>

                <div className="px-1">
                    <label htmlFor="editorClass" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Class
                    </label>
                    <select
                        id="editorClass"
                        value={classId}
                        onChange={e => { setClassId(e.target.value); setSlot(null); }}
                        className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                    >
                        {classes.length === 0 && <option value="">{t('timetableEditorScreen.noClassesInThisTimetable')}</option>}
                        {classes.map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                </div>

                {weekQuery.isLoading ? (
                    <CenteredLoader fullScreen={false} message={t('timetableEditorScreen.loadingTheWeek')} className="h-48" />
                ) : weekQuery.isError ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-red-100">
                        <p className="font-bold text-gray-900 mb-1">{t('timetableEditorScreen.couldNotLoadTheWeek')}</p>
                        <p className="text-sm text-gray-500">{String(weekQuery.error)}</p>
                    </div>
                ) : teachingSlots.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300">
                        <p className="font-bold text-gray-800">{t('timetableEditorScreen.noTeachingPeriods')}</p>
                        <p className="text-gray-500 text-sm mt-1">
                            This timetable has no lessons to fill in.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {SCHOOL_DAYS.map(day => {
                            const daySlots = teachingSlots.filter(s => s.period.dayOfWeek === day.key);
                            if (daySlots.length === 0) return null;
                            return (
                                <div key={day.key} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3">
                                    <h2 className="text-sm font-bold text-gray-700 mb-2">{day.label}</h2>
                                    <div className="space-y-1.5">
                                        {daySlots.map(({ period, entry }) => (
                                            <button
                                                key={period.id}
                                                onClick={() => setSlot({ period, existing: entry })}
                                                className="w-full flex items-center gap-3 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left"
                                            >
                                                <div className="w-16 shrink-0">
                                                    <p className="text-xs font-bold text-gray-700">W{period.periodNumber}</p>
                                                    <p className="text-[10px] text-gray-400">{period.startTime}</p>
                                                </div>
                                                {entry ? (
                                                    <div className="min-w-0 flex-grow">
                                                        <p className="text-sm font-bold text-indigo-700 truncate">
                                                            {entry.subjectCode ?? '—'}
                                                            <span className="text-gray-400 font-normal"> · {entry.subjectName}</span>
                                                        </p>
                                                        <p className="text-xs text-gray-500 truncate">
                                                            {entry.teacherName ?? 'No teacher'}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-gray-400 italic">{t('timetableEditorScreen.notTimetabled')}</p>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            <AnimatePresence>
                {slot && (
                    <SlotEditor
                        slot={slot}
                        classId={classId}
                        className={selectedClass?.label ?? ''}
                        timetableId={timetable.id}
                        subjects={subjects}
                        onClose={() => setSlot(null)}
                        onSaved={async () => {
                            setSlot(null);
                            await queryClient.invalidateQueries({ queryKey: timetableQueryKey });
                        }}
                        onCleared={() => handleClear(slot.period)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

/**
 * Choosing what goes in one slot.
 *
 * A subject is picked first and its teacher follows, rather than picking the two
 * independently. The assignment table says which teacher takes which subject in
 * this class, so asking for both separately would let the school build a pairing
 * that does not exist.
 */
const SlotEditor: React.FC<{
    slot: EditingSlot;
    classId: string;
    className: string;
    timetableId: string;
    subjects: { id: string; code: string; name: string; teacherId: string; teacherName: string }[];
    onClose: () => void;
    onSaved: () => void;
    onCleared: () => void;
}> = ({ slot, classId, className, timetableId, subjects, onClose, onSaved, onCleared }) => {
    const { t } = useTranslation();
    const [chosenSubjectId, setChosenSubjectId] = useState(slot.existing?.subjectId ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [clash, setClash] = useState<{ className: string; subjectCode: string | null } | null>(null);

    const dayLabel = SCHOOL_DAYS.find(d => d.key === slot.period.dayOfWeek)?.label ?? slot.period.dayOfWeek;
    const chosen = subjects.find(s => s.id === chosenSubjectId) ?? null;

    // Look the clash up as soon as a subject is chosen, so the warning appears
    // before the school commits rather than after the database refuses.
    React.useEffect(() => {
        let cancelled = false;
        setClash(null);
        if (!chosen) return;

        findTeacherClash(timetableId, chosen.teacherId, slot.period.id, classId)
            .then(found => { if (!cancelled) setClash(found); })
            .catch(() => { /* a failed check must not block the screen */ });

        return () => { cancelled = true; };
    }, [chosen?.teacherId, slot.period.id, classId, timetableId]);

    const handleSave = async () => {
        if (!chosen) {
            toast.error(t('timetableEditorScreen.chooseASubjectFirst'));
            return;
        }

        if (clash) {
            const proceed = window.confirm(
                `${chosen.teacherName} already teaches ${clash.subjectCode ?? 'a lesson'} to ${clash.className} ` +
                `at this time. The timetable will refuse this. Try anyway?`
            );
            if (!proceed) return;
        }

        setIsSaving(true);
        try {
            const result = await setLesson({
                periodId: slot.period.id,
                classId,
                subjectId: chosen.id,
                teacherId: chosen.teacherId,
            });
            if (!result.success) {
                toast.error(result.error ?? 'Could not save the lesson.');
                return;
            }
            toast.success(`${chosen.code} set for ${className}.`);
            onSaved();
        } finally {
            setIsSaving(false);
        }
    };

    // Only subjects that actually have a teacher assigned can be placed.
    const grouped = useMemo(() => {
        const map = new Map<string, { name: string; subId: string; code: string }>();
        for (const s of subjects) {
            const k = `${s.code}-${s.id}`;
            if (!map.has(k)) map.set(k, { name: s.name, subId: s.id, code: s.code });
        }
        return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
    }, [subjects]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ y: 40 }}
                animate={{ y: 0 }}
                exit={{ y: 40 }}
                onClick={e => e.stopPropagation()}
                className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90vh] overflow-y-auto"
            >
                <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="font-bold text-gray-800">
                            {dayLabel}, W{slot.period.periodNumber}
                        </h2>
                        <p className="text-xs text-gray-500">
                            {slot.period.startTime} - {slot.period.endTime} · {className}
                        </p>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-gray-100 rounded-lg">
                        <XIcon className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {subjects.length === 0 ? (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                            <p className="text-sm text-amber-800 font-medium">
                                No teacher is assigned to teach any subject in {className} yet.
                                Set the teaching assignments first, then lessons can be placed here.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label htmlFor="slotSubject" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                    {t('timetableEditorScreen.subject')}
                                </label>
                                <select
                                    id="slotSubject"
                                    value={chosenSubjectId}
                                    onChange={e => setChosenSubjectId(e.target.value)}
                                    className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">{t('timetableEditorScreen.chooseASubject')}</option>
                                    {grouped.map(g => (
                                        <option key={g.subId} value={g.subId}>{g.code} — {g.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* The teacher is shown, not chosen: the assignment
                                table already decides who teaches this subject. */}
                            {chosen && (
                                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                        {t('timetableEditorScreen.teacher')}
                                    </p>
                                    <p className="text-sm font-bold text-gray-800">{chosen.teacherName}</p>
                                </div>
                            )}

                            {clash && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex gap-2">
                                    <AlertTriangleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-800">
                                        <strong>{chosen?.teacherName}</strong> already teaches{' '}
                                        {clash.subjectCode ?? 'a lesson'} to <strong>{clash.className}</strong> at this
                                        time. The timetable will not allow two lessons at once.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex gap-2">
                    {slot.existing && (
                        <button
                            onClick={onCleared}
                            className="flex items-center justify-center gap-2 px-4 py-3 border border-red-200 text-red-600 font-bold rounded-xl hover:bg-red-50 transition-colors"
                        >
                            <TrashIcon className="w-4 h-4" />
                            Clear
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !chosen}
                        className="flex-grow flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        <SaveIcon className="w-4 h-4" />
                        {isSaving ? 'Saving...' : slot.existing ? 'Replace lesson' : 'Add lesson'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default TimetableEditorScreen;
