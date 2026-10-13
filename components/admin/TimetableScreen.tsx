/**
 * Timetable — SRIK.
 *
 * Rewritten from the multi-tenant original, which built its grid from the
 * legacy API and had no way to show assembly, break or Zohor as anything other
 * than a gap. Here the school day is real: every period appears, whether or not
 * a lesson sits in it.
 *
 * Three things this screen is careful about:
 *
 * A period that is not a lesson is shown as itself — Rehat, Zohor, Perhimpunan,
 * Yasin/Dhuha — not as an empty cell. A teacher glancing at Thursday period 1
 * should see "Yasin/Dhuha", not nothing.
 *
 * A blank cell and an unfinished cell look the same on a grid, so they are
 * counted separately at the top. If a lesson has no teacher, the office needs to
 * know; the grid alone would hide it.
 *
 * The same week is shown for a class and for a teacher, from opposite sides.
 * Both come from one grid builder so they cannot disagree.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { CalendarIcon, UsersIcon, AlertTriangleIcon, EditIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    getActiveTimetable,
    getClassTimetable,
    getTeacherTimetable,
    listTimetableClasses,
    listTimetableTeachers,
    findIncompleteEntries,
    describePeriod,
    SCHOOL_DAYS,
    getMyClassId,
    getMyTeacherId,
    type GridCell,
} from '../../src/lib/supabase/timetable';

type ViewMode = 'CLASS' | 'TEACHER';

const TYPE_STYLES: Record<string, string> = {
    BREAK: 'bg-amber-50 border-amber-200 text-amber-800',
    PRAYER: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    ASSEMBLY: 'bg-sky-50 border-sky-200 text-sky-800',
    ACTIVITY: 'bg-violet-50 border-violet-200 text-violet-800',
};

interface TimetableScreenProps {
    navigateTo?: (view: string, title: string, props?: any) => void;
    /** Opened from the editor, so the same class stays selected. */
    selectedClassId?: string;
}

const TimetableScreen: React.FC<TimetableScreenProps> = ({ navigateTo, selectedClassId }) => {
    const { t } = useTranslation();
    const { user, role: authRole } = useAuth();
    const [mode, setMode] = useState<ViewMode>('CLASS');
    const [selectedId, setSelectedId] = useState<string>('');

    // Who is looking matters, because the right timetable is not a choice for
    // everyone. The office may browse any class or teacher; a student, guardian
    // or teacher has exactly one correct answer, and offering them a picker
    // would invite them to browse other people's week.
    const role = (authRole ?? (user as { role?: string } | null)?.role ?? '').toString().toLowerCase();
    const isOffice = role === 'admin' || role === 'superadmin';
    const isTeacher = role === 'teacher';
    const isStudentOrGuardian = role === 'student' || role === 'parent';

    // For a teacher the useful default is their own week, not a class; for a
    // student or guardian it is their class.
    useEffect(() => {
        if (isTeacher) setMode('TEACHER');
    }, [isTeacher]);

    // Resolve the signed-in person's own class or teacher row. The database
    // returns only their own, so this cannot be pointed at anyone else.
    const selfQuery = useQuery({
        queryKey: ['timetableSelf', role],
        queryFn: async () => ({
            classId: isStudentOrGuardian ? await getMyClassId() : null,
            teacherId: isTeacher ? await getMyTeacherId() : null,
        }),
        enabled: Boolean(user) && !isOffice,
    });

    const ownClassId = selfQuery.data?.classId ?? null;
    const ownTeacherId = selfQuery.data?.teacherId ?? null;

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

    const teachersQuery = useQuery({
        queryKey: ['timetableTeachers', timetable?.id],
        queryFn: () => listTimetableTeachers(timetable!.id),
        enabled: Boolean(user && timetable?.id),
    });

    const gapsQuery = useQuery({
        queryKey: ['timetableGaps', timetable?.id],
        queryFn: () => findIncompleteEntries(timetable!.id),
        enabled: Boolean(user && timetable?.id),
    });

    const classes = classesQuery.data ?? [];
    const teachers = teachersQuery.data ?? [];
    const options = mode === 'CLASS' ? classes : teachers;

    // Default to the first option so the screen opens on something useful — but
    // for anyone who is not the office, "useful" means their own week, not
    // whichever class happens to sort first.
    useEffect(() => {
        const own = mode === 'CLASS' ? ownClassId : ownTeacherId;

        if (!isOffice && own) {
            if (options.some(o => o.id === own)) { setSelectedId(own); return; }
        }

        const preferred = mode === 'CLASS' && selectedClassId
            ? options.find(o => o.id === selectedClassId)
            : undefined;
        setSelectedId(preferred?.id ?? (options.length > 0 ? options[0].id : ''));
    }, [mode, classes.length, teachers.length, selectedClassId, isOffice, ownClassId, ownTeacherId]);

    const gridQuery = useQuery({
        queryKey: ['timetableGrid', timetable?.id, mode, selectedId],
        queryFn: () => mode === 'CLASS'
            ? getClassTimetable(timetable!.id, selectedId)
            : getTeacherTimetable(timetable!.id, selectedId),
        enabled: Boolean(user && timetable?.id && selectedId),
    });

    const grid = gridQuery.data?.grid ?? [];
    const selected = options.find(o => o.id === selectedId);

    const teachingCount = useMemo(
        () => (gridQuery.data?.entries ?? []).length,
        [gridQuery.data]
    );

    if (timetableQuery.isLoading) {
        return <CenteredLoader fullScreen={false} message={t('timetableScreen.memuatkanJadual')} className="h-64" />;
    }

    if (timetableQuery.isError) {
        return (
            <div className="p-8 text-center">
                <p className="font-bold text-gray-900 mb-1">{t('timetableScreen.jadualTidakDapatDimuatkan')}</p>
                <p className="text-sm text-gray-500">{String(timetableQuery.error)}</p>
            </div>
        );
    }

    if (!timetable) {
        return (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300 m-4">
                <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-bold text-gray-800">{t('timetableScreen.belumAdaJadual')}</h3>
                <p className="text-gray-500 max-w-sm mx-auto mt-2">
                     {t('timetableScreen.onceTimetableReady')}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h1 className="text-lg font-bold text-gray-800">{timetable.name}</h1>
                            <p className="text-xs text-gray-500">
                                Versi {timetable.version} ·{' '}
                                <span className={timetable.status === 'PUBLISHED' ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                    {timetable.status === 'PUBLISHED' ? 'Diterbitkan' : 'Draf'}
                                </span>
                                {' · '}berkuat kuasa {timetable.effectiveFrom}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                        {navigateTo && isOffice && (
                            <button
                                onClick={() => navigateTo('timetableEditor', t('timetableScreen.suntingJadual'), { selectedClassId: selectedId })}
                                className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors text-sm"
                            >
                                <EditIcon className="w-4 h-4" />
                                {t('timetableScreen.edit')}
                            </button>
                        )}
                        {/* The class/teacher switch is an office tool. Everyone else
                            has one correct answer, so a switch would only invite them
                            to browse a week that is not theirs. */}
                        {isOffice && (
                            <div className="flex bg-gray-100 rounded-xl p-1">
                                {(['CLASS', 'TEACHER'] as ViewMode[]).map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setMode(m)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                                            mode === m ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        {m === 'CLASS' ? t('timetableScreen.ikutKelas') : t('timetableScreen.ikutGuru')}
                                    </button>
                                ))}
                            </div>
                        )}
                        </div>
                    </div>

                    {/* A draft is not something teachers should be following yet. */}
                    {timetable.status === 'DRAFT' && (
                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2">
                            <AlertTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-800">
                                 {t('timetableScreen.draftNotPublished')}
                                mengikutnya.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 mt-3">
                        <div className="text-center">
                            <p className="text-lg font-bold text-indigo-600">{teachingCount}</p>
                            <p className="text-xs text-gray-400 font-medium">{t('timetableScreen.pelajaranSeminggu')}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-700">{grid.length}</p>
                            <p className="text-xs text-gray-400 font-medium">{t('timetableScreen.waktuSehari')}</p>
                        </div>
                        <div className="text-center">
                            <p className={`text-lg font-bold ${(gapsQuery.data?.missingTeacher ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {gapsQuery.data?.missingTeacher ?? 0}
                            </p>
                            <p className="text-xs text-gray-400 font-medium">{t('timetableScreen.belumAdaGuru')}</p>
                        </div>
                    </div>
                </div>

                {isOffice ? (
                    <div className="px-1">
                        <label htmlFor="timetableSubject" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {mode === 'CLASS' ? t('timetableScreen.class') : t('timetableScreen.teacher')}
                        </label>
                        <select
                            id="timetableSubject"
                            value={selectedId}
                            onChange={e => setSelectedId(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {options.length === 0 && <option value="">{t('timetableScreen.tiadaApaUntukDipaparkan')}</option>}
                            {options.map(o => (
                                <option key={o.id} value={o.id}>
                                    {o.label} ({o.periodsPerWeek} seminggu)
                                </option>
                            ))}
                        </select>
                    </div>
                ) : (
                    // A single line saying WHOSE week this is, so the reader is
                    // never in doubt about what they are looking at.
                    selected && (
                        <div className="px-1">
                            <p className="text-sm font-semibold text-gray-700">
                                {mode === 'CLASS' ? t('timetableScreen.jadualKelas') : t('timetableScreen.jadualAnda')}: {selected.label}
                            </p>
                        </div>
                    )
                )}

                {gridQuery.isLoading ? (
                    <CenteredLoader fullScreen={false} message={t('timetableScreen.memuatkanMinggu')} className="h-48" />
                ) : gridQuery.isError ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-red-100">
                        <p className="font-bold text-gray-900 mb-1">{t('timetableScreen.couldNotLoadTheWeek')}</p>
                        <p className="text-sm text-gray-500">{String(gridQuery.error)}</p>
                    </div>
                ) : grid.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300">
                        <CalendarIcon className="w-14 h-14 mx-auto mb-3 text-gray-300" />
                        <p className="font-bold text-gray-800">{t('timetableScreen.nothingTimetabled')}</p>
                        <p className="text-gray-500 text-sm mt-1">
                            {selected?.label ?? 'This'} has no lessons in this timetable.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        {/* Horizontal scroll on a phone: the week is five columns
                            wide and squashing it would make it unreadable. */}
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse min-w-[640px]">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="text-left p-2 text-xs font-bold text-gray-500 uppercase tracking-wide w-24">
                                            Period
                                        </th>
                                        {SCHOOL_DAYS.map(d => (
                                            <th key={d.key} className="p-2 text-center text-xs font-bold text-gray-500 uppercase tracking-wide">
                                                {d.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {grid.map((row, ri) => (
                                        <tr key={row.periodNumber} className={ri % 2 ? 'bg-gray-50/40' : ''}>
                                            <td className="p-2 align-top border-b border-gray-50">
                                                <p className="text-sm font-bold text-gray-700">W{row.periodNumber}</p>
                                                <p className="text-[10px] text-gray-400 whitespace-nowrap">{row.time}</p>
                                            </td>
                                            {row.cells.map((cell, ci) => (
                                                <td key={ci} className="p-1 align-top border-b border-gray-50">
                                                    <Cell cell={cell} mode={mode} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

/**
 * One cell of the week.
 *
 * Three outcomes, and each is shown differently on purpose: a non-teaching
 * period is named, a lesson shows its subject and the other side of the pair,
 * and a genuinely blank slot stays blank.
 */
const Cell: React.FC<{ cell: GridCell; mode: ViewMode }> = ({ cell, mode }) => {
    const { period, entry } = cell;

    if (!period) {
        return <div className="h-12 rounded-lg bg-gray-50 border border-dashed border-gray-200" />;
    }

    const info = describePeriod(period);

    // Not a lesson: name it, so Thursday period 1 reads "Yasin/Dhuha" rather
    // than looking like an unfilled slot.
    if (!info.isTeaching) {
        return (
            <div className={`h-12 rounded-lg border flex items-center justify-center px-1 ${TYPE_STYLES[period.type] ?? 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                <span className="text-[11px] font-bold text-center leading-tight">{info.title}</span>
            </div>
        );
    }

    if (!entry) {
        return (
            <div className="h-12 rounded-lg bg-white border border-dashed border-gray-200 flex items-center justify-center">
                <span className="text-[10px] text-gray-300">—</span>
            </div>
        );
    }

    // A lesson with no teacher is a real gap. Marking it makes it visible on a
    // grid where it would otherwise look like a finished lesson.
    const noTeacher = !entry.teacherId;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`h-12 rounded-lg border p-1 flex flex-col justify-center ${
                noTeacher ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-100'
            }`}
        >
            <p className={`text-[11px] font-bold leading-tight truncate ${noTeacher ? 'text-red-800' : 'text-indigo-800'}`}>
                {entry.subjectCode ?? '—'}
            </p>
            <p className="text-[9px] leading-tight truncate text-gray-500">
                {mode === 'CLASS'
                    ? (entry.teacherName ?? 'no teacher')
                    : entry.className}
            </p>
        </motion.div>
    );
};

export default TimetableScreen;
