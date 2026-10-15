


import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { CheckCircleIcon, XCircleIcon } from '../../constants';
import DonutChart from '../ui/DonutChart';
import CenteredLoader from '../ui/CenteredLoader';
import { THEME_CONFIG } from '../../constants';
import { DashboardType, Student, AttendanceStatus, ClassInfo } from '../../types';
import { getFormattedClassName } from '../../constants';
import {
    getClassRegister,
    recordRegister,
    todayInKualaLumpur,
    type RegisterRow,
    // The database's vocabulary, under its own name. The screen already has an
    // `AttendanceStatus` meaning Present/Absent/Late/Leave, and the two are NOT the
    // same set of strings — importing both under one name made every case in the
    // mapping below a type error, which is the compiler pointing out exactly the
    // confusion that caused the original display bug.
    type AttendanceStatus as DbAttendanceStatus,
} from '../../src/lib/supabase/attendance';


const AttendanceStatusButtons = ({ status, onStatusChange }: { status: AttendanceStatus, onStatusChange: (newStatus: AttendanceStatus) => void }) => {
    const statusOptions: AttendanceStatus[] = ['Present', 'Absent', 'Late', 'Leave'];
    const statusStyles: { [key in AttendanceStatus]: { button: string, text: string } } = {
        Present: { button: 'bg-green-100 text-green-700 ring-green-500', text: 'P' },
        Absent: { button: 'bg-red-100 text-red-700 ring-red-500', text: 'A' },
        Late: { button: 'bg-blue-100 text-blue-700 ring-blue-500', text: 'L' },
        Leave: { button: 'bg-amber-100 text-amber-700 ring-amber-500', text: 'Lv' },
    };

    return (
        <div className="flex items-center space-x-1">
            {statusOptions.map(option => (
                <motion.button
                    key={option}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => onStatusChange(option)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${status === option
                        ? statusStyles[option].button
                        : 'bg-gray-200 text-gray-600'
                        }`}
                >
                    {statusStyles[option].text}
                </motion.button>
            ))}
        </div>
    );
};

/**
 * The screen's words and the database's words, translated in ONE place.
 *
 * The database stores PRESENT / ABSENT / LATE / EXCUSED / SICK. The screen shows
 * Present / Absent / Late / Leave. Deriving the display word from capitalisation —
 * which is what the old code did — silently turned 'EXCUSED' into 'Excused', a
 * value the buttons do not offer, so the row showed no selection and the teacher's
 * next save wrote the default.
 *
 * 'Leave' and 'Excused' are the same thing here; the school says "cuti" and the
 * model says excused.
 */
function statusToLabel(status: DbAttendanceStatus | null): AttendanceStatus {
    switch (status) {
        case 'PRESENT': return 'Present';
        case 'ABSENT': return 'Absent';
        case 'LATE': return 'Late';
        case 'EXCUSED': return 'Leave';
        case 'SICK': return 'Leave';
        // Nothing recorded yet. The register shows Present by default because that
        // is what the teacher will mark for almost every child, and the save is
        // explicit — the row is only written when the register is submitted.
        case null: return 'Present';
        default: return 'Present';
    }
}

function labelToStatus(label: AttendanceStatus): DbAttendanceStatus {
    switch (label) {
        case 'Present': return 'PRESENT';
        case 'Absent': return 'ABSENT';
        case 'Late': return 'LATE';
        case 'Leave': return 'EXCUSED';
        default: return 'PRESENT';
    }
}

/**
 * The term day counts under each name.
 *
 * Derived from the register's own rows rather than a second request, so the numbers
 * cannot disagree with the marks shown above them.
 */
function summariseTermDays(rows: RegisterRow[], classId: string) {
    const students: Record<string, { total: number; present: number; absent: number; late: number }> = {};
    for (const r of rows) {
        if (!students[r.studentId]) {
            students[r.studentId] = { total: 0, present: 0, absent: 0, late: 0 };
        }
        // A row with no status has not been recorded, so it is NOT counted as a
        // school day for that child. Counting it would report absences nobody marked.
        if (r.status === null) continue;
        const entry = students[r.studentId];
        entry.total += 1;
        if (r.status === 'PRESENT') entry.present += 1;
        else if (r.status === 'LATE') entry.late += 1;
        else entry.absent += 1;
    }
    return {
        term: new Date().getFullYear().toString(),
        students,
    };
}

interface TeacherMarkAttendanceScreenProps {
    classInfo: ClassInfo;
    currentBranchId?: string | null;
}

const TeacherMarkAttendanceScreen: React.FC<TeacherMarkAttendanceScreenProps> = ({ classInfo, currentBranchId }) => {
    const { t } = useTranslation();
    const theme = THEME_CONFIG[DashboardType.Teacher];
    const [students, setStudents] = useState<Student[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Each student's days this term (school days / present / absent / late) from
    // the register — the same numbers that appear on their report card.
    const [termDays, setTermDays] = useState<{ term: string; students: Record<string, { total: number; present: number; absent: number; late: number }> } | null>(null);
    const now = new Date();
    const [selectedDate, setSelectedDate] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

    const fetchData = useCallback(async () => {
        if (!classInfo) return;
        setIsLoading(true);
        try {
            // The register straight from the database, for the date being marked.
            //
            // This screen used to need `schoolId` and `branchId` and then call the
            // Express API. SRIK is ONE school and has neither, so every real teacher
            // hit the "School Context is missing" path and saw an empty register —
            // there was no school to supply, and no server to answer.
            //
            // `getClassRegister` resolves the class list for THAT DATE from the
            // enrollments, so a register marked for last month shows the children
            // who were in the class then, not the ones who have joined since.
            const rows = await getClassRegister(classInfo.id, selectedDate);

            setStudents(
                rows.map((r): Student => ({
                    id: r.studentId,
                    name: r.studentName || 'Unknown',
                    grade: classInfo.grade,
                    section: classInfo.section,
                    avatarUrl: null,
                    // The database's status vocabulary, shown as the screen's own
                    // words. The mapping lives in one place rather than being
                    // re-derived from capitalisation, which broke on 'EXCUSED'.
                    attendanceStatus: statusToLabel(r.status),
                } as unknown as Student))
            );

            // The term day counts are computed from the same rows the register
            // shows, so the numbers under each name agree with the marks above.
            setTermDays(summariseTermDays(rows, classInfo.id));
        } catch (err) {
            // A failure is REPORTED, not swallowed into an empty list. "No students"
            // and "we could not load your students" look identical on screen, and
            // only one of them means the office has work to do.
            console.error('Error fetching attendance data:', err);
            toast.error(
                err instanceof Error ? `${t('teacherAttendanceScreen.couldNotLoadTheRegister')}: ${err.message}` : 'Could not load the register.'
            );
            setStudents([]);
        } finally {
            setIsLoading(false);
        }
    }, [classInfo, selectedDate]);

    // THE EFFECT THAT ACTUALLY LOADS THE REGISTER.
    //
    // The first version of this rewrite replaced the whole block from `fetchData`
    // down to the old `useAutoSync` call, and took this with it: the function was
    // defined, the dependencies were right, and nothing ever called it. The screen
    // sat on "Loading attendance data..." forever, with no error, because a
    // callback that is never invoked does not fail.
    //
    // `useAutoSync` is gone with it. It watched a local sync queue that no longer
    // exists — reads are direct now, so there is nothing to re-sync after.
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // This used to filter by curriculum track (KSSR / British). This school runs
    // one curriculum, and its student records have no track field at all — so the
    // filter could only ever pass every student through unchanged.
    const visibleStudents = students;

    const handleStatusChange = useCallback((studentId: string | number, status: AttendanceStatus) => {
        setStudents(currentStudents =>
            currentStudents.map(student =>
                String(student.id) === String(studentId) ? { ...student, attendanceStatus: status } : student
            )
        );
    }, []);

    const handleMarkAll = useCallback((status: 'Present' | 'Absent') => {
        const visibleIds = new Set(visibleStudents.map(s => String(s.id)));
        setStudents(currentStudents =>
            currentStudents.map(student =>
                visibleIds.has(String(student.id)) ? { ...student, attendanceStatus: status } : student
            )
        );
    }, [visibleStudents]);

    const submitAttendance = async () => {
        if (!classInfo) return;

        // One call for the whole class.
        //
        // This used to collect `school_id` and `branch_id` onto every row and POST
        // them to the Express API. There is no server, so the save failed and the
        // code then handed the register to an offline queue that replayed the same
        // failing call — a loop that reported success to the teacher while nothing
        // was ever written.
        //
        // The RPC is idempotent and writes the whole register in one transaction, so
        // a dropped connection can be retried safely and can never leave a class
        // half-marked.
        const entries = visibleStudents.map(s => ({
            studentId: String(s.id),
            status: labelToStatus(s.attendanceStatus),
            remark: null,
        }));

        try {
            const result = await recordRegister(classInfo.id, selectedDate, entries);

            if (!result.success) {
                toast.error(result.error ?? t('teacherAttendanceScreen.couldNotSaveAttendancePleaseTryAgain'));
                return;
            }

            toast.success(t('teacherAttendanceScreen.attendanceSavedSuccessfully', { date: selectedDate }));

            // Re-read rather than patching local state: the database is the record,
            // and the term counts below each name are derived from it.
            const refreshed = await getClassRegister(classInfo.id, selectedDate);
            setTermDays(summariseTermDays(refreshed, classInfo.id));
        } catch (err) {
            console.error('Error submitting attendance:', err);
            toast.error(
                err instanceof Error ? `${t('teacherAttendanceScreen.couldNotSaveAttendance')}: ${err.message}` : 'Could not save attendance.'
            );
        }
    };

    const attendanceSummary = useMemo(() => {
        const total = visibleStudents.length;
        if (total === 0) return { total: 0, present: 0, absent: 0, onLeave: 0, late: 0, presentPercentage: 0 };

        const present = visibleStudents.filter(s => s.attendanceStatus === 'Present').length;
        const absent = visibleStudents.filter(s => s.attendanceStatus === 'Absent').length;
        const onLeave = visibleStudents.filter(s => s.attendanceStatus === 'Leave').length;
        const late = visibleStudents.filter(s => s.attendanceStatus === 'Late').length;
        const presentPercentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

        return { total, present, absent, onLeave, late, presentPercentage };
    }, [visibleStudents]);

    if (!classInfo) return <div className="flex items-center justify-center min-h-[40vh] p-8 text-center text-gray-500">{t('teacherAttendanceScreen.selectAClassToMarkAttendance')}</div>;

    const formattedClassName = getFormattedClassName(classInfo.grade, classInfo.section, true, classInfo.subject);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const dateVal = e.target.value;
        if (!dateVal) return;

        const date = new Date(dateVal);
        const day = date.getDay();

        // THE SCHOOL WEEK IS SUNDAY TO THURSDAY.
        //
        // This check blocked `day === 0` and allowed Friday — the exact opposite
        // of the school's own week. A teacher taking the register on Sunday, a
        // normal school day, was refused with "Weekends are disabled", while
        // Friday, when there is no school, was accepted. `day === 5` is Friday.
        if (day === 5 || day === 6) {
            toast.error(t('teacherAttendanceScreen.tiadaSekolahPadaJumaatDanSabtuSilaPilihHariPer'));
            return;
        }
        // A teacher marks a register for today or a past day — never the future.
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dateVal > todayStr) {
            toast.error(t('teacherAttendanceScreen.youCantMarkAttendanceForAFutureDate'));
            return;
        }
        setSelectedDate(dateVal);
    };

    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return (
        <div className="flex flex-col h-full bg-gray-100">
            {/* Header with Date Picker */}
            <div className="p-4 bg-white border-b border-gray-200">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <p className="font-bold text-lg text-gray-800">{formattedClassName} Attendance</p>
                        <p className="text-sm text-gray-500">{t('teacherAttendanceScreen.selectADateToViewOrMarkAttendance')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="date"
                            value={selectedDate}
                            max={todayStr}
                            onChange={handleDateChange}
                            className="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md bg-white"
                        />
                    </div>
                </div>
            </div>

            {/* Attendance Stats & Actions */}
            <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4 text-sm">
                        <span className="text-green-600 font-medium">{attendanceSummary.present} Present</span>
                        <span className="text-blue-500 font-medium">{attendanceSummary.late} Late</span>
                        <span className="text-red-600 font-medium">{attendanceSummary.absent} Absent</span>
                    </div>
                    <div className="font-bold text-gray-500">{attendanceSummary.total} Students</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleMarkAll('Present')}
                        className="flex justify-center items-center space-x-2 py-2 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-green-500 hover:bg-green-600 focus:outline-none"
                    >
                        <CheckCircleIcon className="w-5 h-5" />
                        <span>{t('teacherAttendanceScreen.markAllPresent')}</span>
                    </motion.button>
                    <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleMarkAll('Absent')}
                        className="flex justify-center items-center space-x-2 py-2 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-red-500 hover:bg-red-600 focus:outline-none"
                    >
                        <XCircleIcon className="w-5 h-5" />
                        <span>{t('teacherAttendanceScreen.markAllAbsent')}</span>
                    </motion.button>
                </div>
            </div>

            {/* Student List */}
            <main className="flex-grow overflow-y-auto">
                {isLoading ? (
                    <CenteredLoader message={t('teacherAttendanceScreen.loadingAttendanceData')} className="py-12" />
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {visibleStudents.map((student, i) => (
                            <motion.li key={student.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.02 }} className="p-4 flex items-center justify-between bg-white hover:bg-gray-50">
                                <div className="flex items-center space-x-4">
                                    {student.avatarUrl ? (
                                        <img src={student.avatarUrl} alt={student.name} className="w-10 h-10 rounded-full object-cover bg-gray-200" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold">
                                            {student.name.charAt(0)}
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-bold text-gray-800">{student.name}</p>
                                        <p className="text-xs text-gray-500">Status: {student.attendanceStatus}</p>
                                        {termDays?.students[student.id] && (
                                            <p className="text-xs text-gray-500">{termDays.term}: {termDays.students[student.id].present} present · {termDays.students[student.id].absent} absent · {termDays.students[student.id].late} late of {termDays.students[student.id].total} days</p>
                                        )}
                                    </div>
                                </div>
                                <AttendanceStatusButtons status={student.attendanceStatus} onStatusChange={(newStatus) => handleStatusChange(student.id, newStatus)} />
                            </motion.li>
                        ))}
                        {visibleStudents.length === 0 && (
                            <div className="text-center py-10 bg-white">
                                <p className="text-gray-500">
                                     {t('teacherAttendanceScreen.noStudentsFoundForThisClass')}
                                </p>
                            </div>
                        )}
                    </ul>
                )}
            </main>

            {/* Footer */}
            <div className="p-4 bg-white border-t border-gray-200">
                <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={submitAttendance}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                >
                    Simpan Kehadiran untuk {selectedDate}
                </motion.button>
            </div>
        </div>
    );
};

export default TeacherMarkAttendanceScreen;
