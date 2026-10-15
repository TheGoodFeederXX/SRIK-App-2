/**
 * Attendance overview — SRIK.
 *
 * Rewritten from the multi-tenant original, which fetched a pre-computed
 * summary from the legacy API and showed charts that had no way to say "nobody
 * took this register yet".
 *
 * This screen answers one question the office asks every morning: WHICH CLASSES
 * HAVE NOT HANDED IN THEIR REGISTER YET? So "not recorded" is a first-class
 * state here, shown in its own colour, and never folded into "absent". A class
 * nobody marked is a job still to do, not a class of truants.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { UsersIcon, CalendarIcon, CheckIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    getSchoolDayOverview,
    todayInKualaLumpur,
    isSchoolDay,
} from '../../src/lib/supabase/attendance';

interface AttendanceOverviewScreenProps {
    navigateTo?: (view: string, title: string, props?: any) => void;
}

const AttendanceOverviewScreen: React.FC<AttendanceOverviewScreenProps> = ({ navigateTo }) => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [date, setDate] = useState(() => todayInKualaLumpur());

    const { data: rows = [], isLoading, isError, error } = useQuery({
        queryKey: ['attendanceOverView', date],
        queryFn: () => getSchoolDayOverview(date),
        enabled: Boolean(user),
    });

    const outstanding = rows.filter(r => r.unrecorded);
    const totalExpected = rows.reduce((n, r) => n + r.expected, 0);
    const totalRecorded = rows.reduce((n, r) => n + r.recorded, 0);
    const totalAbsent = rows.reduce((n, r) => n + r.absent, 0);

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                <div className="flex items-center justify-between gap-3 px-1">
                    <div>
                        <h1 className="text-lg font-bold text-gray-800">{t('attendanceOverviewScreen.attendance')}</h1>
                        <p className="text-xs text-gray-500">{t('attendanceOverviewScreen.whichClassesHaveHandedInTheirRegister')}</p>
                    </div>
                    <div className="shrink-0">
                        <label htmlFor="overviewDate" className="sr-only">{t('common.date')}</label>
                        <input
                            id="overviewDate"
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                </div>

                {!isSchoolDay(date) && (
                    <div className="mx-1 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <p className="text-sm text-amber-800 font-medium">
                            This is not a school day. The school week runs Sunday to Thursday.
                        </p>
                    </div>
                )}

                {rows.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: t('attendanceOverviewScreen.classes'), value: `${rows.length - outstanding.length}/${rows.length}`, tone: outstanding.length === 0 ? 'text-green-600' : 'text-amber-600' },
                            { label: t('attendanceOverviewScreen.recorded'), value: `${totalRecorded}/${totalExpected}`, tone: 'text-indigo-600' },
                            { label: 'Absent', value: String(totalAbsent), tone: 'text-red-600' },
                        ].map(card => (
                            <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 text-center">
                                <p className={`text-lg font-bold ${card.tone}`}>{card.value}</p>
                                <p className="text-xs text-gray-400 font-medium">{card.label}</p>
                            </div>
                        ))}
                    </div>
                )}

                {isLoading ? (
                    <CenteredLoader fullScreen={false} message={t('attendanceOverviewScreen.loadingAttendance')} className="h-40" />
                ) : isError ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-red-100">
                        <p className="font-bold text-gray-900 mb-1">{t('attendanceOverviewScreen.couldNotLoadAttendance')}</p>
                        <p className="text-sm text-gray-500">{String(error)}</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                        <UsersIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold text-gray-800">{t('attendanceOverviewScreen.noClassesWithStudents')}</h3>
                        <p className="text-gray-500 max-w-xs mx-auto mt-2">
                            Once students are placed in classes, their registers appear here.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* Outstanding registers first: this is the list the
                            office works through, and it should be at the top. */}
                        {[...rows].sort((a, b) => Number(b.unrecorded) - Number(a.unrecorded) || a.yearLevel - b.yearLevel)
                            .map((row, i) => (
                                <motion.button
                                    key={row.classId}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.03 }}
                                    onClick={() => navigateTo?.('attendanceRegister', 'Attendance', { classId: row.classId, date })}
                                    className={`w-full text-left bg-white rounded-2xl shadow-sm border p-4 transition-colors ${
                                        row.unrecorded
                                            ? 'border-amber-200 hover:bg-amber-50/50'
                                            : 'border-gray-100 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-800 truncate">{row.classDisplayName}</p>
                                            <p className="text-xs text-gray-400 font-medium">
                                                {row.expected} {row.expected === 1 ? 'student' : 'students'}
                                                {row.recorded > 0 && ` · ${row.recorded} recorded`}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 px-2 py-1 rounded-lg text-xs font-bold ${
                                            row.unrecorded
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-green-100 text-green-700'
                                        }`}>
                                            {row.unrecorded ? 'Not recorded' : 'Done'}
                                        </span>
                                    </div>

                                    {!row.unrecorded && (
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-medium">
                                            <span className="text-green-600">
                                                {row.recorded - row.absent} attended
                                            </span>
                                            {row.absent > 0 && (
                                                <span className="text-red-600">{row.absent} absent</span>
                                            )}
                                        </div>
                                    )}
                                </motion.button>
                            ))}
                    </div>
                )}
            </main>
        </div>
    );
};

export default AttendanceOverviewScreen;
