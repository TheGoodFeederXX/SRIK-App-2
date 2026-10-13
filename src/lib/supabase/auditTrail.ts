/**
 * The audit trail, as the office sees it.
 *
 * Reference: docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md
 *
 * This file is a window, never a door. The audit log is written by database
 * triggers alone — no application role holds INSERT, UPDATE or DELETE on it, so
 * there is no function here that could write to it even if someone tried. That
 * is the point of putting the log in the database rather than in the app: the
 * application simply has no way to bend the record.
 *
 * Two things follow from that, and both are deliberate.
 *
 * The actor is never shown from client state. Whatever the browser believes
 * about who is signed in, the recorded name comes from the row, which the
 * database filled from the session at the moment of the change.
 *
 * The history shows the fields that moved, not two whole copies of the record.
 * A clerk asking "who changed this mark" wants the mark, not sixty columns of
 * JSON, and a screen that dumps raw before/after images is a screen nobody
 * reads.
 */

import { requireSupabase } from './client';
import i18n from '../../../lib/i18n';

export interface AuditEntry {
    id: number;
    created_at: string;
    actor_email: string | null;
    action: AuditAction;
    entity_type: string;
    entity_id: string | null;
    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown> | null;
}

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'READ' | 'LOGIN' | 'EXPORT';

/** A change to one field, as recorded. */
export interface FieldChange {
    from: unknown;
    to: unknown;
}

/** One line in a record's history. */
export interface HistoryEntry {
    at: string;
    by: string | null;
    action: AuditAction;
    changed: Record<string, FieldChange>;
}

export const ACTION_LABELS: Record<AuditAction, string> = {
    INSERT: 'auditTrail.actionInsert',
    UPDATE: 'auditTrail.actionUpdate',
    DELETE: 'auditTrail.actionDelete',
    READ: 'auditTrail.actionRead',
    LOGIN: 'auditTrail.actionLogin',
    EXPORT: 'auditTrail.actionExport',
};

/**
 * Friendly names for the tables a clerk will actually meet.
 *
 * A log that says `student_charges` is a log only a programmer can read. Any
 * table not listed falls back to its raw name rather than being hidden, so a
 * new audited table is never invisible just because a label is missing.
 */
export const ENTITY_LABELS: Record<string, string> = {
    students: 'auditTrail.entityStudents',
    student_enrollments: 'auditTrail.entityStudentEnrollments',
    guardians: 'auditTrail.entityGuardians',
    student_guardians: 'auditTrail.entityStudentGuardians',
    attendance_records: 'auditTrail.entityAttendanceRecords',
    assessments: 'auditTrail.entityAssessments',
    assessment_results: 'auditTrail.entityAssessmentResults',
    report_cards: 'auditTrail.entityReportCards',
    fee_types: 'auditTrail.entityFeeTypes',
    student_charges: 'auditTrail.entityStudentCharges',
    payments: 'auditTrail.entityPayments',
    payment_allocations: 'auditTrail.entityPaymentAllocations',
    documents: 'auditTrail.entityDocuments',
    announcements: 'auditTrail.entityAnnouncements',
};

/** Turns a database error into a sentence a clerk can act on. */
export function friendlyAuditError(error: unknown): string {
    const raw = (error as { message?: string })?.message ?? '';

    if (/permission/i.test(raw)) {
        return 'Anda tiada kebenaran untuk melihat rekod audit.';
    }
    if (/failed to fetch|network/i.test(raw)) {
        return 'Tiada sambungan ke pelayan. Sila cuba lagi.';
    }
    return 'Rekod audit tidak dapat dibuka. Sila cuba lagi.';
}

/** Recent audit entries, newest first. */
export async function listAuditLog(filters?: {
    entityType?: string | null;
    entityId?: string | null;
    actorId?: string | null;
    limit?: number;
}): Promise<AuditEntry[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('list_audit_log', {
        p_entity_type: filters?.entityType ?? null,
        p_entity_id: filters?.entityId ?? null,
        p_actor_id: filters?.actorId ?? null,
        p_limit: filters?.limit ?? 100,
    });
    if (error) throw error;
    return (data ?? []) as AuditEntry[];
}

/**
 * The history of one record, for showing "who changed this" beside it.
 *
 * The work of comparing versions is done in the database, so the browser is
 * never trusted to decide what changed.
 */
export async function recordHistory(
    entityType: string,
    entityId: string
): Promise<HistoryEntry[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc('record_history', {
        p_entity_type: entityType,
        p_entity_id: entityId,
    });
    if (error) throw error;
    return (data ?? []) as HistoryEntry[];
}

/** A value as a person would read it on a screen. */
export function describeValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'kosong';
    if (typeof value === 'boolean') return value ? 'ya' : 'tidak';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/** The table a clerk sees, rather than its database name. */
export function entityLabel(entityType: string): string {
    const key = ENTITY_LABELS[entityType];
    // The map holds KEYS, so the translation happens here, through the i18n singleton — this
    // function is called from module scope as well as from components, where no hook exists.
    return key ? i18n.t(key) : entityType;
}
