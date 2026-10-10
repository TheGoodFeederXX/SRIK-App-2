/**
 * Guardians — SRIK.
 *
 * Rewritten from the multi-tenant original, which read from a separate
 * `parentService` and modelled parents as a third kind of user alongside
 * teachers and students. At SRIK a guardian is a *contact person* on a
 * student's record, not a login: the school's ~250 accounts are staff only.
 * Guardians appear here so the office can find a phone number quickly, and so
 * a guardian can be reused for several children in one family.
 *
 * The word used is "Guardian", matching the database. The original screen said
 * "Parent", which was not true of every contact the school holds.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { SearchIcon, MailIcon, PhoneIcon, PlusIcon, XIcon, EditIcon, TrashIcon, StudentsIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import { useAutoSync } from '../../hooks/useAutoSync';
import { listGuardians, saveGuardian, deleteGuardian, type GuardianRecord } from '../../src/lib/supabase/students';

interface GuardianListScreenProps {
    navigateTo?: (view: string, title: string, props?: any) => void;
}

const emptyForm = { id: '', fullName: '', phone: '', email: '', identityNo: '', address: '', occupation: '' };

const GuardianListScreen: React.FC<GuardianListScreenProps> = () => {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const queryKey = ['guardians'];

    const { data: guardians = [], isLoading, isError, error, refetch } = useQuery({
        queryKey,
        queryFn: () => listGuardians(),
        enabled: Boolean(user),
    });

    useAutoSync(['guardians'], () => queryClient.invalidateQueries({ queryKey }));

    const [search, setSearch] = useState('');
    const [form, setForm] = useState(emptyForm);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    /**
     * Search covers the guardian's own details and their children's names.
     *
     * The office usually starts from a child ("whose mother is this?"), so
     * searching by the student's name is as important as the guardian's.
     */
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return guardians;
        return guardians.filter(g =>
            g.fullName.toLowerCase().includes(q) ||
            g.phone.toLowerCase().includes(q) ||
            (g.email ?? '').toLowerCase().includes(q) ||
            g.children.some(c => c.fullName.toLowerCase().includes(q))
        );
    }, [guardians, search]);

    const openAdd = () => {
        setForm(emptyForm);
        setIsFormOpen(true);
    };

    const openEdit = (g: GuardianRecord) => {
        setForm({
            id: g.id,
            fullName: g.fullName,
            phone: g.phone,
            email: g.email ?? '',
            identityNo: g.identityNo ?? '',
            address: g.address ?? '',
            occupation: g.occupation ?? '',
        });
        setIsFormOpen(true);
    };

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!form.fullName.trim() || !form.phone.trim()) {
            toast.error('Please enter a name and a phone number.');
            return;
        }

        setIsSaving(true);
        try {
            const result = await saveGuardian({
                id: form.id || undefined,
                fullName: form.fullName,
                phone: form.phone,
                email: form.email,
                identityNo: form.identityNo,
                address: form.address,
                occupation: form.occupation,
            });

            if (!result.success) {
                toast.error(result.error ?? 'Could not save the guardian.');
                return;
            }
            toast.success(form.id ? 'Guardian updated.' : `${form.fullName.trim()} was added.`);
            await queryClient.invalidateQueries({ queryKey });
            setIsFormOpen(false);
            setForm(emptyForm);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (g: GuardianRecord) => {
        if (!window.confirm(`Remove ${g.fullName}? This cannot be undone.`)) return;

        const result = await deleteGuardian(g.id);
        if (!result.success) {
            toast.error(result.error ?? 'Could not remove the guardian.');
            return;
        }
        toast.success(`${g.fullName} was removed.`);
        await queryClient.invalidateQueries({ queryKey });
    };

    if (isLoading && guardians.length === 0) {
        return <CenteredLoader fullScreen={false} message="Loading guardians..." className="h-screen" />;
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-red-100 text-center m-2">
                <h3 className="font-bold text-gray-900 mb-1">Could not load guardians</h3>
                <p className="text-sm text-gray-500 mb-4">{String(error)}</p>
                <button
                    onClick={() => refetch()}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Try again
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-100 relative">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-32 lg:pb-4">
                <div className="flex justify-between items-center gap-3 px-1">
                    <div>
                        <p className="text-sm font-bold text-gray-800">
                            {guardians.length} {guardians.length === 1 ? 'Guardian' : 'Guardians'}
                        </p>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Emergency and contact people
                        </p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all shrink-0"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Add Guardian
                    </button>
                </div>

                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <SearchIcon className="w-4 h-4" />
                    </span>
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by guardian or child's name, phone, or email"
                        aria-label="Search guardians"
                        className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>

                {filtered.length > 0 ? (
                    <div className="space-y-2">
                        {filtered.map((g, i) => (
                            <motion.div
                                key={g.id}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.03 }}
                                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
                            >
                                <div className="flex items-start gap-3">
                                    <img
                                        src={`https://ui-avatars.com/api/?name=${encodeURIComponent(g.fullName)}`}
                                        alt={g.fullName}
                                        className="w-12 h-12 rounded-full object-cover ring-2 ring-gray-50"
                                    />
                                    <div className="flex-grow min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-bold text-gray-800 truncate">{g.fullName}</p>
                                            {g.children.some(c => c.isPrimary) && (
                                                <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-bold">
                                                    Main contact
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <PhoneIcon className="w-3 h-3" />
                                                {g.phone}
                                            </span>
                                            {g.email && (
                                                <span className="flex items-center gap-1 truncate">
                                                    <MailIcon className="w-3 h-3" />
                                                    {g.email}
                                                </span>
                                            )}
                                            {g.occupation && <span>{g.occupation}</span>}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => openEdit(g)}
                                            aria-label={`Edit ${g.fullName}`}
                                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                        >
                                            <EditIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(g)}
                                            aria-label={`Remove ${g.fullName}`}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {g.children.length > 0 ? (
                                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                                        {g.children.map(c => (
                                            <div key={`${c.studentId}-${c.relationship}`} className="flex items-center gap-2 text-sm">
                                                <StudentsIcon className="w-3 h-3 text-gray-300 shrink-0" />
                                                <span className="text-gray-700 truncate">{c.fullName}</span>
                                                {c.className && (
                                                    <span className="text-xs text-gray-400">{c.className}</span>
                                                )}
                                                <span className="text-xs text-gray-400">
                                                    ({c.relationship.toLowerCase()})
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 italic">
                                        Not linked to any student yet. Add them from the student's record.
                                    </p>
                                )}
                            </motion.div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                        <StudentsIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold text-gray-800">
                            {search ? 'No Matches' : 'No Guardians Yet'}
                        </h3>
                        <p className="text-gray-500 max-w-xs mx-auto mt-2">
                            {search
                                ? 'Try a different name, phone number, or email.'
                                : 'Guardians are added from a student\'s record, so each one is linked to a child.'}
                        </p>
                    </div>
                )}
            </main>

            <AnimatePresence>
                {isFormOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsFormOpen(false)}
                        className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex items-start justify-between">
                                <h2 className="text-lg font-bold text-gray-900">
                                    {form.id ? 'Edit guardian' : 'Add guardian'}
                                </h2>
                                <button
                                    onClick={() => setIsFormOpen(false)}
                                    aria-label="Close"
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <XIcon className="w-4 h-4" />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-3">
                                <div>
                                    <label htmlFor="guardianName" className="block text-sm font-medium text-gray-700 mb-1">
                                        Full name
                                    </label>
                                    <input
                                        id="guardianName"
                                        type="text"
                                        value={form.fullName}
                                        onChange={e => setForm({ ...form, fullName: e.target.value })}
                                        className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="guardianPhone" className="block text-sm font-medium text-gray-700 mb-1">
                                            Phone
                                        </label>
                                        <input
                                            id="guardianPhone"
                                            type="tel"
                                            value={form.phone}
                                            onChange={e => setForm({ ...form, phone: e.target.value })}
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="guardianEmail" className="block text-sm font-medium text-gray-700 mb-1">
                                            Email
                                        </label>
                                        <input
                                            id="guardianEmail"
                                            type="email"
                                            value={form.email}
                                            onChange={e => setForm({ ...form, email: e.target.value })}
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="guardianIc" className="block text-sm font-medium text-gray-700 mb-1">
                                            IC number
                                        </label>
                                        <input
                                            id="guardianIc"
                                            type="text"
                                            value={form.identityNo}
                                            onChange={e => setForm({ ...form, identityNo: e.target.value })}
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="guardianJob" className="block text-sm font-medium text-gray-700 mb-1">
                                            Occupation
                                        </label>
                                        <input
                                            id="guardianJob"
                                            type="text"
                                            value={form.occupation}
                                            onChange={e => setForm({ ...form, occupation: e.target.value })}
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="guardianAddress" className="block text-sm font-medium text-gray-700 mb-1">
                                        Address
                                    </label>
                                    <textarea
                                        id="guardianAddress"
                                        value={form.address}
                                        onChange={e => setForm({ ...form, address: e.target.value })}
                                        rows={2}
                                        className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>

                                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                                    To link this guardian to a child, open the student's record and add them there.
                                </p>

                                <div className="flex gap-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setIsFormOpen(false)}
                                        className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                    >
                                        {isSaving ? 'Saving...' : form.id ? 'Update' : 'Add'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default GuardianListScreen;
