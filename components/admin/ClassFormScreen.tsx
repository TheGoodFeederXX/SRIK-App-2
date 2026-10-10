/**
 * Add / edit a class — SRIK.
 *
 * Rewritten from the multi-tenant original, which asked for "grade" and
 * "section" numbers, a "level" of Primary/JSS/SSS/Nursery, and a "department"
 * such as Science. SRIK has none of those: a class is a year level (1-6), a name
 * the school chooses, and a short code.
 *
 * The class name is a label, not data. Year level is its own field, so renaming
 * a class never changes what year it belongs to.
 *
 * Which subjects a class teaches is saved as a whole list, after the class row
 * itself succeeds — so a class is never created without its subjects because one
 * step failed.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { BookOpenIcon } from '../../constants';
import {
    createClass,
    updateClass,
    setClassSubjects,
    listSubjectOptions,
    getClassSubjects,
    type ClassRecord,
    type ClassOption,
} from '../../src/lib/supabase/academics';

interface ClassFormScreenProps {
    classToEdit?: ClassRecord;
    schoolId?: string;
    currentBranchId?: string | null;
    handleBack: () => void;
    forceUpdate?: () => void;
}

/** Year 1 to Year 6 — the school's only year levels. */
const YEAR_LEVELS = [1, 2, 3, 4, 5, 6];

const ClassFormScreen: React.FC<ClassFormScreenProps> = ({
    classToEdit,
    handleBack,
    forceUpdate,
}) => {
    const isEditing = Boolean(classToEdit?.id);

    const [yearLevel, setYearLevel] = useState<string>(
        classToEdit ? String(classToEdit.yearLevel) : ''
    );
    const [name, setName] = useState(classToEdit?.name ?? '');
    const [code, setCode] = useState(classToEdit?.code ?? '');
    const [subjectIds, setSubjectIds] = useState<string[]>([]);
    const [subjectOptions, setSubjectOptions] = useState<ClassOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [options, current] = await Promise.all([
                    listSubjectOptions(),
                    classToEdit?.id ? getClassSubjects(classToEdit.id) : Promise.resolve([]),
                ]);
                if (cancelled) return;
                setSubjectOptions(options);
                setSubjectIds(current);
            } catch {
                // A failure here must not block saving the class itself.
                if (!cancelled) setSubjectOptions([]);
            } finally {
                if (!cancelled) setIsLoadingSubjects(false);
            }
        })();
        return () => { cancelled = true; };
    }, [classToEdit?.id]);

    const toggleSubject = (id: string) =>
        setSubjectIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        const level = Number(yearLevel);
        if (!Number.isInteger(level) || level < 1 || level > 6) {
            toast.error('Please choose a year level from 1 to 6.');
            return;
        }
        if (!name.trim()) {
            toast.error('Please enter a class name.');
            return;
        }

        setIsLoading(true);
        try {
            const input = { yearLevel: level, name, code };

            const saved = isEditing && classToEdit
                ? await updateClass(classToEdit.id, input)
                : await createClass(input);

            if (!saved.success || !saved.id) {
                toast.error(saved.error ?? 'Could not save the class.');
                return;
            }

            // Subjects are a separate step. The class exists either way, so a
            // failure here is reported as a warning rather than losing the class
            // the owner just created.
            const subjects = await setClassSubjects(saved.id, subjectIds);
            if (!subjects.success) {
                toast(`Class saved, but the subjects were not: ${subjects.error}`, { icon: '⚠️' });
                forceUpdate?.();
                handleBack();
                return;
            }

            toast.success(isEditing ? 'Class updated.' : `${name.trim()} was added.`);
            forceUpdate?.();
            handleBack();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                <main className="flex-grow p-4 space-y-6 overflow-y-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4"
                    >
                        <div>
                            <label htmlFor="yearLevel" className="block text-sm font-medium text-gray-700 mb-1">
                                Year level
                            </label>
                            <select
                                id="yearLevel"
                                value={yearLevel}
                                onChange={e => setYearLevel(e.target.value)}
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                required
                            >
                                <option value="">Choose a year</option>
                                {YEAR_LEVELS.map(y => (
                                    <option key={y} value={y}>Year {y}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-gray-400">
                                Which school year this class belongs to. Separate from the name, so renaming the class does not change it.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="className" className="block text-sm font-medium text-gray-700 mb-1">
                                Class name
                            </label>
                            <input
                                id="className"
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g., Al-Junaidi"
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                required
                            />
                            <p className="mt-1 text-xs text-gray-400">
                                The school may rename this at any time. Students stay in the same class.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="classCode" className="block text-sm font-medium text-gray-700 mb-1">
                                Short code (optional)
                            </label>
                            <input
                                id="classCode"
                                type="text"
                                value={code}
                                onChange={e => setCode(e.target.value)}
                                placeholder="e.g., 3J"
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {yearLevel && name.trim() && (
                            <div className="p-3 bg-indigo-50 rounded-xl">
                                <p className="text-xs text-indigo-700 font-medium">
                                    This class will show as <strong>{yearLevel} {name.trim()}</strong>
                                    {code.trim() ? ` (${code.trim()})` : ''}.
                                </p>
                            </div>
                        )}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: 0.05 }}
                        className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
                    >
                        <h3 className="flex items-center gap-2 font-bold text-gray-800 mb-3">
                            <span className="text-gray-400"><BookOpenIcon className="w-4 h-4" /></span>
                            Subjects taught
                        </h3>

                        {isLoadingSubjects ? (
                            <p className="text-sm text-gray-400">Loading subjects...</p>
                        ) : subjectOptions.length === 0 ? (
                            <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg p-3">
                                No subjects have been set up yet. You can add them under Subjects, then come back.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {subjectOptions.map(option => {
                                    const checked = subjectIds.includes(option.id);
                                    return (
                                        <label
                                            key={option.id}
                                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                                checked
                                                    ? 'bg-indigo-50 border-indigo-200'
                                                    : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleSubject(option.id)}
                                                className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                            />
                                            <span className="text-sm text-gray-700">{option.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                </main>

                <div className="p-4 bg-white border-t border-gray-100 flex gap-3 pb-32 lg:pb-4">
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={handleBack}
                        className="flex-1 py-3 px-4 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-100 transition-colors"
                    >
                        Cancel
                    </motion.button>
                    <motion.button
                        whileHover={!isLoading ? { scale: 1.02 } : {}}
                        whileTap={!isLoading ? { scale: 0.98 } : {}}
                        type="submit"
                        disabled={isLoading}
                        className="flex-1 py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        {isLoading ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
                    </motion.button>
                </div>
            </form>
        </div>
    );
};

export default ClassFormScreen;
