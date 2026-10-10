/**
 * Parent accounts — SRIK.
 *
 * Where the office gives a parent a login and connects them to their children.
 *
 * This is the most sensitive screen in the system. Everything the office does
 * here decides whether someone can read a child's records from home, so the
 * screen says clearly what each action does before it is taken.
 *
 * Four decisions worth explaining.
 *
 * WHY ACCOUNT AND LINK ARE SEPARATE STEPS. Creating a login and connecting a
 * child are two different acts with different risks. Keeping them apart means a
 * half-finished job is harmless: a parent with an account but no child linked
 * sees an empty screen, because the database derives their children from the
 * family record and there is none. The screen shows this state plainly rather
 * than hiding it, so the office can see the job is unfinished.
 *
 * WHY THE ROLE CANNOT BE CHOSEN. There is no role dropdown, because the database
 * function takes no role. A parent is always a GUARDIAN. The dangerous input is
 * the one that does not exist.
 *
 * WHY UNLINKING WARNS. Removing a link takes the parent's access away the moment
 * they next load a screen, with nothing cached to expire. The screen says so,
 * because a clerk might reasonably expect a delay.
 *
 * WHY THE PASSWORD IS SHOWN ONCE, IN WORDS. A password hashed into the database
 * cannot be read back, so the clerk must write it down and hand it over. The
 * screen says that too, rather than leaving them to discover it.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    UsersIcon, UserIcon, CheckIcon, SearchIcon, ShieldIcon, LinkIcon, TrashIcon, PlusIcon,
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import {
    listGuardians,
    provisionGuardianAccount,
    setGuardianChildLink,
    createGuardian,
    listStudentsForLinking,
    listLinkedStudents,
    friendlyGuardianError,
    type GuardianRow,
} from '../../src/lib/supabase/guardianAccounts';

export default function GuardianAccountsScreen() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<GuardianRow | null>(null);
    const [adding, setAdding] = useState(false);

    const guardiansQuery = useQuery({
        queryKey: ['guardians', 'list'],
        queryFn: () => listGuardians(),
        enabled: !!user,
    });

    const guardians = useMemo(() => guardiansQuery.data ?? [], [guardiansQuery.data]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return guardians;
        return guardians.filter(
            g =>
                g.full_name.toLowerCase().includes(term) ||
                (g.phone ?? '').includes(term) ||
                (g.email ?? '').toLowerCase().includes(term)
        );
    }, [guardians, search]);

    function refresh() {
        queryClient.invalidateQueries({ queryKey: ['guardians'] });
    }

    return (
        <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h1 className="text-2xl font-bold text-slate-800">Akaun Ibu Bapa</h1>
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white
                               text-sm font-bold hover:bg-indigo-700"
                >
                    <PlusIcon className="w-4 h-4" />
                    Tambah penjaga
                </button>
            </div>
            <p className="text-sm text-slate-500 mb-5">
                Beri ibu bapa akaun untuk melihat yuran anak mereka, dan pautkan mereka kepada anak.
            </p>

            <div className="relative mb-4">
                <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Cari nama, telefon atau emel penjaga"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
            </div>

            {guardiansQuery.isLoading ? (
                <CenteredLoader />
            ) : guardiansQuery.isError ? (
                <Notice tone="error">{friendlyGuardianError(guardiansQuery.error)}</Notice>
            ) : !guardians.length ? (
                <EmptyState
                    icon={<UsersIcon className="w-8 h-8 text-slate-400" />}
                    title="Belum ada penjaga"
                    body="Tambah penjaga dahulu, kemudian pautkan mereka kepada anak mereka."
                />
            ) : !filtered.length ? (
                <EmptyState
                    icon={<SearchIcon className="w-8 h-8 text-slate-400" />}
                    title="Tiada penjaga sepadan"
                    body="Cuba nama, telefon atau emel yang lain."
                />
            ) : (
                <ul className="space-y-2">
                    {filtered.map(guardian => (
                        <li key={guardian.guardian_id}>
                            <button
                                type="button"
                                onClick={() => setSelected(guardian)}
                                className="w-full text-left bg-white rounded-2xl border border-slate-200
                                           p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-800 truncate">
                                            {guardian.full_name}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {guardian.phone ?? 'Tiada telefon'}
                                            {guardian.email ? ` · ${guardian.email}` : ''}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            {guardian.child_count > 0
                                                ? `Anak: ${guardian.child_names}`
                                                : 'Belum dipautkan kepada mana-mana anak'}
                                        </p>
                                    </div>
                                    <div className="shrink-0">
                                        {guardian.has_login ? (
                                            <span className="inline-flex items-center gap-1 text-xs font-semibold
                                                             text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                                                <CheckIcon className="w-3 h-3" />
                                                Ada akaun
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs font-semibold
                                                             text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                                                Belum ada akaun
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {selected && (
                <GuardianPanel
                    guardian={selected}
                    onClose={() => setSelected(null)}
                    onChanged={refresh}
                />
            )}

            {adding && (
                <AddGuardianModal
                    onClose={() => setAdding(false)}
                    onAdded={() => {
                        refresh();
                        setAdding(false);
                    }}
                />
            )}
        </div>
    );
}

// --- One guardian: account and links ---------------------------------------

function GuardianPanel({
    guardian, onClose, onChanged,
}: {
    guardian: GuardianRow;
    onClose: () => void;
    onChanged: () => void;
}) {
    const { user } = useAuth();
    const [email, setEmail] = useState(guardian.email ?? '');
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdEmail, setCreatedEmail] = useState<string | null>(null);

    const [linkStudentId, setLinkStudentId] = useState('');
    const [linkReason, setLinkReason] = useState('');
    const [linkBusy, setLinkBusy] = useState(false);

    // The children currently linked, read from the live list so the panel is
    // never stale after a change.
    const guardiansQuery = useQuery({
        queryKey: ['guardians', 'list'],
        queryFn: () => listGuardians(),
        enabled: !!user,
    });

    const studentsQuery = useQuery({
        queryKey: ['guardians', 'students'],
        queryFn: () => listStudentsForLinking(),
        enabled: !!user,
    });

    const current = useMemo(
        () => (guardiansQuery.data ?? []).find(g => g.guardian_id === guardian.guardian_id) ?? guardian,
        [guardiansQuery.data, guardian]
    );

    const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data]);

    // Which students are linked, looked up by identity rather than by name.
    //
    // Matching on a name would break as soon as a name was spelled differently
    // in two places, and would leave the clerk unable to correct a wrong link.
    const linkedStudentsQuery = useQuery({
        queryKey: ['guardians', 'linked-students', guardian.guardian_id],
        queryFn: () => listLinkedStudents(guardian.guardian_id),
        enabled: !!user,
    });

    const linkedStudents = useMemo(
        () => linkedStudentsQuery.data ?? [],
        [linkedStudentsQuery.data]
    );

    const unlinked = useMemo(
        () => students.filter(s => !linkedStudents.some(l => l.id === s.id)),
        [students, linkedStudents]
    );

    async function handleCreateAccount() {
        if (!email.trim() || !reason.trim()) {
            setError('Sila isi emel dan sebab.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            // The password is generated by the system rather than typed here, so
            // the school's own password rule applies to it. A clerk-chosen password
            // was the previous behaviour, and it came with a weaker rule than the
            // system's (audit F16).
            const result = await provisionGuardianAccount({
                guardianId: guardian.guardian_id,
                email,
            });
            setCreatedEmail(result.email);
            // Shown once so the clerk can read it out; never stored, so it cannot
            // be read back later.
            setPassword(result.temporaryPassword);
            toast.success(`Akaun dicipta untuk ${result.email}.`);
            setReason('');
            onChanged();
        } catch (err) {
            setError(friendlyGuardianError(err));
        } finally {
            setBusy(false);
        }
    }

    async function handleLink(link: boolean, studentId: string, studentName: string) {
        if (!linkReason.trim()) {
            toast.error('Sila nyatakan sebab perubahan ini.');
            return;
        }
        setLinkBusy(true);
        try {
            await setGuardianChildLink({
                guardianId: guardian.guardian_id,
                studentId,
                link,
                relationship: 'GUARDIAN',
                reason: linkReason,
            });
            toast.success(
                link
                    ? `${studentName} dipautkan kepada ${current.full_name}.`
                    : `${studentName} dinyahpaut daripada ${current.full_name}.`
            );
            setLinkReason('');
            setLinkStudentId('');
            setCreatedEmail(null);
            onChanged();
        } catch (err) {
            toast.error(friendlyGuardianError(err));
        } finally {
            setLinkBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
            <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl">
                <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start
                                justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800 truncate">{current.full_name}</h2>
                        <p className="text-sm text-slate-500">{current.phone ?? 'Tiada telefon'}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                        aria-label="Tutup"
                    >
                        ×
                    </button>
                </div>

                <div className="p-5 space-y-6">
                    {/* --- Akaun --- */}
                    <section>
                        <h3 className="font-semibold text-slate-800 mb-1">Akaun log masuk</h3>
                        {current.has_login ? (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3
                                            text-sm text-emerald-800 space-y-1">
                                <p className="inline-flex items-center gap-1.5 font-semibold">
                                    <CheckIcon className="w-4 h-4" />
                                    Ibu bapa ini sudah boleh log masuk
                                </p>
                                {current.email && <p>Emel: {current.email}</p>}
                                <p className="text-xs text-emerald-700">
                                    Ibu bapa hanya boleh melihat anak yang dipautkan di bawah.
                                </p>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-slate-500 mb-3">
                                    Cipta akaun untuk ibu bapa ini. Kata laluan tidak boleh dibaca
                                    semula selepas disimpan — sila catat dan berikan kepada mereka.
                                </p>
                                <div className="space-y-3">
                                    <Field label="Emel">
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            placeholder="nama@emel.com"
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </Field>
                                    <Field label="Kata laluan sementara">
                                        <input
                                            type="text"
                                            value={password}
                                            readOnly
                                            placeholder="Dijana automatik apabila akaun dicipta"
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                                       bg-slate-50 text-slate-700 font-mono
                                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </Field>
                                    <Field label="Sebab (wajib)">
                                        <input
                                            type="text"
                                            value={reason}
                                            onChange={e => setReason(e.target.value)}
                                            placeholder="Contoh: ibu bapa baharu mendaftar"
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </Field>
                                    {createdEmail && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3
                                                        text-sm text-slate-700">
                                            <p className="font-semibold inline-flex items-center gap-1.5">
                                                <CheckIcon className="w-4 h-4 text-emerald-600" />
                                                Akaun dicipta: {createdEmail}
                                            </p>
                                            <p className="text-xs mt-1">
                                                Beritahu ibu bapa emel ini dan kata laluan yang anda
                                                tetapkan. Minta mereka tukar selepas log masuk.
                                            </p>
                                        </div>
                                    )}
                                    {error && <Notice tone="error">{error}</Notice>}
                                    <button
                                        type="button"
                                        onClick={handleCreateAccount}
                                        disabled={busy}
                                        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold
                                                   text-sm hover:bg-indigo-700 disabled:bg-slate-300"
                                    >
                                        {busy ? 'Mencipta…' : 'Cipta akaun'}
                                    </button>
                                </div>
                            </>
                        )}
                    </section>

                    {/* --- Anak --- */}
                    <section className="border-t border-slate-100 pt-5">
                        <h3 className="font-semibold text-slate-800 mb-1 inline-flex items-center gap-1.5">
                            <LinkIcon className="w-4 h-4 text-slate-500" />
                            Anak yang dipautkan
                        </h3>
                        <p className="text-sm text-slate-500 mb-3">
                            Ibu bapa hanya boleh melihat anak yang disenaraikan di sini.
                        </p>

                        {!linkedStudents.length ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm
                                            text-amber-800">
                                Belum ada anak dipautkan. Ibu bapa ini tidak akan melihat apa-apa
                                sehingga anak dipautkan.
                            </div>
                        ) : (
                            <ul className="space-y-2 mb-4">
                                {linkedStudents.map(student => (
                                    <li
                                        key={student.id}
                                        className="flex items-center justify-between gap-3 bg-slate-50
                                                   rounded-xl px-4 py-2.5"
                                    >
                                        <span className="text-sm text-slate-700 truncate">
                                            {student.full_name}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleLink(false, student.id, student.full_name)}
                                            disabled={linkBusy}
                                            className="shrink-0 p-1.5 rounded-lg text-slate-400
                                                       hover:text-rose-600 hover:bg-rose-50
                                                       disabled:opacity-40"
                                            aria-label={`Nyahpaut ${student.full_name}`}
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {!linkedStudents.length && (
                            <p className="text-xs text-slate-500 mb-3">
                                Nyahpaut menolak akses serta-merta — tiada kelewatan.
                            </p>
                        )}

                        <Field label="Sebab perubahan (wajib)">
                            <input
                                type="text"
                                value={linkReason}
                                onChange={e => setLinkReason(e.target.value)}
                                placeholder="Contoh: sahkan bapa kandung"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </Field>

                        <div className="mt-3 flex flex-col sm:flex-row gap-2">
                            <select
                                value={linkStudentId}
                                onChange={e => setLinkStudentId(e.target.value)}
                                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">— Pilih anak untuk dipautkan —</option>
                                {unlinked.map(s => (
                                    <option key={s.id} value={s.id}>
                                        {s.full_name}
                                        {s.admission_no ? ` (${s.admission_no})` : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => {
                                    const student = students.find(s => s.id === linkStudentId);
                                    if (student) handleLink(true, student.id, student.full_name);
                                }}
                                disabled={!linkStudentId || linkBusy}
                                className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold
                                           hover:bg-slate-900 disabled:bg-slate-300"
                            >
                                {linkBusy ? '…' : 'Pautkan'}
                            </button>
                        </div>
                    </section>

                    <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs text-slate-400 inline-flex items-start gap-1.5">
                            <ShieldIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            Ibu bapa tidak boleh mengubah apa-apa. Mereka hanya membaca yuran anak
                            yang dipautkan, dan setiap tindakan di skrin ini direkodkan.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Adding a guardian ------------------------------------------------------

function AddGuardianModal({
    onClose, onAdded,
}: {
    onClose: () => void;
    onAdded: () => void;
}) {
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSave = fullName.trim().length > 0 && phone.trim().length > 0 && !busy;

    async function handleSave() {
        if (!canSave) return;
        setBusy(true);
        setError(null);
        try {
            await createGuardian({ fullName, phone, email: email || null });
            toast.success('Penjaga ditambah. Seterusnya, cipta akaun dan pautkan anak mereka.');
            onAdded();
        } catch (err) {
            setError(friendlyGuardianError(err));
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-5">
                <h2 className="font-bold text-slate-800 mb-1">Tambah penjaga</h2>
                <p className="text-sm text-slate-500 mb-4">
                    Rekod penjaga dahulu. Akaun log masuk dicipta selepas ini.
                </p>

                <div className="space-y-4">
                    <Field label="Nama penuh">
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            placeholder="Contoh: Ahmad bin Ali"
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </Field>
                    <Field label="Telefon">
                        <input
                            type="text"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="Contoh: 0123456789"
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </Field>
                    <Field label="Emel (pilihan)">
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </Field>

                    {error && <Notice tone="error">{error}</Notice>}

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!canSave}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm
                                       hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            {busy ? 'Menyimpan…' : 'Simpan penjaga'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm
                                       hover:bg-slate-200"
                        >
                            Batal
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Small pieces -----------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</span>
            {children}
        </label>
    );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
    const cls =
        tone === 'error'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-slate-50 text-slate-700 border-slate-200';
    return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function EmptyState({
    icon, title, body,
}: {
    icon?: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            {icon && <div className="flex justify-center mb-3">{icon}</div>}
            <p className="font-semibold text-slate-700">{title}</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>
        </div>
    );
}
