/**
 * Mark entry — SRIK.
 *
 * A new screen. The source project had grade *reports* but no way to record a
 * mark in the first place, which is the same gap the attendance module had.
 *
 * What a teacher does, in order:
 *   1. Pick the term, class and assessment.
 *   2. Everybody starts as "belum diisi" — NOT as zero.
 *   3. Type the marks that exist, mark the children who were away.
 *   4. Save the whole register in one go, then publish when complete.
 *
 * Three decisions worth explaining.
 *
 * WHY NOBODY STARTS AT ZERO. Pre-filling zero would mean a teacher interrupted
 * half way leaves a register that looks finished and says the whole class
 * failed. Starting blank means an incomplete register is visibly incomplete, and
 * a blank mark can never be mistaken for a genuine nought.
 *
 * WHY A CHILD WITH NO MARK STILL APPEARS. The register is built from the class
 * list, not from the marks already entered. Building it from the marks would
 * hide exactly the children the teacher has still to deal with.
 *
 * WHY PUBLISHING IS SEPARATE FROM SAVING. Saving keeps work in progress.
 * Publishing tells the school the marks are final and freezes them, which is
 * what makes the report card that follows trustworthy. A teacher can save as
 * often as they like; only the office can publish.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    SaveIcon, UsersIcon, CheckIcon, LockIcon, ExclamationIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import { listClasses, listSubjects } from '../../src/lib/supabase/academics';
import {
    listTerms,
    listAssessments,
    getMarkRegister,
    saveMarks,
    publishAssessment,
    gradeFor,
    listGradeBoundaries,
    ASSESSMENT_TYPE_SHORT,
    RESULT_STATUS_LABELS,
    type MarkRow,
    type ResultStatus,
} from '../../src/lib/supabase/assessments';

/**
 * The five things a teacher can say about a child's mark.
 *
 * "Belum diisi" is first and is the default, because it is genuinely the most
 * common state during the school day and it is the one that must never be
 * confused with a zero.
 */
const STATUSES: { status: ResultStatus; labelKey: string; short: string; active: string }[] = [
    { status: 'NOT_ENTERED', labelKey: 'markEntryScreen.belumDiisi', short: '—', active: 'bg-gray-500 text-white border-gray-500' },
    { status: 'GRADED', labelKey: 'markEntryScreen.adaMarkah', short: 'M', active: 'bg-green-600 text-white border-green-600' },
    { status: 'ABSENT', labelKey: 'markEntryScreen.tidakHadir', short: 'TH', active: 'bg-rose-600 text-white border-rose-600' },
    { status: 'EXEMPT', labelKey: 'markEntryScreen.dikecualikan', short: 'K', active: 'bg-sky-600 text-white border-sky-600' },
];

/** A draft row while the teacher is typing, before it is saved. */
type Draft = { status: ResultStatus; score: string; tp: string; comment: string };

export default function MarkEntryScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [termId, setTermId] = useState('');
    const [classId, setClassId] = useState('');
    const [assessmentId, setAssessmentId] = useState('');
    const [draft, setDraft] = useState<Record<string, Draft>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [reason, setReason] = useState('');

    /* ---------------- reference data ---------------- */

    const termsQuery = useQuery({
        queryKey: ['terms'],
        queryFn: listTerms,
        enabled: Boolean(user),
    });

    const classesQuery = useQuery({
        queryKey: ['classes'],
        queryFn: listClasses,
        enabled: Boolean(user),
    });

    const subjectsQuery = useQuery({
        queryKey: ['subjects'],
        queryFn: listSubjects,
        enabled: Boolean(user),
    });

    const gradesQuery = useQuery({
        queryKey: ['gradeBoundaries'],
        queryFn: listGradeBoundaries,
        enabled: Boolean(user),
    });

    const terms = termsQuery.data ?? [];
    const classes = classesQuery.data ?? [];
    const subjects = subjectsQuery.data ?? [];
    const boundaries = gradesQuery.data ?? [];

    // Default to the term the school is in now, then the first class, so the
    // screen is usable without three deliberate choices first.
    useEffect(() => {
        if (!termId && terms.length) {
            const current = terms.find(t => t.status === 'CURRENT') ?? terms[0];
            setTermId(current.id);
        }
    }, [terms, termId]);

    useEffect(() => {
        if (!classId && classes.length) setClassId(classes[0].id);
    }, [classes, classId]);

    /* ---------------- assessments for the chosen term and class ---------------- */

    const assessmentsQuery = useQuery({
        queryKey: ['assessments', termId],
        queryFn: () => listAssessments(termId),
        enabled: Boolean(user && termId),
    });

    // Only assessments for the chosen class: picking a class and then being
    // shown another class's assessments would be a way to enter marks in the
    // wrong place by accident.
    const assessments = useMemo(
        () => (assessmentsQuery.data ?? []).filter(a => a.classId === classId),
        [assessmentsQuery.data, classId]
    );

    useEffect(() => {
        // Keep the selection valid when the class or term changes.
        if (assessments.length && !assessments.some(a => a.id === assessmentId)) {
            setAssessmentId(assessments[0].id);
        }
        if (!assessments.length) setAssessmentId('');
    }, [assessments, assessmentId]);

    /* ---------------- the register ---------------- */

    const registerQuery = useQuery({
        queryKey: ['markRegister', assessmentId],
        queryFn: () => getMarkRegister(assessmentId),
        enabled: Boolean(user && assessmentId),
    });

    const register = registerQuery.data;
    const assessment = register?.assessment;
    const rows: MarkRow[] = register?.rows ?? [];

    const isPublished = assessment?.status === 'PUBLISHED';

    // Load the saved marks into the editable state. Re-runs when the register
    // reloads, so switching assessment shows that assessment's marks rather
    // than carrying the previous ones across.
    useEffect(() => {
        const next: Record<string, Draft> = {};
        for (const r of rows) {
            next[r.studentId] = {
                status: r.status,
                score: r.score === null ? '' : String(r.score),
                tp: r.tp === null ? '' : String(r.tp),
                comment: r.comment ?? '',
            };
        }
        setDraft(next);
    }, [registerQuery.dataUpdatedAt, assessmentId]);

    const setRow = (studentId: string, patch: Partial<Draft>) =>
        setDraft(prev => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));

    /**
     * Choosing a status adjusts the score box so the two never contradict.
     *
     * Picking "tidak hadir" clears any typed number: an absent child with a
     * score would be refused on save, and surfacing that as an error later is
     * worse than simply not allowing the contradiction to exist.
     */
    const chooseStatus = (studentId: string, status: ResultStatus) => {
        setRow(studentId, status === 'GRADED' ? { status } : { status, score: '' });
    };

    /** A percentage for display, or null when there is no mark. */
    const percentFor = (d: Draft | undefined, max: number): number | null => {
        if (!d || d.status !== 'GRADED' || d.score === '') return null;
        const n = Number(d.score);
        if (Number.isNaN(n) || max <= 0) return null;
        return Math.round((n / max) * 10000) / 100;
    };

    const decidedCount = useMemo(
        () => rows.filter(r => (draft[r.studentId]?.status ?? 'NOT_ENTERED') !== 'NOT_ENTERED').length,
        [rows, draft]
    );
    const awaitingCount = rows.length - decidedCount;

    /** Rows whose typed mark is out of range, so save can stop before the server does. */
    const overMax = useMemo(() => {
        if (!assessment) return [];
        return rows.filter(r => {
            const d = draft[r.studentId];
            if (!d || d.status !== 'GRADED' || d.score === '') return false;
            const n = Number(d.score);
            return Number.isNaN(n) || n < 0 || n > assessment.maxScore;
        });
    }, [rows, draft, assessment]);

    const isDirty = useMemo(
        () => rows.some(r => {
            const d = draft[r.studentId];
            if (!d) return false;
            return d.status !== r.status
                || d.score !== (r.score === null ? '' : String(r.score))
                || d.tp !== (r.tp === null ? '' : String(r.tp))
                || d.comment !== (r.comment ?? '');
        }),
        [rows, draft]
    );

    const handleSave = async () => {
        if (!assessment) return;

        if (overMax.length) {
            toast.error(
                `${overMax.length} markah melebihi markah penuh (${assessment.maxScore}). Sila betulkan dahulu.`
            );
            return;
        }

        // Saving a partly-marked register is legitimate during the school day,
        // but the teacher should be told, because the children left over will
        // stay unrecorded rather than becoming zeroes.
        if (awaitingCount > 0) {
            const proceed = window.confirm(
                `${awaitingCount} pelajar belum diisi. Mereka akan kekal "belum diisi" (bukan sifar). ` +
                `Simpan juga?`
            );
            if (!proceed) return;
        }

        const payload: MarkRow[] = rows.map(r => {
            const d = draft[r.studentId];
            const status = d?.status ?? 'NOT_ENTERED';
            return {
                studentId: r.studentId,
                studentName: r.studentName,
                admissionNo: r.admissionNo,
                status,
                score: status === 'GRADED' && d && d.score !== '' ? Number(d.score) : null,
                tp: d && d.tp !== '' ? Number(d.tp) : null,
                comment: d?.comment || null,
            };
        });

        setIsSaving(true);
        try {
            const result = await saveMarks(assessment.id, payload, reason || undefined);

            const parts: string[] = [];
            if (result.graded) parts.push(`${result.graded} disimpan`);
            if (result.cleared) parts.push(`${result.cleared} dikosongkan`);
            if (result.unchanged) parts.push(`${result.unchanged} tiada perubahan`);
            toast.success(parts.length ? parts.join(', ') : 'Tiada perubahan.');

            await queryClient.invalidateQueries({ queryKey: ['markRegister', assessment.id] });
            await queryClient.invalidateQueries({ queryKey: ['assessments', termId] });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('markEntryScreen.gagalMenyimpanSilaCubaLagi'));
        } finally {
            setIsSaving(false);
        }
    };

    const handlePublish = async () => {
        if (!assessment) return;

        // Publishing freezes the marks. Say so plainly, because it is not
        // obvious from the word "publish".
        const proceed = window.confirm(
            'Terbitkan penilaian ini? Markah akan dikunci dan tidak boleh diubah lagi ' +
            'tanpa ditarik balik penerbitannya. Kad laporan akan menggunakan markah ini.'
        );
        if (!proceed) return;

        setIsSaving(true);
        try {
            const result = await publishAssessment(assessment.id, reason || undefined);
            toast.success(`Penilaian diterbitkan untuk ${result.students} pelajar.`);
            await queryClient.invalidateQueries({ queryKey: ['markRegister', assessment.id] });
            await queryClient.invalidateQueries({ queryKey: ['assessments', termId] });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('markEntryScreen.gagalMenerbitkan'));
        } finally {
            setIsSaving(false);
        }
    };

    const selectedClass = classes.find(c => c.id === classId);
    const selectedTerm = terms.find(t => t.id === termId);

    const isLoading =
        termsQuery.isLoading || classesQuery.isLoading || registerQuery.isLoading;

    /* ---------------- render ---------------- */

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                {/* --- what is being marked --- */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-1">
                    <div>
                        <label htmlFor="mkTerm" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            Penggal
                        </label>
                        <select
                            id="mkTerm"
                            value={termId}
                            onChange={e => setTermId(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {terms.length === 0 && <option value="">{t('markEntryScreen.tiadaPenggal')}</option>}
                            {terms.map(t => (
                                <option key={t.id} value={t.id}>
                                    {t.name}{t.status === 'CURRENT' ? ' (semasa)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="mkClass" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            Kelas
                        </label>
                        <select
                            id="mkClass"
                            value={classId}
                            onChange={e => setClassId(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {classes.length === 0 && <option value="">{t('markEntryScreen.tiadaKelas')}</option>}
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.displayName}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="mkAssessment" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {t('markEntryScreen.penilaian')}
                        </label>
                        <select
                            id="mkAssessment"
                            value={assessmentId}
                            onChange={e => setAssessmentId(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {assessments.length === 0 && (
                                <option value="">{t('markEntryScreen.tiadaPenilaianUntukKelasIni')}</option>
                            )}
                            {assessments.map(a => (
                                <option key={a.id} value={a.id}>
                                    {a.subjectCode} — {a.title}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {isLoading && <CenteredLoader />}

                {/* --- nothing to mark yet --- */}
                {!isLoading && !assessment && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                        <UsersIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                        <p className="font-semibold text-gray-700">{t('markEntryScreen.tiadaPenilaianDipilih')}</p>
                        <p className="text-sm text-gray-500 mt-1">
                            Pilih penggal dan kelas yang sudah ada penilaian. Untuk menambah
                            penilaian baharu, buka skrin Penilaian.
                        </p>
                    </div>
                )}

                {/* --- the assessment summary --- */}
                {assessment && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-lg font-bold text-gray-800">
                                        {assessment.subjectCode} — {assessment.title}
                                    </h2>
                                    <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                                        {ASSESSMENT_TYPE_SHORT[assessment.type]}
                                    </span>
                                    {isPublished && (
                                        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                                            <LockIcon className="w-3 h-3" /> {t('markEntryScreen.diterbitkan')}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500 mt-1">
                                    {selectedClass?.displayName} · {selectedTerm?.name} ·{' '}
                                    markah penuh {assessment.maxScore}
                                </p>
                            </div>

                            <div className="text-right">
                                <p className="text-2xl font-bold text-gray-800">
                                    {decidedCount}<span className="text-gray-400 text-lg">/{rows.length}</span>
                                </p>
                                <p className="text-xs text-gray-500">sudah diisi</p>
                            </div>
                        </div>

                        {awaitingCount > 0 && !isPublished && (
                            <div className="mt-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <ExclamationIcon className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                                <p className="text-amber-800">
                                    <span className="font-semibold">{awaitingCount} pelajar belum diisi.</span>{' '}
                                    Mereka kekal "belum diisi" — bukan sifar. Penilaian tidak boleh
                                    diterbitkan selagi ada yang belum diisi.
                                </p>
                            </div>
                        )}

                        {isPublished && (
                            <div className="mt-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <LockIcon className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                                <p className="text-amber-800">
                                    Markah sudah dikunci kerana penilaian ini diterbitkan.
                                    Kad laporan menggunakan markah ini.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* --- the register --- */}
                {assessment && rows.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                        <div className="divide-y divide-gray-100">
                            {rows.map(r => {
                                const d = draft[r.studentId];
                                const status = d?.status ?? 'NOT_ENTERED';
                                const pct = percentFor(d, assessment.maxScore);
                                const grade = pct === null ? null : gradeFor(pct, boundaries);
                                const tooHigh = overMax.some(o => o.studentId === r.studentId);

                                return (
                                    <div key={r.studentId} className="p-3 sm:p-4">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex-1 min-w-[12rem]">
                                                <p className="font-semibold text-gray-800 truncate">
                                                    {r.studentName}
                                                </p>
                                                <p className="text-xs text-gray-400">{r.admissionNo}</p>
                                            </div>

                                            {/* the four states */}
                                            <div className="flex gap-1.5">
                                                {STATUSES.map(s => (
                                                    <button
                                                        key={s.status}
                                                        type="button"
                                                        disabled={isPublished}
                                                        onClick={() => chooseStatus(r.studentId, s.status)}
                                                        aria-label={t(s.labelKey)}
                                                        aria-pressed={status === s.status}
                                                        className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors disabled:opacity-60 ${
                                                            status === s.status
                                                                ? s.active
                                                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        {s.short}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* the mark itself */}
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min={0}
                                                    max={assessment.maxScore}
                                                    step="0.01"
                                                    value={d?.score ?? ''}
                                                    disabled={isPublished || status !== 'GRADED'}
                                                    onChange={e => setRow(r.studentId, { score: e.target.value })}
                                                    placeholder="—"
                                                    aria-label={`Markah ${r.studentName}`}
                                                    className={`w-20 p-2 text-center font-semibold rounded-lg border focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 ${
                                                        tooHigh ? 'border-rose-400 bg-rose-50' : 'border-gray-200'
                                                    }`}
                                                />
                                                <span className="text-xs text-gray-400 w-11">
                                                    / {assessment.maxScore}
                                                </span>
                                            </div>

                                            {/* TP, a teacher's own judgement */}
                                            <select
                                                value={d?.tp ?? ''}
                                                disabled={isPublished}
                                                onChange={e => setRow(r.studentId, { tp: e.target.value })}
                                                aria-label={`TP ${r.studentName}`}
                                                className="w-20 p-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                                            >
                                                <option value="">{t('markEntryScreen.tp')}</option>
                                                {[1, 2, 3, 4, 5, 6].map(n => (
                                                    <option key={n} value={n}>TP {n}</option>
                                                ))}
                                            </select>

                                            {/* what it works out to */}
                                            <div className="w-20 text-right">
                                                {pct === null ? (
                                                    <span className="text-xs text-gray-300">
                                                        {status === 'ABSENT' ? RESULT_STATUS_LABELS.ABSENT
                                                            : status === 'EXEMPT' ? RESULT_STATUS_LABELS.EXEMPT
                                                            : '—'}
                                                    </span>
                                                ) : (
                                                    <>
                                                        <p className="font-bold text-gray-700">{pct}%</p>
                                                        <p className="text-xs text-gray-500">{grade ?? 'tiada gred'}</p>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* a note, optional */}
                                        {!isPublished && (
                                            <input
                                                type="text"
                                                value={d?.comment ?? ''}
                                                onChange={e => setRow(r.studentId, { comment: e.target.value })}
                                                placeholder={t('markEntryScreen.catatanPilihan')}
                                                aria-label={`${t('markEntryScreen.catatan')} ${r.studentName}`}
                                                className="mt-2 w-full text-sm p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500"
                                            />
                                        )}
                                        {isPublished && d?.comment && (
                                            <p className="mt-2 text-sm text-gray-500 italic">{d.comment}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* --- a class with nobody in it --- */}
                {assessment && rows.length === 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                        <UsersIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                        <p className="font-semibold text-gray-700">{t('markEntryScreen.tiadaPelajarAktifDalamKelasIni')}</p>
                        <p className="text-sm text-gray-500 mt-1">
                            Daftarkan pelajar ke kelas ini dahulu sebelum mengisi markah.
                        </p>
                    </div>
                )}
            </main>

            {/* --- actions --- */}
            {assessment && rows.length > 0 && !isPublished && (
                <div className="fixed bottom-0 left-0 right-0 lg:static bg-white border-t border-gray-200 p-4 space-y-3">
                    <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('markEntryScreen.sebabPilihanDisimpanDalamRekodAudit')}
                        aria-label="Sebab"
                        className="w-full text-sm p-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || !isDirty}
                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                            <SaveIcon className="w-4 h-4" />
                            {isSaving ? t('markEntryScreen.menyimpan') : t('markEntryScreen.simpanMarkah')}
                        </button>
                        <button
                            type="button"
                            onClick={handlePublish}
                            disabled={isSaving || awaitingCount > 0 || isDirty}
                            title={
                                awaitingCount > 0
                                    ? 'Masih ada pelajar belum diisi'
                                    : isDirty
                                        ? 'Simpan markah dahulu'
                                        : 'Terbitkan penilaian'
                            }
                            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                            <CheckIcon className="w-4 h-4" />
                            {t('markEntryScreen.terbitkan')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
