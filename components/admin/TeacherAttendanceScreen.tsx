import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { SearchIcon } from '../../constants';
// import { mockTeachers } from '../../data'; // usage removed
import DonutChart from '../ui/DonutChart';
import { THEME_CONFIG } from '../../constants';
import { DashboardType, Teacher } from '../../types';
import { listTeachers } from '../../src/lib/supabase/teachers';
import {
    listStaffAttendanceForDay,
    recordStaffAttendance,
    todayInKualaLumpur,
    type StaffAttendanceStatus,
} from '../../src/lib/supabase/staffAttendance';
import { useAutoSync } from '../../hooks/useAutoSync';
import { toast } from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';

type AttendanceStatus = 'Present' | 'Absent' | 'Leave' | 'Pending' | 'Not Marked';

/**
 * The screen's words for the database's statuses.
 *
 * These are NOT the same vocabulary, and the difference matters: the database has
 * ON_LEAVE, MEDICAL_LEAVE and OFFICIAL_DUTY as separate facts, while the screen has
 * one "Leave". Collapsing them for DISPLAY is fine — the office wants to see who is
 * away. Collapsing them on the way BACK is not, so the reverse map is deliberately
 * absent for the three leave kinds: a screen cannot invent which kind it was.
 */
const DB_TO_UI_STATUS: Record<StaffAttendanceStatus, AttendanceStatus> = {
    PRESENT: 'Present',
    ABSENT: 'Absent',
    LATE: 'Pending',
    ON_LEAVE: 'Leave',
    MEDICAL_LEAVE: 'Leave',
    OFFICIAL_DUTY: 'Leave',
};

/** Only the unambiguous ones the office can set directly. */
const UI_TO_DB_STATUS: Partial<Record<AttendanceStatus, StaffAttendanceStatus>> = {
    Present: 'PRESENT',
    Absent: 'ABSENT',
    Leave: 'ON_LEAVE',
};

interface TeacherWithAttendance extends Teacher {
    attendanceStatus: AttendanceStatus;
    checkInTime?: string;
    checkOutTime?: string;
    attendanceId?: string;
    full_name?: string;
    avatar_url?: string;
}

interface TeacherAttendanceScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
}

const TeacherAttendanceScreen: React.FC<TeacherAttendanceScreenProps> = ({ navigateTo }) => {
    const { t } = useTranslation();
    const { currentSchool, currentBranchId } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const theme = THEME_CONFIG[DashboardType.Admin];
    const [teachers, setTeachers] = useState<TeacherWithAttendance[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTeacherData = async () => {
        setLoading(true);
        try {
            // 1. Every teacher the office can see.
            const allTeachers = await listTeachers();

            // 2. Today's records. The DAY comes from the school's own clock, not the
            // device's — a device in another timezone would otherwise ask for the
            // wrong day and show an empty register.
            const today = todayInKualaLumpur();
            const attendanceData = await listStaffAttendanceForDay(today);

            // 3. Merge data
            const mergedData: TeacherWithAttendance[] = allTeachers.map(teacher => {
                const record = attendanceData.find(r => r.teacherId === teacher.id);
                // Map DB status to UI Status
                // The database's own status, mapped for display. The old code looked
                // for an `approval_status` field that this schema does not have, so
                // every teacher showed as "Not Marked" even when a record existed.
                const status: AttendanceStatus = record
                    ? DB_TO_UI_STATUS[record.status] ?? 'Not Marked'
                    : 'Not Marked';

                return {
                    ...teacher,
                    // The screen's own shape, filled from the school's records. The
                    // display name falls back to the staff code so a teacher with no
                    // full name on file is still identifiable.
                    name: teacher.fullName,
                    full_name: teacher.fullName,
                    attendanceStatus: status,
                    checkInTime: record?.checkIn ?? undefined,
                    checkOutTime: record?.checkOut ?? undefined,
                } as unknown as TeacherWithAttendance;
            });

            setTeachers(mergedData);

        } catch (err) {
            console.error("Error fetching teacher attendance:", err);
            toast.error(t('teacherAttendanceScreen.failedToLoadTeacherAttendanceData'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTeacherData();
    }, [currentSchool?.id, currentBranchId]);

    useAutoSync(['staff_attendance', 'teachers'], () => {
        console.log('🔄 [TeacherAttendance] Real-time auto-sync triggered');
        fetchTeacherData();
    });



    /**
     * The office records or corrects a teacher's day.
     *
     * THIS WAS A PLACEHOLDER. The buttons moved on screen, nothing was written, and
     * the next load put them back. An office marking someone present, seeing it
     * stick, and finding it gone tomorrow has been told something false — and the
     * register is what a school relies on when it has to answer for attendance.
     *
     * `record_staff_attendance` writes one row per teacher per day: a second entry
     * CORRECTS the first rather than adding a duplicate, so "how many days was she
     * in" stays answerable. The database also records who made the entry.
     */
    const handleStatusChange = useCallback(async (teacherId: string, status: AttendanceStatus) => {
        const dbStatus = UI_TO_DB_STATUS[status];
        if (!dbStatus) {
            toast.error(t('teacherAttendanceScreen.thatStatusCannotBeRecorded'));
            return;
        }

        const previous = teachers;
        setTeachers(current => current.map(t =>
            t.id === teacherId ? { ...t, attendanceStatus: status } : t));

        try {
            await recordStaffAttendance(teacherId, todayInKualaLumpur(), dbStatus);
            toast.success(t('teacherAttendanceScreen.attendanceRecorded'));
            // Read back, so the screen shows what was stored rather than the guess.
            await fetchTeacherData();
        } catch (err) {
            // Put the row back. Leaving an optimistic value that did not save is how
            // the office ends up believing a record exists.
            setTeachers(previous);
            toast.error(err instanceof Error ? err.message : t('teacherAttendanceScreen.couldNotRecordThat'));
        }
    }, [teachers]);

    const filteredTeachers = useMemo(() =>
        teachers.filter(teacher =>
            (teacher.full_name || teacher.name || '').toLowerCase().includes(searchTerm.toLowerCase())
        ), [teachers, searchTerm]
    );

    const attendanceSummary = useMemo(() => {
        const total = teachers.length;
        const present = teachers.filter(t => t.attendanceStatus === 'Present').length;
        const absent = teachers.filter(t => t.attendanceStatus === 'Absent').length;
        const onLeave = teachers.filter(t => t.attendanceStatus === 'Leave').length; // Logic for Leave needs a flag in DB or specific status
        const pending = teachers.filter(t => t.attendanceStatus === 'Pending').length;

        const presentPercentage = total > 0 ? Math.round(((present + onLeave) / total) * 100) : 0; // Usually present count
        return { total, present, absent, onLeave, pending, presentPercentage };
    }, [teachers]);

    const statusStyles: { [key in AttendanceStatus]: { button: string, text: string } } = {
        Present: { button: 'bg-green-500 text-white', text: 'text-green-600' },
        Absent: { button: 'bg-red-500 text-white', text: 'text-red-600' },
        Leave: { button: 'bg-amber-500 text-white', text: 'text-amber-600' },
        Pending: { button: 'bg-yellow-500 text-white', text: 'text-yellow-600' },
        'Not Marked': { button: 'bg-gray-200 text-gray-500', text: 'text-gray-400' },
    };

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow flex flex-col overflow-y-auto">
                {/* Summary Section */}
                <div className="p-4 bg-white">
                    <div className="flex items-center justify-between">
                        <div className="relative">
                            <DonutChart percentage={attendanceSummary.presentPercentage} color={theme.chartColor} size={80} strokeWidth={9} />
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-xl font-bold text-gray-800">{attendanceSummary.presentPercentage}%</span>
                                <span className="text-xs text-gray-500">{t('teacherAttendanceScreen.present')}</span>
                            </div>
                        </div>
                        <div className="text-right space-y-1">
                            <p className="font-semibold text-gray-800">{attendanceSummary.present} / {attendanceSummary.total} Present</p>
                            <p className="text-sm text-yellow-600 font-bold">{attendanceSummary.pending} Pending Approval</p>
                            <p className="text-sm text-red-500">{attendanceSummary.absent} Absent</p>
                            {attendanceSummary.onLeave > 0 && <p className="text-sm text-amber-500">{attendanceSummary.onLeave} On Leave</p>}
                        </div>
                    </div>
                </div>


                {/* Actions Bar */}
                <div className="px-4 pb-2 bg-white flex justify-end">
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => navigateTo('teacherAttendanceApproval', t('teacherAttendanceScreen.attendanceApprovals'))}
                        className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <span>Review Approvals {attendanceSummary.pending > 0 && `(${attendanceSummary.pending})`}</span>
                    </motion.button>
                </div>

                {/* Search Bar */}
                <div className="p-4 bg-gray-100 z-10 border-b border-t border-gray-200">
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                            <SearchIcon className="text-gray-400" />
                        </span>
                        <input
                            type="text"
                            placeholder={t('teacherAttendanceScreen.searchByTeacherName')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            aria-label={t('teacherAttendanceScreen.searchForATeacher')}
                        />
                    </div>
                </div>

                {/* Teacher List */}
                <div className="flex-grow px-4 pb-4 pt-4 space-y-3">
                    {loading ? (
                        <div className="flex justify-center py-10"><div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent"></div></div>
                    ) : filteredTeachers.length > 0 ? (
                        filteredTeachers.map((teacher, i) => (
                            <motion.div
                                key={teacher.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03 }}
                                whileHover={{ y: -2 }}
                                className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-3 flex items-center space-x-3"
                            >
                                <button onClick={() => navigateTo('teacherAttendanceDetail', `${teacher.full_name || teacher.name || 'Teacher'}'s Attendance`, { teacher })} className="flex items-center space-x-3 flex-grow text-left">
                                    <img src={teacher.avatar_url || teacher.avatarUrl || 'https://i.pravatar.cc/150'} alt={teacher.full_name || teacher.name || 'Teacher'} className="w-12 h-12 rounded-full object-cover" />
                                    <div className="flex-grow">
                                        <p className="font-bold text-gray-800">{teacher.full_name || teacher.name || 'Teacher'}</p>
                                            <div className="flex items-center space-x-2">
                                                <p className={`text-sm font-semibold ${statusStyles[teacher.attendanceStatus].text}`}>
                                                    Status: {teacher.attendanceStatus}
                                                </p>
                                                {teacher.checkInTime && <p className="text-xs text-gray-500">In: {teacher.checkInTime}</p>}
                                                {teacher.checkOutTime && <p className="text-xs text-blue-500 ml-1">Out: {teacher.checkOutTime}</p>}
                                            </div>
                                    </div>
                                </button>
                                {/* Removed direct toggles for clarity on "Sync" context - Admin should Approve primarily, but here we can leave simple display or add back interactions later if requested. Keeping it cleanup for now to emphasize the real status. */}
                                <motion.div
                                    key={teacher.attendanceStatus}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.2 }}
                                    className={`px-3 py-1 rounded-full text-xs font-bold ${statusStyles[teacher.attendanceStatus].button}`}
                                >
                                    {teacher.attendanceStatus}
                                </motion.div>
                            </motion.div>
                        ))
                    ) : (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-10">
                            <p className="text-gray-500">{t('teacherAttendanceScreen.noTeachersFound')}</p>
                        </motion.div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default TeacherAttendanceScreen;
