/**
 * A teacher's own attendance, read and written through the database.
 *
 * The screen this backs called an Express endpoint that is not deployed, so
 * checking in did nothing and said "Attendance marked successfully!" anyway.
 * The functions below are the ones that actually exist, and they resolve the
 * teacher from the signed-in session — no caller-supplied id anywhere, which is
 * what stops one teacher marking another present.
 */
import { requireSupabase } from './client';
import { formatTime } from '../branding';

/** The statuses the database accepts for a staff attendance row. */
export type StaffAttendanceStatus =
    | 'PRESENT'
    | 'ABSENT'
    | 'LATE'
    | 'ON_LEAVE'
    | 'MEDICAL_LEAVE'
    | 'OFFICIAL_DUTY';

export interface StaffAttendanceDay {
    /** The school day, in Malaysia time. */
    date: string;
    status: StaffAttendanceStatus;
    /** ISO timestamp of arrival, or null when the office has not recorded one. */
    checkIn: string | null;
    checkOut: string | null;
    remark: string | null;
}

/**
 * Today's date at the school, not on the reader's device.
 *
 * Re-exported from `attendance.ts` rather than re-implemented: a second copy of
 * "what day is it" is a second thing that can disagree, and a teacher checking in
 * at 23:50 in Kuala Lumpur while looking at a screen showing the wrong day is a
 * disagreement nobody would think to look for.
 */
export { todayInKualaLumpur } from './attendance';

function mapDay(row: {
    attendance_date: string;
    status: StaffAttendanceStatus;
    check_in: string | null;
    check_out: string | null;
    remark: string | null;
}): StaffAttendanceDay {
    return {
        date: row.attendance_date,
        status: row.status,
        checkIn: row.check_in,
        checkOut: row.check_out,
        remark: row.remark,
    };
}

/**
 * The signed-in teacher's own attendance for the last `days` days, newest first.
 *
 * Returns an empty list rather than throwing when the account has no linked
 * teacher record: a teacher whose account the office has not finished setting up
 * should see an empty history, not an error page.
 */
export async function listMyAttendance(days = 30): Promise<StaffAttendanceDay[]> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('my_attendance_history', { p_days: days });
    if (error) {
        // PGRST202 = the function is not deployed yet. Treated as "no history"
        // so a screen cannot break merely because a migration is pending.
        if (error.code === 'PGRST202') return [];
        throw error;
    }
    return ((data ?? []) as Parameters<typeof mapDay>[0][]).map(mapDay);
}

/**
 * The shape the two existing teacher attendance screens render.
 *
 * Kept here rather than duplicated in each screen so the two can never drift into
 * showing the same day differently.
 */
export interface StaffAttendanceView {
    id: string;
    teacher_id: string;
    date: string;
    status: string;
    approval_status: string;
    check_in: string;
    check_out?: string;
}

/**
 * Formats an instant as a clock time at the school.
 *
 * Uses the school's own formatter, so a time here reads the same as a time on the
 * dashboard. It returns an em dash for a missing value; this maps that back to an
 * empty string, because the screens test the field for truthiness to decide
 * whether to render the line at all and an em dash would draw an empty one.
 */
export function schoolTime(iso: string | null): string {
    if (!iso) return '';
    const t = formatTime(iso);
    return t === '—' ? '' : t;
}

/**
 * A database day, shaped for the screens.
 *
 * Those screens were written against an Express response carrying `approval_status`
 * and pre-formatted clock times. SRIK has no approval step — the office records
 * attendance directly and the row exists or it does not — so the label is derived
 * from the record: an arrival is Approved, and a day the office marked absent or on
 * leave is Approved too, because it is a decision rather than a pending request.
 */
export function toAttendanceView(d: StaffAttendanceDay): StaffAttendanceView {
    const decided =
        d.status === 'ABSENT' ||
        d.status === 'ON_LEAVE' ||
        d.status === 'MEDICAL_LEAVE' ||
        d.status === 'OFFICIAL_DUTY';
    return {
        id: d.date,
        teacher_id: '',
        date: d.date,
        status: d.status,
        approval_status: decided || d.checkIn ? 'Approved' : 'Pending',
        check_in: schoolTime(d.checkIn),
        check_out: schoolTime(d.checkOut) || undefined,
    };
}

export interface CheckInResult {
    recorded: boolean;
    created?: boolean;
    /** Set when the database declined; e.g. the office already recorded today. */
    reason?: string;
    date?: string;
    status?: StaffAttendanceStatus;
    checkIn?: string | null;
    checkOut?: string | null;
}

/** Records the caller's own arrival for today. */
export async function checkInMyAttendance(
    status: StaffAttendanceStatus = 'PRESENT',
    remark?: string,
): Promise<CheckInResult> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('record_my_attendance', {
        p_status: status,
        p_remark: remark ?? null,
    });
    if (error) throw error;
    return (data ?? { recorded: false }) as CheckInResult;
}

/** Stamps the caller's own departure for today. */
export async function checkOutMyAttendance(): Promise<CheckInResult> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('record_my_checkout');
    if (error) throw error;
    return (data ?? { recorded: false }) as CheckInResult;
}

/** A teacher's attendance on one school day, as the office sees it. */
export interface StaffAttendanceRow extends StaffAttendanceDay {
    teacherId: string;
    /** Who recorded it, or null when the teacher recorded it themselves. */
    recordedBy: string | null;
    remark: string | null;
}

function mapOfficeRow(row: {
    teacher_id: string;
    attendance_date: string;
    status: StaffAttendanceStatus;
    check_in: string | null;
    check_out: string | null;
    remark: string | null;
    recorded_by: string | null;
}): StaffAttendanceRow {
    return {
        teacherId: row.teacher_id,
        date: row.attendance_date,
        status: row.status,
        checkIn: row.check_in,
        checkOut: row.check_out,
        remark: row.remark,
        recordedBy: row.recorded_by,
    };
}

/**
 * Every teacher's attendance on one day, for the office's register.
 *
 * WHY THIS IS SEPARATE FROM `listMyAttendance`. That one asks for the caller's own
 * row and returns nothing if they have no linked teacher record. This one asks for
 * everyone's, and is allowed to by RLS only because the caller holds
 * `attendance.manage_staff` — the database decides, not this function. A teacher
 * calling it gets an empty list, which is the correct answer to "show me everyone".
 *
 * `p_date` is passed through as the school's own day, so the office register and a
 * teacher's own history cannot be looking at different dates.
 */
export async function listStaffAttendanceForDay(
    date: string,
): Promise<StaffAttendanceRow[]> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('list_staff_attendance', { p_date: date });
    if (error) {
        // An un-migrated database has no such function; the register shows empty
        // rather than an error, because "no records yet" is the truthful reading.
        if (error.code === 'PGRST202') return [];
        throw new Error(error.message);
    }
    return ((data ?? []) as unknown[]).map(r =>
        mapOfficeRow(r as Parameters<typeof mapOfficeRow>[0]),
    );
}

/** Record or correct a teacher's attendance on one day, as the office. */
export async function recordStaffAttendance(
    teacherId: string,
    date: string,
    status: StaffAttendanceStatus,
    remark?: string | null,
): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.rpc('record_staff_attendance', {
        p_teacher_id: teacherId,
        p_date: date,
        p_status: status,
        p_remark: remark ?? null,
    });
    if (error) throw new Error(error.message);
}

/**
 * One teacher's attendance between two days, for the office's month view.
 *
 * A separate read from the day register because the question is different — "how
 * was this person's month" rather than "who was in today" — and because a month of
 * rows for one person should not be fetched by pulling a month of rows for
 * everyone.
 */
export async function listStaffAttendanceRange(
    teacherId: string,
    from: string,
    to: string,
): Promise<StaffAttendanceDay[]> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('list_staff_attendance_range', {
        p_teacher_id: teacherId,
        p_from: from,
        p_to: to,
    });
    if (error) {
        if (error.code === 'PGRST202') return [];
        throw new Error(error.message);
    }
    return ((data ?? []) as unknown[]).map(r =>
        mapDay(r as Parameters<typeof mapDay>[0]),
    );
}
