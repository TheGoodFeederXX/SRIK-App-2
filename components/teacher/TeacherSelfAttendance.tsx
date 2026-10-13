import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
    listMyAttendance,
    checkInMyAttendance,
    checkOutMyAttendance,
    todayInKualaLumpur,
    toAttendanceView,
    type StaffAttendanceView,
} from '../../src/lib/supabase/staffAttendance';
import { toast } from 'react-hot-toast';
import { CheckCircleIcon, CalendarIcon, AlertTriangleIcon } from '../../constants';
import { useProfile } from '../../context/ProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useAutoSync } from '../../hooks/useAutoSync';

type TeacherAttendance = StaffAttendanceView;

interface TeacherSelfAttendanceProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    teacherId?: string | null;
}

const TeacherSelfAttendance: React.FC<TeacherSelfAttendanceProps> = ({ navigateTo, teacherId: propTeacherId }) => {
    const { t } = useTranslation();
    const { profile } = useProfile();
    const { user } = useAuth();
    const [todayStatus, setTodayStatus] = useState<TeacherAttendance | null>(null);
    const [attendanceHistory, setAttendanceHistory] = useState<TeacherAttendance[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [errorOccurred, setErrorOccurred] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const loadAttendanceData = async () => {
        setLoading(true);
        try {
            setErrorOccurred(false);
            // Read the teacher's OWN history straight from the database.
            //
            // This called `api.getTeacherAttendanceHistory(30)` on an Express
            // server that is not deployed, so the screen showed an empty history
            // for everyone, always. The database function resolves the teacher
            // from the signed-in session, so there is no id to pass and no way to
            // read a colleague's record by accident.
            const history = (await listMyAttendance(30)).map(toAttendanceView);
            setAttendanceHistory(history);

            const todayStr = todayInKualaLumpur();
            const today = history.find(h => h.date === todayStr);
            setTodayStatus(today || null);
        } catch (error) {
            console.error('Error loading attendance data:', error);
            setErrorOccurred(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAttendanceData();
    }, [user?.id]);

    // Real-time synchronization
    useAutoSync(['teacher_attendance'], loadAttendanceData);

    const handleCheckIn = async () => {
        setSubmitting(true);
        try {
            const result = await checkInMyAttendance('PRESENT');
            // The database refuses when the office has already recorded today —
            // a leave approval, a medical certificate. That must be said out loud
            // rather than reported as a successful check-in.
            if (result.recorded) {
                toast.success(t('teacherSelfAttendance.attendanceMarkedSuccessfully'));
            } else {
                toast.error(result.reason || 'Attendance could not be recorded.');
            }
            await loadAttendanceData();
        } catch (error: any) {
            console.error('Check-in error:', error);
            // The database's own words explain the refusal ("The office has already
            // recorded your attendance for today"). Replacing them with a generic
            // message would hide the one thing the teacher needs to know.
            toast.error(error?.message || 'Failed to mark attendance');
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusColor = (status?: string) => {
        if (!status) return 'bg-gray-100 text-gray-700';
        const lowerStatus = status.toLowerCase();
        switch (lowerStatus) {
            case 'approved': return 'bg-green-100 text-green-700';
            case 'pending': return 'bg-amber-100 text-amber-700';
            case 'rejected': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };


    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-10">
                <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-gray-500 font-medium">{t('teacherSelfAttendance.loadingAttendanceRecords')}</p>
            </div>
        );
    }

    if (errorOccurred) {
        return (
            <div className="flex flex-col items-center justify-center p-10 text-center">
                <AlertTriangleIcon className="w-12 h-12 text-amber-300 mb-4" />
                <p className="font-bold text-gray-800">{t('teacherSelfAttendance.couldnTLoadYourAttendance')}</p>
                <p className="text-gray-500 mt-1 mb-4">{t('teacherSelfAttendance.thereWasAProblemReachingTheServerPleaseTryAgai')}</p>
                <button
                    onClick={loadAttendanceData}
                    className="px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium text-sm"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-6">
            {/* Header / Intro */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">{t('teacherSelfAttendance.todaySAttendance')}</h2>
                        <p className="text-sm text-gray-500 font-medium">
                            {currentTime.toLocaleDateString('ms-MY', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                    </div>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => navigateTo('attendanceHistory', 'Attendance History', {})}
                        className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center hover:bg-purple-200 transition-colors"
                        title={t('teacherSelfAttendance.viewAttendanceHistory')}
                    >
                        <CalendarIcon className="h-6 w-6 text-purple-600" />
                    </motion.button>
                </div>

                {todayStatus ? (
                    <div className="space-y-4">
                        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-100 rounded-lg">
                                    <CheckCircleIcon className="h-5 w-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{t('teacherSelfAttendance.checkInTime')}</p>
                                    <p className="text-lg font-bold text-gray-800">{todayStatus.check_in}</p>
                                </div>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(todayStatus.approval_status)}`}>
                                {(todayStatus.approval_status || 'Pending').charAt(0).toUpperCase() + (todayStatus.approval_status || 'Pending').slice(1)}
                            </span>
                        </div>

                        {todayStatus.check_out ? (
                            <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 rounded-lg">
                                        <CheckCircleIcon className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{t('teacherSelfAttendance.checkOutTime')}</p>
                                        <p className="text-lg font-bold text-gray-800">{todayStatus.check_out}</p>
                                    </div>
                                </div>
                                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                                    {t('teacherSelfAttendance.completed')}
                                </span>
                            </div>
                        ) : (
                            <motion.button
                                whileHover={!submitting ? { scale: 1.01 } : {}}
                                whileTap={!submitting ? { scale: 0.97 } : {}}
                                onClick={handleCheckIn}
                                disabled={submitting}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-100 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                    <CheckCircleIcon className="h-5 w-5" />
                                )}
                                {submitting ? 'Processing...' : 'Mark Attendance (Check Out)'}
                            </motion.button>
                        )}
                    </div>
                ) : (
                    <motion.button
                        whileHover={!submitting ? { scale: 1.01 } : {}}
                        whileTap={!submitting ? { scale: 0.97 } : {}}
                        onClick={handleCheckIn}
                        disabled={submitting}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-100 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                        {submitting ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <CheckCircleIcon className="h-5 w-5" />
                        )}
                        {submitting ? 'Processing...' : 'Mark Attendance (Check In)'}
                    </motion.button>
                )}
            </motion.div>

            {/* Attendance History */}
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-800 px-1">{t('teacherSelfAttendance.attendanceHistory')}</h3>

                <div className="space-y-3">
                    {attendanceHistory.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-gray-500">{t('teacherSelfAttendance.noAttendanceRecordsYet')}</p>
                        </div>
                    ) : (
                        attendanceHistory.map((record, i) => (
                            <motion.div key={record.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.03 }} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="text-center bg-gray-50 rounded-lg p-2 min-w-[50px]">
                                        <p className="text-xs font-bold text-gray-400 uppercase">
                                            {new Date(record.date).toLocaleDateString('ms-MY', { month: 'short' })}
                                        </p>
                                        <p className="text-lg font-bold text-gray-700">
                                            {new Date(record.date).getDate()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-gray-800">Check-in: {record.check_in}</p>
                                        <p className="text-xs text-gray-500">{record.status || 'Present'}</p>
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(record.approval_status)}`}>
                                    {(record.approval_status || 'Pending').charAt(0).toUpperCase() + (record.approval_status || 'Pending').slice(1)}
                                </span>

                            </motion.div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default TeacherSelfAttendance;


