import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Teacher } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon, CheckCircleIcon } from '../../constants';
import {
    listStaffAttendanceRange,
    recordStaffAttendance,
    type StaffAttendanceStatus,
} from '../../src/lib/supabase/staffAttendance';
import { useAutoSync } from '../../hooks/useAutoSync';
import { toast } from 'react-hot-toast';
import { Save, RotateCcw } from 'lucide-react';

// The database tells medical leave, annual leave and official duty apart. Collapsing
// them for DISPLAY is fine, but then the screen could not say which it meant, so they
// are kept distinct here and only the plain kinds are writable from this screen.
type AttendanceStatus = 'Present' | 'Absent' | 'Leave' | 'Medical' | 'Duty' | 'Pending';

const TeacherAttendanceDetail: React.FC<{ teacher: Teacher }> = ({ teacher }) => {
    const { t } = useTranslation();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [attendanceMap, setAttendanceMap] = useState<Map<string, AttendanceStatus>>(new Map());
    const [pendingChanges, setPendingChanges] = useState<Map<string, AttendanceStatus>>(new Map());
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const firstDayOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), [currentDate]);
    // The screen's words for the database's statuses. The reverse map is partial on
    // purpose: the database distinguishes medical leave, annual leave and official
    // duty, and a screen that collapses them cannot say which it meant.
    const DB_TO_UI: Record<StaffAttendanceStatus, AttendanceStatus> = {
        PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Pending',
        ON_LEAVE: 'Leave', MEDICAL_LEAVE: 'Medical', OFFICIAL_DUTY: 'Duty',
    };
    const UI_TO_DB: Record<string, StaffAttendanceStatus> = {
        Present: 'PRESENT', Absent: 'ABSENT', Leave: 'ON_LEAVE', Pending: 'LATE',
    };

    const daysInMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate(), [currentDate]);
    const startingDayIndex = firstDayOfMonth.getDay();

    const fetchAttendance = async () => {
        if (!teacher?.id) return;
        setLoading(true);
        try {
            // The month's dates, built locally. `toISOString` converts to UTC first,
            // which shifts the window by up to a day for a school in +8 — so a month
            // view could omit its own first or last day.
            const y = currentDate.getFullYear();
            const m = currentDate.getMonth();
            const pad = (n: number) => String(n).padStart(2, '0');
            const startDate = `${y}-${pad(m + 1)}-01`;
            const endDate = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;

            const data = await listStaffAttendanceRange(teacher.id, startDate, endDate);

            const map = new Map<string, AttendanceStatus>();
            for (const record of data) {
                // The database's own status. The old code looked for `approval_status`,
                // which this schema has no column for, so every day of the month came
                // through as "Absent" whatever had actually been recorded.
                map.set(record.date, DB_TO_UI[record.status] ?? 'Absent');
            }
            setAttendanceMap(map);
        } catch (err) {
            console.error('Error fetching teacher attendance detail:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!teacher?.id) return;
        fetchAttendance();
    }, [currentDate, teacher?.id]);

    useAutoSync(['staff_attendance'], () => {
        console.log('🔄 [TeacherAttendanceDetail] Real-time auto-sync triggered');
        fetchAttendance();
    });

    const goToPreviousMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        setPendingChanges(new Map());
    };
    const goToNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        setPendingChanges(new Map());
    };

    const handleDayClick = (dateString: string) => {
        const currentStatus = pendingChanges.get(dateString) || attendanceMap.get(dateString);
        const statuses: (AttendanceStatus | undefined)[] = ['Present', 'Absent', 'Leave', undefined];
        const nextIndex = (statuses.indexOf(currentStatus as any) + 1) % statuses.length;
        const nextStatus = statuses[nextIndex];

        const newPending = new Map(pendingChanges);
        if (nextStatus === attendanceMap.get(dateString)) {
            newPending.delete(dateString);
        } else {
            newPending.set(dateString, nextStatus as AttendanceStatus);
        }
        setPendingChanges(newPending);
    };

    const handleSave = async () => {
        if (pendingChanges.size === 0) return;
        setIsSaving(true);
        const schoolId = sessionStorage.getItem('school_id') || '';
        try {
            // Saved one day at a time, through the same function the office register
            // uses, so a day corrected here cannot end up in a different shape from a
            // day corrected there. A status the database has no equivalent for is
            // REFUSED rather than guessed at.
            for (const [date, status] of pendingChanges.entries()) {
                const dbStatus = UI_TO_DB[status as AttendanceStatus];
                if (!dbStatus) {
                    throw new Error(`"${status}" is not something this school records.`);
                }
                await recordStaffAttendance(teacher.id, date, dbStatus);
            }
            toast.success(`Successfully updated ${pendingChanges.size} records`);
            setPendingChanges(new Map());
            await fetchAttendance();
        } catch (err) {
            console.error('Error saving attendance:', err);
            toast.error(t('teacherAttendanceDetail.failedToSaveAttendanceChanges'));
        } finally {
            setIsSaving(false);
        }
    };

    const attendanceColors: { [key in AttendanceStatus]: string } = {
        Present: 'bg-green-400 text-white',
        Absent: 'bg-red-400 text-white',
        Leave: 'bg-amber-400 text-white',
        Medical: 'bg-sky-400 text-white',
        Duty: 'bg-purple-400 text-white',
        Pending: 'bg-yellow-400 text-white',
    };

    const stats = useMemo(() => {
        let present = 0, absent = 0, leave = 0;
        // Combine map and pending
        const combined = new Map(attendanceMap);
        pendingChanges.forEach((status, date) => {
            if (status) combined.set(date, status);
            else combined.delete(date);
        });

        combined.forEach(status => {
            if (status === 'Present') present++;
            if (status === 'Absent') absent++;
            if (status === 'Leave') leave++;
        });
        return { present, absent, leave };
    }, [attendanceMap, pendingChanges]);

    if (!teacher) {
        return <div className="p-6 text-center text-sm text-gray-500">{t('teacherAttendanceDetail.noTeacherSelectedOpenThisViewFromATeacherRow')}</div>;
    }

    return (
        <div className="p-4 bg-gray-50 space-y-4">
            <div className="bg-white p-4 rounded-xl shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <motion.button whileTap={{ scale: 0.9 }} onClick={goToPreviousMonth} className="p-2 rounded-full hover:bg-gray-100"><ChevronLeftIcon className="h-5 w-5 text-gray-600" /></motion.button>
                    <AnimatePresence mode="wait">
                        <motion.h3
                            key={currentDate.toISOString().slice(0, 7)}
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.15 }}
                            className="font-bold text-lg text-gray-800"
                        >
                            {currentDate.toLocaleString('ms-MY', { month: 'long', year: 'numeric' })}
                        </motion.h3>
                    </AnimatePresence>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={goToNextMonth} className="p-2 rounded-full hover:bg-gray-100"><ChevronRightIcon className="h-5 w-5 text-gray-600" /></motion.button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500 mb-2">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => <div key={`${day}-${i}`}>{day}</div>)}
                </div>
                {loading ? (
                    <div className="flex justify-center py-10"><div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent"></div></div>
                ) : (
                    <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: startingDayIndex }).map((_, index) => <div key={`empty-${index}`} />)}
                        {Array.from({ length: daysInMonth }).map((_, index) => {
                            const day = index + 1;
                            const dateString = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const status = pendingChanges.has(dateString) ? pendingChanges.get(dateString) : attendanceMap.get(dateString);
                            const isPending = pendingChanges.has(dateString);
                            
                            return (
                                <motion.button
                                    key={day}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: isPending ? 1.1 : 1 }}
                                    transition={{ duration: 0.15, delay: Math.min(index, 20) * 0.01 }}
                                    whileHover={{ scale: isPending ? 1.1 : 1.08 }}
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => handleDayClick(dateString)}
                                    className={`w-9 h-9 flex items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                                        status ? attendanceColors[status] : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                    } ${isPending ? 'ring-2 ring-offset-2 ring-indigo-500 shadow-md' : ''}`}
                                >
                                    {day}
                                </motion.button>
                            )
                        })}
                    </div>
                )}
                <div className="flex justify-center space-x-3 mt-4 text-xs">
                    <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-green-400 mr-1.5"></div>{t('teacherAttendanceDetail.present')}</span>
                    <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-yellow-400 mr-1.5"></div>{t('teacherAttendanceDetail.pending')}</span>
                    <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-400 mr-1.5"></div>{t('common.absent')}</span>
                    <span className="flex items-center"><div className="w-3 h-3 rounded-full bg-amber-400 mr-1.5"></div>{t('common.leave')}</span>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-center">
                <motion.div layout className="bg-white p-3 rounded-xl shadow-sm border border-transparent hover:border-green-100 transition-colors">
                    <motion.p key={stats.present} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="font-bold text-lg text-green-600">{stats.present}</motion.p>
                    <p className="text-xs text-gray-500">{t('teacherAttendanceDetail.present')}</p>
                </motion.div>
                <motion.div layout className="bg-white p-3 rounded-xl shadow-sm border border-transparent hover:border-red-100 transition-colors">
                    <motion.p key={stats.absent} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="font-bold text-lg text-red-600">{stats.absent}</motion.p>
                    <p className="text-xs text-gray-500">{t('common.absent')}</p>
                </motion.div>
                <motion.div layout className="bg-white p-3 rounded-xl shadow-sm border border-transparent hover:border-amber-100 transition-colors">
                    <motion.p key={stats.leave} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="font-bold text-lg text-amber-600">{stats.leave}</motion.p>
                    <p className="text-xs text-gray-500">{t('teacherAttendanceDetail.onLeave')}</p>
                </motion.div>
            </div>

            <AnimatePresence>
            {pendingChanges.size > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 12, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: 12, height: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                    className="flex gap-3 pt-2"
                >
                    <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.96, y: 0 }}
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-indigo-700 transition-colors disabled:bg-indigo-300"
                    >
                        {isSaving ? (
                            <div className="animate-spin h-5 w-5 border-2 border-white rounded-full border-t-transparent"></div>
                        ) : (
                            <Save className="w-5 h-5 shrink-0" />
                        )}
                        <span className="min-w-0">{t('teacherAttendanceDetail.saveAttendanceCount', { count: pendingChanges.size })}</span>
                    </motion.button>
                    <motion.button
                        whileHover={{ rotate: -20 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setPendingChanges(new Map())}
                        disabled={isSaving}
                        className="p-3 bg-gray-200 text-gray-600 rounded-xl hover:bg-gray-300 transition-colors disabled:opacity-50"
                        title={t('teacherAttendanceDetail.resetChanges')}
                    >
                        <RotateCcw className="w-5 h-5" />
                    </motion.button>
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    );
};

export default TeacherAttendanceDetail;
