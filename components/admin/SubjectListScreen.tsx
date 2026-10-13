/**
 * Subjects — SRIK.
 *
 * A new screen: the source project had no subject screen of its own. Subjects
 * were strings typed into a class form, which meant the same subject could exist
 * under several spellings and could not be renamed without breaking the records
 * that referred to it.
 *
 * Here a subject is a record with its own identity. A class refers to it by id,
 * so renaming "Matematik" does not detach it from any class that teaches it.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { BookOpenIcon, PlusIcon, EditIcon, TrashIcon, XIcon } from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import { useAuth } from '../../context/AuthContext';
import { useAutoSync } from '../../hooks/useAutoSync';
import {
    listSubjects,
    createSubject,
    updateSubject,
    deleteSubject,
    type SubjectRecord,
} from '../../src/lib/supabase/academics';

/** The starting set for a Malaysian Islamic primary school. */
const COMMON_CATEGORIES = ['Teras', 'Agama', 'Tambahan'];

export const SubjectListScreen: React.FC = () => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const queryKey = ['subjects'];

    const { data: subjects = [], isLoading, isError, error, refetch } = useQuery({
        queryKey,
        queryFn: () => listSubjects(),
        enabled: Boolean(user),
    });

    useAutoSync(['subjects'], () => queryClient.invalidateQueries({ queryKey }));

    const [editing, setEditing] = useState<SubjectRecord | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [form, setForm] = useState({ code: '', name: '', shortName: '', category: 'Teras' });
    const [isSaving, setIsSaving] = useState(false);

    const openAdd = () => {
        setEditing(null);
        setForm({ code: '', name: '', shortName: '', category: 'Teras' });
        setIsAdding(true);
    };

    const openEdit = (subject: SubjectRecord) => {
        setIsAdding(false);
        setEditing(subject);
        setForm({
            code: subject.code,
            name: subject.name,
            shortName: subject.shortName ?? '',
            category: subject.category ?? 'Teras',
        });
    };

    const closeForm = () => {
        setIsAdding(false);
        setEditing(null);
    };

    const isFormOpen = isAdding || Boolean(editing);

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!form.code.trim() || !form.name.trim()) {
            toast.error(t('subjectListScreen.pleaseEnterBothASubjectCodeAndAName'));
            return;
        }

        setIsSaving(true);
        try {
            const input = {
                code: form.code,
                name: form.name,
                shortName: form.shortName,
                category: form.category,
            };
            const result = editing
                ? await updateSubject(editing.id, input)
                : await createSubject(input);

            if (!result.success) {
                toast.error(result.error ?? t('subjectListScreen.couldNotSaveTheSubject'));
                return;
            }
            toast.success(editing ? 'Subject updated.' : `${form.name.trim()} was added.`);
            await queryClient.invalidateQueries({ queryKey });
            closeForm();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('subjectListScreen.somethingWentWrongPleaseTryAgain'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (subject: SubjectRecord) => {
        if (!window.confirm(`Remove ${subject.name}? This cannot be undone.`)) return;

        const result = await deleteSubject(subject.id);
        if (!result.success) {
            toast.error(result.error ?? t('subjectListScreen.couldNotRemoveTheSubject'));
            return;
        }
        toast.success(`${subject.name} was removed.`);
        await queryClient.invalidateQueries({ queryKey });
    };

    if (isLoading && subjects.length === 0) {
        return <CenteredLoader fullScreen={false} message={t('subjectListScreen.loadingSubjects')} className="h-screen" />;
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-red-100 text-center m-2">
                <h3 className="font-bold text-gray-900 mb-1">{t('subjectListScreen.couldNotLoadSubjects')}</h3>
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
                <div className="flex justify-between items-center px-2">
                    <div className="flex flex-col">
                        <p className="text-sm font-bold text-gray-800">
                            {subjects.length} {subjects.length === 1 ? t('subjectListScreen.subject') : t('subjectListScreen.subjects')}
                        </p>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Taught across the school's classes
                        </p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Add Subject
                    </button>
                </div>

                {subjects.length > 0 ? (
                    <div className="space-y-2">
                        {subjects.map((subject, i) => (
                            <motion.div
                                key={subject.id}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.03 }}
                                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between gap-3"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-bold text-gray-800 truncate">{subject.name}</p>
                                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-bold uppercase">
                                            {subject.code}
                                        </span>
                                        {subject.category && (
                                            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs font-semibold">
                                                {subject.category}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">
                                        {subject.classCount > 0
                                            ? `Taught in ${subject.classCount} ${subject.classCount === 1 ? 'class' : 'classes'}`
                                            : 'Not taught in any class yet'}
                                        {subject.status !== 'ACTIVE' && ` · ${subject.status}`}
                                    </p>
                                </div>

                                <div className="flex items-center space-x-1 shrink-0">
                                    <button
                                        onClick={() => openEdit(subject)}
                                        aria-label={`Edit ${subject.name}`}
                                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    >
                                        <EditIcon className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(subject)}
                                        aria-label={`Remove ${subject.name}`}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                        <BookOpenIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-bold text-gray-800">{t('subjectListScreen.noSubjectsYet')}</h3>
                        <p className="text-gray-500 max-w-xs mx-auto mt-2">
                            Add the subjects the school teaches, then choose them per class.
                        </p>
                        <button
                            onClick={openAdd}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all mt-6"
                        >
                            <PlusIcon className="w-4 h-4 inline mr-2" />
                            Add First Subject
                        </button>
                    </div>
                )}
            </main>

            <AnimatePresence>
                {isFormOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeForm}
                        className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl"
                        >
                            <div className="flex items-start justify-between">
                                <h2 className="text-lg font-bold text-gray-900">
                                    {editing ? t('subjectListScreen.editSubject') : t('subjectListScreen.addSubject')}
                                </h2>
                                <button
                                    onClick={closeForm}
                                    aria-label="Close"
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <XIcon className="w-4 h-4" />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-3">
                                <div>
                                    <label htmlFor="subjectName" className="block text-sm font-medium text-gray-700 mb-1">
                                        Subject name
                                    </label>
                                    <input
                                        id="subjectName"
                                        type="text"
                                        value={form.name}
                                        onChange={e => setForm({ ...form, name: e.target.value })}
                                        placeholder="e.g., Bahasa Melayu"
                                        className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="subjectCode" className="block text-sm font-medium text-gray-700 mb-1">
                                            Code
                                        </label>
                                        <input
                                            id="subjectCode"
                                            type="text"
                                            value={form.code}
                                            onChange={e => setForm({ ...form, code: e.target.value })}
                                            placeholder="e.g., BM"
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="subjectShort" className="block text-sm font-medium text-gray-700 mb-1">
                                            Short name
                                        </label>
                                        <input
                                            id="subjectShort"
                                            type="text"
                                            value={form.shortName}
                                            onChange={e => setForm({ ...form, shortName: e.target.value })}
                                            placeholder={t('subjectListScreen.optional')}
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="subjectCategory" className="block text-sm font-medium text-gray-700 mb-1">
                                        {t('subjectListScreen.category')}
                                    </label>
                                    <select
                                        id="subjectCategory"
                                        value={form.category}
                                        onChange={e => setForm({ ...form, category: e.target.value })}
                                        className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    >
                                        {COMMON_CATEGORIES.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex gap-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={closeForm}
                                        className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                    >
                                        {isSaving ? 'Saving...' : editing ? 'Update' : 'Add'}
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

export default SubjectListScreen;
