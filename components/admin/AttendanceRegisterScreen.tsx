/**
 * Daily attendance register — SRIK.
 *
 * A new screen: the source project had no way to take a class register. It had
 * attendance *reports*, which is a different job — a report tells you what was
 * recorded, this is where it gets recorded.
 *
 * What the teacher does, in order:
 *   1. Pick a class.
 *   2. Everyone starts as "not recorded yet" — NOT absent.
 *   3. Mark the ones who are not present, then save the whole register at once.
 *
 * Why nobody defaults to present: pre-marking everyone PRESENT means a teacher
 * who is interrupted half way leaves a register that looks complete and is
 * wrong. Starting blank means an unfinished register is visibly unfinished.
 *
 * Why the register is saved in one call: marking 30 children one request at a
 * time would leave a half-saved register whenever a request failed. The save is
 * idempotent, so pressing it twice is harmless.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    CheckIcon, XIcon, ClockIcon, SaveIcon, UsersIcon, CalendarIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listClasses } from '../../src/lib/supabase/academics';
import {
    getClassRegister,
    recordRegister,
    todayInKualaLumpur,
    isSchoolDay,
    summariseRegister,
    type RegisterRow,
    type AttendanceStatus,
} from '../../src/lib/supabase/attendance';

/** The marks a teacher can put against a child, in the order they appear. */
/** The marks a teacher can put against a child. `labelKey` is a translation key: the label
 * used to be fixed English ("Present", "Sick"), so a Malay teacher read English words on the
 * school's own register screen. */
const MARKS: { status: AttendanceStatus; labelKey: string; short: string; icon: React.ReactNode; ring: string; fill: string }[] = [
    {
        status: 'PRESENT', labelKey: 'attendanceRegister.present', short: 'H', ring: 'border-green-300',
        fill: 'bg-green-500 text-white border-green-500',
        icon: <CheckIcon className="w-4 h-4" />,
    },
    {
        status: 'SICK', labelKey: 'attendanceRegister.sick', short: 'S', ring: 'border-amber-300',
        fill: 'bg-amber-500 text-white border-amber-500',
        icon: <span className="text-xs font-bold">S</span>,
    },
    {
        status: 'EXCUSED', labelKey: 'attendanceRegister.excused', short: 'E', ring: 'border-sky-300',
        fill: 'bg-sky-500 text-white border-sky-500',
        icon: <span className="text-xs font-bold">E</span>,
    },
    {
        status: 'LATE', labelKey: 'attendanceRegister.late', short: 'L', ring: 'border-orange-300',
        fill: 'bg-orange-500 text-white border-orange-500',
        icon: <ClockIcon className="w-4 h-4" />,
    },
    {
        status: 'ABSENT', labelKey: 'attendanceRegister.absent', short: 'T', ring: 'border-red-300',
        fill: 'bg-red-500 text-white border-red-500',
        icon: <XIcon className="w-4 h-4" />,
    },
];

const AttendanceRegisterScreen: React.FC = () => {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const { t } = useTranslation();

    const [date, setDate] = useState(() => todayInKualaLumpur());
    const [classId, setClassId] = useState<string>('');
    const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
    const [isSaving, setIsSaving] = useState(false);

    const classesQuery = useQuery({
        queryKey: ['classOptions'],
        queryFn: () => listClasses(),
        enabled: Boolean(user),
    });

    const classes = classesQuery.data ?? [];

    // Default to the first class so the screen is usable immediately.
    useEffect(() => {
        if (!classId && classes.length > 0) setClassId(classes[0].id);
    }, [classes, classId]);

    const registerQuery = useQuery({
        queryKey: ['register', classId, date],
        queryFn: () => getClassRegister(classId, date),
        enabled: Boolean(user && classId),
    });

    const rows: RegisterRow[] = registerQuery.data ?? [];

    /**
     * Loads what was already recorded into the editable state.
     *
     * Re-runs when the class or date changes, so switching class shows that
     * class's register rather than carrying the previous class's marks across.
     */
    useEffect(() => {
        const next: Record<string, AttendanceStatus> = {};
        for (const r of rows) {
            if (r.status) next[r.studentId] = r.status;
        }
        setMarks(next);
  }, [registerQuery.dataUpdatedAt, classId, date]);

    const summary = useMemo(() => summariseRegister(rows, date, classId), [rows, date, classId]);

    const markedCount = Object.keys(marks).length;
    const unmarkedCount = rows.length - markedCount;
    const isDirty = useMemo(
        () => rows.some(r => marks[r.studentId] !== (r.status ?? undefined)),
        [rows, marks]
    );

    const setMark = (studentId: string, status: AttendanceStatus) =>
        setMarks(prev => ({ ...prev, [studentId]: status }));

    const markAllPresent = () => {
        const next: Record<string, AttendanceStatus> = { ...marks };
        for (const r of rows) {
            if (!next[r.studentId]) next[r.studentId] = 'PRESENT';
        }
        setMarks(next);
    };

    const handleSave = async () => {
        if (!classId) return;

        const entries = rows
            .filter(r => marks[r.studentId])
            .map(r => ({ studentId: r.studentId, status: marks[r.studentId], remark: r.remark }));

        if (entries.length === 0) {
            toast.error(t('attendanceRegister.nobodyMarked'));
            return;
        }

        // Saving a partly-marked register would write "not recorded" for the
        // children left over, which is not what the teacher meant. Better to
        // stop and say how many are missing.
        if (unmarkedCount > 0) {
            const proceed = window.confirm(
                t('attendanceRegister.confirmUnmarked', { count: unmarkedCount }),
            );
            if (!proceed) return;
        }

        setIsSaving(true);
        try {
            const result = await recordRegister(classId, date, entries);
            if (!result.success) {
                toast.error(result.error ?? t('attendanceRegister.couldNotSave'));
                return;
            }

            const parts: string[] = [];
            if (result.recorded) parts.push(t('attendanceRegister.recordedOfExpected', { recorded: result.recorded, expected: result.recorded }));
            if (result.corrected) parts.push(t('attendanceRegister.recordedOfExpected', { recorded: result.corrected, expected: result.corrected }));
            toast.success(parts.length ? parts.join(', ') : t('attendanceRegister.nothingChanged'));

            // Refresh so "corrected" flags and the stored state stay truthful.
            await queryClient.invalidateQueries({ queryKey: ['register', classId, date] });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('attendanceRegister.somethingWrong'));
        } finally {
            setIsSaving(false);
        }
    };

    const selectedClass = classes.find(c => c.id === classId);

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                <div className="flex flex-col sm:flex-row gap-3 px-1">
                    <div className="flex-1">
                        <label htmlFor="registerClass" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {t('attendanceRegister.class')}
                        </label>
                        <select
                            id="registerClass"
                            value={classId}
                            onChange={e => setClassId(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            {classes.length === 0 && <option value="">{t('attendanceRegister.noClasses')}</option>}
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.displayName}</option>
                            ))}
                        </select>
                    </div>
                    <div className="sm:w-48">
                        <label htmlFor="registerDate" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {t('attendanceRegister.date')}
                        </label>
                        <input
                            id="registerDate"
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                </div>

                {/* The school week is Sunday to Thursday. Marking a Friday is
                    almost always a mistyped date, so say so rather than let the
                    register be saved silently on a day that has no lessons. */}
                {!isSchoolDay(date) && (
                    <div className="mx-1 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <p className="text-sm text-amber-800 font-medium">
                            {t('attendanceRegister.notSchoolDay')}
                        </p>
                    </div>
                )}

                {summary.recorded > 0 && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="font-bold text-gray-800 text-sm">
                                {selectedClass?.displayName ?? t('attendanceRegister.class')} — {date}
                            </h2>
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                                summary.notRecorded === 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                                {t('attendanceRegister.recordedOfExpected', { recorded: summary.recorded, expected: summary.expected })}
                            </span>
                        </div>
                        <div className="grid grid-cols-5 gap-2 text-center">
                            {[
                                [t('attendanceRegister.present'), summary.present, 'text-green-600'],
                                [t('attendanceRegister.sick'), summary.sick, 'text-amber-600'],
                                [t('attendanceRegister.excused'), summary.excused, 'text-sky-600'],
                                [t('attendanceRegister.late'), summary.late, 'text-orange-600'],
                                [t('attendanceRegister.absent'), summary.absent, 'text-red-600'],
                            ].map(([label, value, colour]) => (
                                <div key={String(label)}>
                                    <p className={`text-lg font-bold ${colour}`}>{String(value)}</p>
                                    <p className="text-xs text-gray-400 font-medium">{String(label)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {registerQuery.isLoading ? (
                    <CenteredLoader fullScreen={false} message={t('attendanceRegister.loading')} className="h-40" />
                ) : registerQuery.isError ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-red-100">
                        <p className="font-bold text-gray-900 mb-1">{t('attendanceRegister.loadFailed')}</p>
                        <p className="text-sm text-gray-500">{String(registerQuery.error)}</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                        <UsersIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold text-gray-800">{t('attendanceRegister.nobodyInClass')}</h3>
                        <p className="text-gray-500 max-w-xs mx-auto mt-2">
                            {t('attendanceRegister.nobodyInClassWhy')}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between px-1">
                            <p className="text-xs font-medium text-gray-500">
                                {unmarkedCount === 0
                                    ? t('attendanceRegister.everyoneMarked')
                                    : t('attendanceRegister.stillToMark', { count: unmarkedCount })}
                            </p>
                            <button
                                onClick={markAllPresent}
                                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 px-2 py-1"
                            >
                                {t('attendanceRegister.markRestPresent')}
                            </button>
                        </div>

                        <div className="space-y-2">
                            {rows.map((row, i) => {
                                const current = marks[row.studentId];
                                return (
                                    <motion.div
                                        key={row.studentId}
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.15, delay: Math.min(i, 12) * 0.02 }}
                                        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(row.studentName)}`}
                                                alt=""
                                                className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-50 shrink-0"
                                            />
                                            <div className="min-w-0 flex-grow">
                                                <p className="text-sm font-bold text-gray-800 truncate">{row.studentName}</p>
                                                <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                                                    {row.admissionNo}
                                                    {!current && row.status === null && ` · ${t('attendanceRegister.notRecorded')}`}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-5 gap-2 mt-3">
                                            {MARKS.map(m => {
                                                const selected = current === m.status;
                                                return (
                                                    <button
                                                        key={m.status}
                                                        onClick={() => setMark(row.studentId, m.status)}
                                                        aria-label={t('attendanceRegister.markFor', { mark: t(m.labelKey), name: row.studentName })}
                                                        aria-pressed={selected}
                                                        className={`flex items-center justify-center gap-1 py-2 rounded-lg border font-bold text-sm transition-colors ${
                                                            selected ? m.fill : `bg-white text-gray-500 ${m.ring} hover:bg-gray-50`
                                                        }`}
                                                    >
                                                        {m.icon}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </>
                )}
            </main>

            <AnimatePresence>
                {rows.length > 0 && (
                    <motion.div
                        initial={{ y: 80 }}
                        animate={{ y: 0 }}
                        className="fixed bottom-20 lg:bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur border-t border-gray-200 lg:relative lg:bg-transparent lg:border-0 lg:backdrop-blur-none"
                    >
                        <button
                            onClick={handleSave}
                            disabled={isSaving || markedCount === 0 || !isDirty}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-200"
                        >
                            <SaveIcon className="w-4 h-4" />
                            {isSaving
                                ? t('attendanceRegister.saving')
                                : isDirty
                                    ? t('attendanceRegister.saveRegisterWithCount', { count: markedCount })
                                    : t('attendanceRegister.registerIsSaved')}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default AttendanceRegisterScreen;
