/**
 * Report cards — SIRK.
 *
 * Reference: docs/srik/06_PHASE_4_ASSESSMENTS_REPORTS.md
 *
 * A report card is the document the school sends home, so this screen is built
 * around three things being true.
 *
 * 1. WHAT IS SHOWN IS THE SNAPSHOT, NOT A LIVE RECOMPUTATION. Once a report has
 *    been issued, what this screen shows is the copy frozen at that moment. If
 *    a teacher corrects a mark afterwards, the issued report still says what it
 *    said when it went out. The screen says which revision is on file so nobody
 *    mistakes an old report for a current one.
 *
 * 2. A DRAFT PREVIEW IS LABELLED AS A DRAFT. Before publishing, the screen can
 *    show what the report WOULD say. That is genuinely useful, but it must never
 *    look like an issued document, so it carries a clear watermark.
 *
 * 3. PRINTING PRINTS THE REPORT AND NOTHING ELSE. The application shell around
 *    the report is marked no-print, and each report is a sheet that breaks
 *    cleanly across pages. Printing a class of thirty should give thirty clean
 *    pages, not thirty pages with a sidebar down the side.
 *
 * Why no PDF library: the browser's own print dialog already produces a PDF,
 * with working text selection, correct fonts and no upload of a child's marks to
 * a third party. The extra machinery would buy nothing a parent would notice.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../lib/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    PrinterIcon, UsersIcon, LockIcon, CheckCircleIcon, ExclamationIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import { listClasses } from '../../src/lib/supabase/academics';
import {
    listTerms,
    listReportCards,
    getReportSnapshot,
    previewReport,
    publishReportCard,
    getSchoolDetails,
    listClassStudents,
    gradeFor,
    listGradeBoundaries,
    averagePercent,
    ASSESSMENT_TYPE_SHORT,
    type GradeBoundary,
    type ReportSnapshot,
    type SnapshotAssessment,
    type SchoolDetails,
    type ClassStudent,
} from '../../src/lib/supabase/assessments';

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

/** A date the way a Malaysian school writes it. */
function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ms-MY', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
}

/** How a mark reads on a report, where a blank is not a zero. */
function markText(a: SnapshotAssessment): string {
    if (a.status === 'ABSENT') return 'TH';     // tidak hadir
    if (a.status === 'EXEMPT') return 'KE';     // kecualian
    if (a.score === null) return '—';
    return String(a.score);
}

function markTitle(a: SnapshotAssessment): string {
    if (a.status === 'ABSENT') return i18n.t('reportCardScreen.absent');
    if (a.status === 'EXEMPT') return i18n.t('reportCardScreen.exempt');
    if (a.score === null) return i18n.t('reportCardScreen.notFilledIn');
    return `${a.score} / ${a.maxScore}`;
}

/* -------------------------------------------------------------------------
 * The printed document
 * ---------------------------------------------------------------------- */

interface ReportSheetProps {
    snapshot: ReportSnapshot;
    school: SchoolDetails | null;
    /** A preview has not been issued, so it must look like one. */
    isDraft: boolean;
    gradeBoundaries: GradeBoundary[];
    version: number | null;
}

/**
 * One child's report card, laid out for A4.
 *
 * Kept deliberately plain: no shadows, no rounded corners and no background
 * washes, because those either disappear or turn into grey blocks when printed.
 * What the parent gets on paper should look like what they see on screen.
 */
function ReportSheet({ snapshot, school, isDraft, gradeBoundaries, version }: ReportSheetProps) {
    const { t } = useTranslation();
    // Marks are grouped by subject so a subject examined three times reads as
    // one block rather than three unrelated lines.
    const bySubject = useMemo(() => {
        const map = new Map<string, { code: string; name: string; items: SnapshotAssessment[] }>();
        for (const a of snapshot.assessments) {
            const key = a.subjectCode || a.subjectName;
            if (!map.has(key)) map.set(key, { code: a.subjectCode, name: a.subjectName, items: [] });
            map.get(key)!.items.push(a);
        }
        return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
    }, [snapshot.assessments]);

    const average = averagePercent(snapshot.assessments);
    const overallGrade = average === null ? null : gradeFor(average, gradeBoundaries);

    return (
        <div className="report-card-sheet bg-white border border-gray-300 p-6 sm:p-8 text-gray-900">
            {/* --- head --- */}
            <div className="flex items-start gap-4 border-b-2 border-gray-800 pb-4">
                <div className="flex-1 text-center">
                    <h1 className="text-lg sm:text-xl font-bold uppercase tracking-wide">
                        {school?.name || t('reportCardScreen.namaSekolahBelumDiisi')}
                    </h1>
                    {school?.address && (
                        <p className="text-xs text-gray-600 mt-1">{school.address}</p>
                    )}
                    {(school?.phone || school?.email) && (
                        <p className="text-xs text-gray-600">
                            {school?.phone}
                            {school?.phone && school?.email ? ' · ' : ''}
                            {school?.email}
                        </p>
                    )}
                </div>
            </div>

            <div className="text-center mt-4">
                <h2 className="text-base font-bold uppercase tracking-widest underline">
                     {t('reportCardScreen.reportCards')}
                </h2>
                <p className="text-sm text-gray-700 mt-1">{snapshot.term.name}</p>
                <p className="text-xs text-gray-500">
                    {formatDate(snapshot.term.startDate)} – {formatDate(snapshot.term.endDate)}
                </p>
            </div>

            {/* A preview must never be mistaken for an issued document. */}
            {isDraft && (
                <p className="mt-3 text-center text-xs font-bold uppercase tracking-widest text-amber-700 border border-amber-300 bg-amber-50 py-1 print-only">
                    {t('reportCardScreen.draftNotYetPublished')}
                </p>
            )}

            {/* --- the child --- */}
            <table className="w-full mt-5 text-sm border-collapse">
                <tbody>
                    <tr>
                        <td className="py-1 pr-3 text-gray-600 w-32">{t('reportCardScreen.name')}</td>
                        <td className="py-1 font-semibold">: {snapshot.student.fullName}</td>
                        <td className="py-1 pr-3 text-gray-600 w-28">{t('reportCardScreen.noDaftar')}</td>
                        <td className="py-1 font-semibold">: {snapshot.student.admissionNo || '—'}</td>
                    </tr>
                    <tr>
                        <td className="py-1 pr-3 text-gray-600">{t('reportCardScreen.class')}</td>
                        <td className="py-1 font-semibold">: {snapshot.class?.displayName || '—'}</td>
                        <td className="py-1 pr-3 text-gray-600">{t('reportCardScreen.year')}</td>
                        <td className="py-1 font-semibold">
                            : {snapshot.class?.yearLevel ? `Tahun ${snapshot.class.yearLevel}` : '—'}
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* --- marks --- */}
            <table className="w-full mt-5 text-sm border-collapse">
                <thead>
                    <tr className="bg-gray-100">
                         {t('reportCardScreen.student')}
                        <th className="border border-gray-400 px-2 py-1 text-left">{t('reportCardScreen.penilaian')}</th>
                        <th className="border border-gray-400 px-2 py-1 text-center w-16">{t('reportCardScreen.marks')}</th>
                        <th className="border border-gray-400 px-2 py-1 text-center w-14">%</th>
                        <th className="border border-gray-400 px-2 py-1 text-center w-14">Gred</th>
                        <th className="border border-gray-400 px-2 py-1 text-center w-14">TP</th>
                    </tr>
                </thead>
                <tbody>
                    {bySubject.length === 0 && (
                        <tr>
                            <td colSpan={6} className="border border-gray-400 px-2 py-3 text-center text-gray-500">
                                 {t('reportCardScreen.noPublishedAssessmentsForTerm')}
                            </td>
                        </tr>
                    )}

                    {bySubject.map(subject =>
                        subject.items.map((a, i) => (
                            <tr key={a.assessmentId}>
                                {i === 0 && (
                                    <td
                                        rowSpan={subject.items.length}
                                        className="border border-gray-400 px-2 py-1 align-top font-semibold"
                                    >
                                        {subject.name}
                                        <span className="block text-xs font-normal text-gray-500">
                                            {subject.code}
                                        </span>
                                    </td>
                                )}
                                <td className="border border-gray-400 px-2 py-1">
                                    {t(ASSESSMENT_TYPE_SHORT[a.type])}
                                    {a.title ? <span className="block text-xs text-gray-500">{a.title}</span> : null}
                                </td>
                                <td
                                    className="border border-gray-400 px-2 py-1 text-center font-semibold"
                                    title={markTitle(a)}
                                >
                                    {markText(a)}
                                </td>
                                <td className="border border-gray-400 px-2 py-1 text-center">
                                    {a.percent === null ? '—' : a.percent}
                                </td>
                                <td className="border border-gray-400 px-2 py-1 text-center font-bold">
                                    {a.grade ?? (a.percent === null ? '—' : gradeFor(a.percent, gradeBoundaries) ?? '—')}
                                </td>
                                <td className="border border-gray-400 px-2 py-1 text-center">
                                    {a.tp === null ? '—' : a.tp}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
                {snapshot.assessments.length > 0 && (
                    <tfoot>
                        <tr className="bg-gray-50 font-semibold">
                            <td colSpan={3} className="border border-gray-400 px-2 py-1 text-right">
                                {t('reportCardScreen.average')}
                            </td>
                            <td className="border border-gray-400 px-2 py-1 text-center">
                                {average === null ? '—' : average}
                            </td>
                            <td className="border border-gray-400 px-2 py-1 text-center font-bold">
                                {overallGrade ?? '—'}
                            </td>
                            <td className="border border-gray-400 px-2 py-1" />
                        </tr>
                    </tfoot>
                )}
            </table>

            {/* A blank mark is explained on the sheet, so a parent does not read
                "—" as a zero and conclude their child failed. */}
            <p className="mt-2 text-xs text-gray-500">
                {t('reportCardScreen.dashMeansNotFilledIn')}
            </p>

            {/* --- attendance --- */}
            <div className="mt-5 border border-gray-400 p-3">
                <h3 className="text-sm font-bold mb-2">{t('reportCardScreen.kehadiran')}</h3>
                {snapshot.attendance.daysRecorded === 0 ? (
                    <p className="text-sm text-gray-500">
                         {t('reportCardScreen.noAttendanceRecordsForTerm')}
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <tbody>
                            <tr>
                                <td className="py-0.5 text-gray-600 w-40">{t('reportCardScreen.hariDirekodkan')}</td>
                                <td className="py-0.5 font-semibold">{snapshot.attendance.daysRecorded}</td>
                                <td className="py-0.5 text-gray-600 w-40">{t('reportCardScreen.hariHadir')}</td>
                                <td className="py-0.5 font-semibold">{snapshot.attendance.daysPresent}</td>
                                <td className="py-0.5 text-gray-600 w-24">{t('reportCardScreen.peratus')}</td>
                                <td className="py-0.5 font-semibold">
                                    {snapshot.attendance.rate === null
                                        ? '—'
                                        : `${snapshot.attendance.rate}%`}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </div>

            {/* --- what the school says --- */}
            {snapshot.assessments.some(a => a.comment) && (
                <div className="mt-4">
                    <h3 className="text-sm font-bold mb-1">{t('reportCardScreen.catatanGuru')}</h3>
                    <ul className="text-sm list-disc pl-5 space-y-0.5">
                        {snapshot.assessments
                            .filter(a => a.comment)
                            .map(a => (
                                <li key={a.assessmentId}>
                                    <span className="text-gray-600">{a.subjectName}: </span>
                                    {a.comment}
                                </li>
                            ))}
                    </ul>
                </div>
            )}

            {/* --- signatures --- */}
            <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
                <div>
                    <div className="border-t border-gray-500 pt-1">
                        {school?.principalName || '\u00A0'}
                    </div>
                    <p className="text-xs text-gray-600">{t('reportCardScreen.guruBesar')}</p>
                </div>
                <div>
                    <div className="border-t border-gray-500 pt-1">&nbsp;</div>
                    <p className="text-xs text-gray-600">{t('reportCardScreen.tandatanganPenjaga')}</p>
                </div>
            </div>

            <p className="mt-6 text-[10px] text-gray-400 text-center">
                Dijana {formatDate(snapshot.generatedAt)}
                {version !== null ? ` · Revisi ${version}` : ''}
                {isDraft ? ' · Draf' : ''}
            </p>
        </div>
    );
}

/* -------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------- */

export default function ReportCardScreen() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [termId, setTermId] = useState('');
    const [classId, setClassId] = useState('');
    const [studentId, setStudentId] = useState('');
    const [isPreview, setIsPreview] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [reason, setReason] = useState('');

    /* ---------------- reference data ---------------- */

    const termsQuery = useQuery({ queryKey: ['terms'], queryFn: listTerms, enabled: Boolean(user) });
    const classesQuery = useQuery({ queryKey: ['classes'], queryFn: listClasses, enabled: Boolean(user) });
    const schoolQuery = useQuery({ queryKey: ['schoolDetails'], queryFn: getSchoolDetails, enabled: Boolean(user) });
    const gradesQuery = useQuery({ queryKey: ['gradeBoundaries'], queryFn: listGradeBoundaries, enabled: Boolean(user) });

    const terms = termsQuery.data ?? [];
    const classes = classesQuery.data ?? [];
    const boundaries = gradesQuery.data ?? [];

    React.useEffect(() => {
        if (!termId && terms.length) {
            setTermId((terms.find(t => t.status === 'CURRENT') ?? terms[0]).id);
        }
    }, [terms, termId]);

    React.useEffect(() => {
        if (!classId && classes.length) setClassId(classes[0].id);
    }, [classes, classId]);

    const studentsQuery = useQuery({
        queryKey: ['classStudents', classId],
        queryFn: () => listClassStudents(classId),
        enabled: Boolean(user && classId),
    });

    // Memoised, because an array literal is a new reference on every render.
    // Passing a fresh [] into the effect below made its dependency change each
    // time, so the "clear the selection" branch ran on every render and wiped
    // the student that had just been chosen. The screen then sat on "no report
    // issued" forever with a student selected.
    const students: ClassStudent[] = useMemo(
        () => studentsQuery.data ?? [],
        [studentsQuery.data]
    );

    React.useEffect(() => {
        if (students.length) {
            // Keep the chosen child if they are still in the class; otherwise
            // fall back to the first, so the screen always shows somebody.
            if (!students.some(s => s.studentId === studentId)) {
                setStudentId(students[0].studentId);
            }
        } else if (studentId) {
            setStudentId('');
        }
        // studentId is deliberately NOT a dependency: including it re-runs the
        // effect on every selection, which is what caused the wipe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [students]);

    /* ---------------- who already has a report ---------------- */

    const issuedQuery = useQuery({
        queryKey: ['reportCards', termId],
        queryFn: () => listReportCards(termId),
        enabled: Boolean(user && termId),
    });

    const issued = issuedQuery.data ?? [];
    /** The current revision for each child, so a superseded one is not shown as live. */
    const currentByStudent = useMemo(() => {
        const map = new Map<string, { version: number; status: string }>();
        for (const r of issued) {
            const existing = map.get(r.studentId);
            if (!existing || r.version > existing.version) {
                map.set(r.studentId, { version: r.version, status: r.status });
            }
        }
        return map;
    }, [issued]);

    /** The live report, which is the one that must be shown by default. */
    const publishedQuery = useQuery({
        queryKey: ['reportSnapshot', studentId, termId, 'published'],
        queryFn: () => getReportSnapshot(studentId, termId),
        enabled: Boolean(user && studentId && termId && !isPreview),
    });

    /** What the report WOULD say, available before publishing. */
    const draftQuery = useQuery({
        queryKey: ['reportSnapshot', studentId, termId, 'preview'],
        queryFn: () => previewReport(studentId, termId),
        enabled: Boolean(user && studentId && termId && isPreview),
    });

    const published = publishedQuery.data ?? null;
    const shown: ReportSnapshot | null = isPreview ? (draftQuery.data ?? null) : (published?.snapshot ?? null);
    const isLoading = isPreview ? draftQuery.isLoading : publishedQuery.isLoading;

    /* ---------------- actions ---------------- */

    const handlePublish = async () => {
        if (!studentId || !termId) return;

        // Changing later is possible, but a correction creates a new revision
        // rather than editing this one, so it is worth saying out loud.
        const already = published?.status === 'PUBLISHED';
        const proceed = window.confirm(
            already
                ? 'Pelajar ini sudah ada kad laporan untuk penggal ini. ' +
                  'Menerbitkan semula akan menjadi REVISI BAHARU, dan yang lama disimpan sebagai rekod. Teruskan?'
                : 'Terbitkan kad laporan ini? Markah dan kehadiran akan dikunci seperti sekarang. ' +
                  'Pembetulan selepas ini menjadi revisi baharu.'
        );
        if (!proceed) return;

        setIsBusy(true);
        try {
            const result = await publishReportCard(studentId, termId, reason || undefined);
            toast.success(
                result.supersededId
                    ? `Revisi ${result.version} diterbitkan. Revisi lama disimpan.`
                    : `Kad laporan revisi ${result.version} diterbitkan.`
            );
            setIsPreview(false);
            // Refresh both what was issued and the snapshot now on file.
            await queryClient.invalidateQueries({ queryKey: ['reportCards', termId] });
            await queryClient.invalidateQueries({ queryKey: ['reportSnapshot', studentId, termId] });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('reportCardScreen.gagalMenerbitkanKadLaporan'));
        } finally {
            setIsBusy(false);
        }
    };

    const handlePrint = () => {
        // The application shell is marked no-print, so this prints the report
        // sheets and nothing else.
        window.print();
    };

    const selectedStudent = students.find(s => s.studentId === studentId);
    const current = currentByStudent.get(studentId);

    return (
        <div className="flex flex-col h-full bg-gray-100">
            {/* Controls are not part of the document, so they never print. */}
            <div className="no-print bg-white border-b border-gray-200 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="rcTerm" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                             {t('markEntryScreen.term')}
                        </label>
                        <select
                            id="rcTerm"
                            value={termId}
                            onChange={e => setTermId(e.target.value)}
                            className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                             {t('reportCardScreen.term')}
                            {terms.map(t => (
                                <option key={t.id} value={t.id}>
                                    {t.name}{t.status === 'CURRENT' ? ' (semasa)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rcClass" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {t('reportCardScreen.class')}
                        </label>
                        <select
                            id="rcClass"
                            value={classId}
                            onChange={e => setClassId(e.target.value)}
                            className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {classes.length === 0 && <option value="">{t('reportCardScreen.tiadaKelas')}</option>}
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.displayName}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rcStudent" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            {t('reportCardScreen.student')}
                        </label>
                        <select
                            id="rcStudent"
                            value={studentId}
                            onChange={e => setStudentId(e.target.value)}
                            className="w-full p-2.5 bg-white border border-gray-200 rounded-xl font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
                        >
                            {students.length === 0 && <option value="">{t('reportCardScreen.tiadaPelajar')}</option>}
                            {students.map(s => (
                                <option key={s.studentId} value={s.studentId}>
                                    {s.fullName}{currentByStudent.get(s.studentId) ? ' ✓' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Draft or issued: the distinction that matters most here. */}
                    <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setIsPreview(false)}
                            className={`px-3 py-2 text-sm font-semibold transition-colors ${
                                !isPreview ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {t('reportCardScreen.kadDiterbitkan')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsPreview(true)}
                            className={`px-3 py-2 text-sm font-semibold transition-colors ${
                                isPreview ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {t('reportCardScreen.pratontonDraf')}
                        </button>
                    </div>

                    <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('reportCardScreen.sebabPilihan')}
                        aria-label="Sebab"
                        className="flex-1 min-w-[10rem] text-sm p-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500"
                    />

                    <button
                        type="button"
                        onClick={handlePrint}
                        disabled={!shown}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                        <PrinterIcon className="w-4 h-4" />
                        {t('reportCardScreen.print')}
                    </button>

                    <button
                        type="button"
                        onClick={handlePublish}
                        disabled={isBusy || !studentId || !termId || isPreview}
                        title={isPreview ? t('reportCardScreen.switchToPublishedToPublish') : undefined}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                        <LockIcon className="w-4 h-4" />
                        {isBusy ? t('reportCardScreen.publishing') : published?.status === 'PUBLISHED' ? t('reportCardScreen.publishNewRevision') : t('reportCardScreen.publish')}
                    </button>
                </div>

                {/* Which revision is on file, stated plainly. */}
                {!isPreview && published && (
                    <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <CheckCircleIcon className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <p className="text-emerald-800">
                            Revisi <span className="font-semibold">{published.version}</span> sedang
                            dipaparkan
                            {published.version > 1
                                ? ' — ini pembetulan, dan revisi sebelum ini masih disimpan sebagai rekod.'
                                : '.'}
                        </p>
                    </div>
                )}

                {isPreview && (
                    <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <ExclamationIcon className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-amber-800">
                            {t('reportCardScreen.previewExplanation')}
                        </p>
                    </div>
                )}

                {!isPreview && !published && (
                    <div className="flex items-start gap-2 text-sm bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <ExclamationIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                        <p className="text-gray-700">
                            {t('reportCardScreen.noReportCardYetSwitchTo')}
                        </p>
                    </div>
                )}

                {!schoolQuery.data?.name && (
                    <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <ExclamationIcon className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-amber-800">
                             {t('reportCardScreen.schoolInfoIncomplete')}
                        </p>
                    </div>
                )}
            </div>

            {/* The document itself. */}
            <main className="flex-grow overflow-y-auto p-4 pb-28 lg:pb-4">
                {(isLoading || studentsQuery.isLoading) && <CenteredLoader />}

                {!isLoading && !studentsQuery.isLoading && students.length === 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                        <UsersIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                        <p className="font-semibold text-gray-700">{t('reportCardScreen.tiadaPelajarAktifDalamKelasIni')}</p>
                        <p className="text-sm text-gray-500 mt-1">
                             {t('reportCardScreen.enrolStudentToClassFirst')}
                        </p>
                    </div>
                )}

                {!isLoading && students.length > 0 && !shown && (
                    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                        <LockIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                        <p className="font-semibold text-gray-700">
                            Tiada kad laporan diterbitkan untuk t('reportCardScreen.thisStudent')
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                             {t('reportCardScreen.switchToDraftPreview')}
                        </p>
                    </div>
                )}

                {shown && (
                    <div className="max-w-3xl mx-auto">
                        <ReportSheet
                            snapshot={shown}
                            school={schoolQuery.data ?? null}
                            isDraft={isPreview}
                            gradeBoundaries={boundaries}
                            version={isPreview ? null : published?.version ?? null}
                        />
                        {/* On screen a draft watermark is shown too, not only in print. */}
                        {isPreview && (
                            <p className="no-print mt-3 text-center text-xs font-bold uppercase tracking-widest text-amber-700">
                                {t('reportCardScreen.draftNotYetPublished')}
                            </p>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
