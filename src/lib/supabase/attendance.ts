/**
 * Attendance data access — SRIK.
 *
 * Reference: docs/srik/05_PHASE_3_TIMETABLE_ATTENDANCE.md
 *
 * Three rules shape this file:
 *
 * 1. A MISSING RECORD IS NOT AN ABSENCE. If nobody took the register on a day,
 *    there are no rows for it. Reporting that as "everyone absent" would accuse
 *    the whole school of missing lessons. Every function here therefore returns
 *    the recorded rows as they are, with no absent filled in.
 *
 * 2. WRITES GO THROUGH THE RPC. The attendance table grants `authenticated`
 *    read-only access, on purpose: a direct write would skip the enrollment
 *    check and the correction audit. `recordRegister` and `correctOne` are the
 *    only ways in, and that is a deliberate constraint, not a limitation.
 *
 * 3. THE DATE IS A MALAYSIAN DATE. School runs on Asia/Kuala_Lumpur. Computing
 *    "today" from the browser's clock would give the wrong day to anyone whose
 *    device is set elsewhere, so the date is derived in Kuala Lumpur time here.
 */

import { requireSupabase } from './client';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'SICK';

/** One student's attendance for one day. */
export interface AttendanceRecord {
    studentId: string;
    studentName: string;
    attendanceNo: string;
    status: AttendanceStatus;
    remark: string | null;
    recordedBy: string | null;
    /** True when a staff member later changed this record. */
    wasCorrected: boolean;
}

/** A student expected in class today, with whatever was recorded. */
export interface RegisterRow {
    studentId: string;
    studentName: string;
    admissionNo: string;
    classId: string;
    classDisplayName: string;
    /** The enrollment open on that date. Needed to write attendance. */
    enrollmentId: string;
    /** null means "not recorded yet" — which is NOT the same as absent. */
    status: AttendanceStatus | null;
    remark: string | null;
}

export interface RegisterSummary {
    date: string;
    classId: string;
    classDisplayName: string;
    /** Everyone expected. */
    expected: number;
    /** How many of them have a record for the day. */
    recorded: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    sick: number;
    notRecorded: number;
}

/**
 * Today's date in Kuala Lumpur, as YYYY-MM-DD.
 *
 * The school day is defined in Malaysian time. Taking the date from the device
 * would put a teacher travelling overseas on the wrong school day, and would
 * disagree with how the database timestamps everything else.
 */
export function todayInKualaLumpur(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

/** A date the school would call a school day: Sunday to Thursday. */
export function isSchoolDay(date: string): boolean {
    // Parsed as UTC noon so the weekday cannot shift with the device's timezone.
    const d = new Date(`${date}T12:00:00Z`);
    const day = d.getUTCDay(); // 0 = Sunday
    return day >= 0 && day <= 4;
}

/**
 * The students expected in a class on a date, together with what was recorded.
 *
 * Reads the enrollment that was open on that date, not today's: a report for
 * last month must show the students who were actually in the class then.
 */
export async function getClassRegister(
    classId: string,
    date: string
): Promise<RegisterRow[]> {
    const db = requireSupabase();

    const { data: enrollments, error: enrollError } = await db
        .from('student_enrollments')
        .select('id, student_id, class_id')
        .eq('class_id', classId)
        .lte('enrolled_at', date)
        .is('ended_at', null);

    if (enrollError) throw new Error(`Could not load the class list: ${enrollError.message}`);

    const enrolled = (enrollments ?? []) as unknown as {
        id: string; student_id: string; class_id: string;
    }[];
    if (enrolled.length === 0) return [];

    const studentIds = enrolled.map(e => e.student_id);

    const [studentsRes, attendanceRes, classRes, correctionsRes] = await Promise.all([
        db.from('students').select('id, full_name, admission_no, status').in('id', studentIds),
        db.from('student_attendance')
            .select('student_id, status, remark, recorded_by')
            .eq('attendance_date', date)
            .in('student_id', studentIds),
        db.from('classes').select('id, display_name').eq('id', classId).maybeSingle(),
        db.from('attendance_corrections')
            .select('student_id')
            .eq('attendance_date', date)
            .in('student_id', studentIds),
    ]);

    const students = (studentsRes.data ?? []) as unknown as {
        id: string; full_name: string; admission_no: string; status: string;
    }[];
    const attendance = (attendanceRes.data ?? []) as unknown as {
        student_id: string; status: AttendanceStatus; remark: string | null; recorded_by: string | null;
    }[];
    const classRow = classRes.data as unknown as { display_name: string } | null;
    const corrected = new Set(
        ((correctionsRes.data ?? []) as unknown as { student_id: string }[]).map(c => c.student_id)
    );

    const studentById = new Map(students.map(s => [s.id, s]));
    const attendanceByStudent = new Map(attendance.map(a => [a.student_id, a]));
    const className = classRow?.display_name ?? '';

    return enrolled
        .map((e): RegisterRow => {
            const student = studentById.get(e.student_id);
            const record = attendanceByStudent.get(e.student_id);
            return {
                studentId: e.student_id,
                studentName: student?.full_name ?? 'Unknown student',
                admissionNo: student?.admission_no ?? '',
                classId,
                classDisplayName: className,
                enrollmentId: e.id,
                // null, not ABSENT: nobody has said anything about this student yet.
                status: record?.status ?? null,
                remark: record?.remark ?? null,
            };
        })
        // Only current students are marked. A withdrawn pupil still appears in
        // the class list history, but must not be on today's register.
        .filter(r => (studentById.get(r.studentId)?.status ?? 'ACTIVE') === 'ACTIVE')
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

/** Counts for a class on a day, treating "not recorded" as its own category. */
export function summariseRegister(rows: RegisterRow[], date: string, classId: string): RegisterSummary {
    const count = (s: AttendanceStatus) => rows.filter(r => r.status === s).length;
    return {
        date,
        classId,
        classDisplayName: rows[0]?.classDisplayName ?? '',
        expected: rows.length,
        recorded: rows.filter(r => r.status !== null).length,
        present: count('PRESENT'),
        absent: count('ABSENT'),
        late: count('LATE'),
        excused: count('EXCUSED'),
        sick: count('SICK'),
        notRecorded: rows.filter(r => r.status === null).length,
    };
}

/**
 * Records a whole class's register in one call.
 *
 * Sent as one request on purpose: marking a class student by student would leave
 * a half-recorded register whenever a request failed partway. The RPC is
 * idempotent, so re-sending after a dropped connection is safe.
 */
export async function recordRegister(
    classId: string,
    date: string,
    entries: { studentId: string; status: AttendanceStatus; remark?: string | null }[]
): Promise<{ success: boolean; recorded?: number; corrected?: number; error?: string }> {
    const db = requireSupabase();

    if (entries.length === 0) return { success: false, error: 'No attendance was provided.' };

    const { data, error } = await db.rpc('record_class_attendance', {
        p_class_id: classId,
        p_date: date,
        p_entries: entries.map(e => ({
            student_id: e.studentId,
            status: e.status,
            remark: e.remark ?? null,
        })),
        p_recorded_by: null,
    });

    if (error) return { success: false, error: error.message };

    const result = (data ?? {}) as { recorded?: number; corrected?: number };
    return { success: true, recorded: result.recorded ?? 0, corrected: result.corrected ?? 0 };
}

/**
 * Corrects one student's attendance.
 *
 * Always requires a reason. A correction without a trace would make the
 * register worthless months later, when the school needs to know why a mark
 * changed.
 */
export async function correctOne(
    studentId: string,
    date: string,
    status: AttendanceStatus,
    reason: string,
    remark?: string | null
): Promise<{ success: boolean; error?: string }> {
    const db = requireSupabase();

    if (!reason.trim()) {
        return { success: false, error: 'A correction must state a reason.' };
    }

    const { error } = await db.rpc('correct_attendance', {
        p_student_id: studentId,
        p_date: date,
        p_status: status,
        p_reason: reason,
        p_remark: remark ?? null,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
}

/** One day's attendance for a whole school, grouped by class. */
export interface SchoolDayRow {
    classId: string;
    classDisplayName: string;
    yearLevel: number;
    expected: number;
    recorded: number;
    present: number;
    absent: number;
    /** True when nobody has taken this class's register yet. */
    unrecorded: boolean;
}

/**
 * How much of the school has been recorded for a day.
 *
 * This is what the office looks at when checking whether every class has handed
 * in its register. `unrecorded` is shown separately rather than counted as
 * absence, for the same reason as everywhere else in this file.
 */
export async function getSchoolDayOverview(date: string): Promise<SchoolDayRow[]> {
    const db = requireSupabase();

    const { data: classes, error } = await db
        .from('classes')
        .select('id, display_name, year_level, status')
        .eq('status', 'ACTIVE')
        .order('year_level');

    if (error) throw new Error(`Could not load classes: ${error.message}`);

    const classRows = (classes ?? []) as unknown as {
        id: string; display_name: string; year_level: number;
    }[];
    if (classRows.length === 0) return [];

    const classIds = classRows.map(c => c.id);

    const [enrollRes, attendRes] = await Promise.all([
        db.from('student_enrollments')
            .select('class_id, student_id')
            .in('class_id', classIds)
            .lte('enrolled_at', date)
            .is('ended_at', null),
        db.from('student_attendance')
            .select('class_id, status')
            .eq('attendance_date', date)
            .in('class_id', classIds),
    ]);

    const enrolledByClass = new Map<string, number>();
    for (const e of (enrollRes.data ?? []) as unknown as { class_id: string }[]) {
        enrolledByClass.set(e.class_id, (enrolledByClass.get(e.class_id) ?? 0) + 1);
    }

    const attendByClass = new Map<string, AttendanceStatus[]>();
    for (const a of (attendRes.data ?? []) as unknown as { class_id: string; status: AttendanceStatus }[]) {
        if (!attendByClass.has(a.class_id)) attendByClass.set(a.class_id, []);
        attendByClass.get(a.class_id)!.push(a.status);
    }

    return classRows
        .map((c): SchoolDayRow => {
            const expected = enrolledByClass.get(c.id) ?? 0;
            const statuses = attendByClass.get(c.id) ?? [];
            return {
                classId: c.id,
                classDisplayName: c.display_name,
                yearLevel: c.year_level,
                expected,
                recorded: statuses.length,
                present: statuses.filter(s => s === 'PRESENT').length,
                absent: statuses.filter(s => s === 'ABSENT').length,
                unrecorded: statuses.length === 0,
            };
        })
        // A class with nobody enrolled is not "missing a register" — there is
        // nobody to record. Showing it as unrecorded would be noise.
        .filter(row => row.expected > 0);
}

/** How one student's attendance looked over a period. */
export interface StudentAttendanceSummary {
    studentId: string;
    studentName: string;
    daysRecorded: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    sick: number;
    /** Present or late, over days actually recorded. */
    attendanceRate: number;
}

/**
 * Attendance totals for the students in a class over a date range.
 *
 * The rate is over days RECORDED, not days in the range. Dividing by every
 * calendar day would punish a student for days the school never took a register.
 */
export async function getClassAttendanceSummary(
    classId: string,
    from: string,
    to: string
): Promise<StudentAttendanceSummary[]> {
    const db = requireSupabase();

    const { data, error } = await db
        .from('student_attendance')
        .select('student_id, status, students(full_name)')
        .eq('class_id', classId)
        .gte('attendance_date', from)
        .lte('attendance_date', to);

    if (error) throw new Error(`Could not load attendance: ${error.message}`);

    const rows = (data ?? []) as unknown as {
        student_id: string; status: AttendanceStatus;
        students: { full_name: string } | null;
    }[];

    const byStudent = new Map<string, { name: string; statuses: AttendanceStatus[] }>();
    for (const r of rows) {
        if (!byStudent.has(r.student_id)) {
            byStudent.set(r.student_id, { name: r.students?.full_name ?? 'Unknown student', statuses: [] });
        }
        byStudent.get(r.student_id)!.statuses.push(r.status);
    }

    return [...byStudent.entries()].map(([studentId, v]): StudentAttendanceSummary => {
        const count = (s: AttendanceStatus) => v.statuses.filter(x => x === s).length;
        const days = v.statuses.length;
        const present = count('PRESENT');
        const late = count('LATE');
        return {
            studentId,
            studentName: v.name,
            daysRecorded: days,
            present,
            absent: count('ABSENT'),
            late,
            excused: count('EXCUSED'),
            sick: count('SICK'),
            attendanceRate: days === 0 ? 0 : Math.round(((present + late) / days) * 1000) / 10,
        };
    }).sort((a, b) => a.attendanceRate - b.attendanceRate);
}
