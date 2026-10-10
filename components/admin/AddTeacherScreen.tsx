/**
 * Add / edit a teacher — SRIK.
 *
 * REWRITTEN, not patched. The previous version was built for a multi-tenant
 * Nigerian SaaS: it asked which BRANCH the teacher belonged to, whether their
 * curriculum was Nigerian or British, for a TRCN certificate, offered classes
 * named "SSS 1"/"JSS 2", and enforced a subscription limit. None of that exists
 * in SRIK, which is one school teaching Years 1-6. Roughly 92 references to
 * those concepts had to go, and the remaining form was simpler than what
 * surrounded them.
 *
 * What replaced them:
 *   * one school        -> no branch picker at all
 *   * Years 1-6         -> classes come from the current academic year
 *   * subjects by ID    -> subjects come from the subjects table
 *   * no SaaS billing   -> no upgrade modal, no usage limit
 *
 * The visual language is deliberately unchanged: white cards, gray-50 inputs,
 * the same InputField row shape and a sticky bottom submit. This is a new form,
 * not a new look.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import {
    UserIcon,
    MailIcon,
    PhoneIcon,
    BookOpenIcon,
    UsersIcon,
    CheckCircleIcon,
} from '../../constants';
import {
    createTeacherWithAccount,
    updateTeacher,
    getTeacher,
    listSubjectOptions,
    listClassOptions,
    getCurrentAcademicYearId,
    setTeacherAssignments,
    provisionTeacherAccount,
    type Option,
} from '../../src/lib/supabase/teachers';
import CredentialsModal from '../ui/CredentialsModal';

interface AddTeacherScreenProps {
    /** When present the form edits an existing teacher instead of creating one. */
    teacherToEdit?: { id: string; name?: string; email?: string };
    forceUpdate: () => void;
    handleBack: () => void;
    navigateTo?: (view: string, title: string, props?: any) => void;
}

/** A labelled checkbox list, styled like the existing form controls. */
const CheckList: React.FC<{
    label: string;
    options: Option[];
    selected: string[];
    onToggle: (id: string) => void;
    emptyHint: string;
    icon: React.ReactNode;
}> = ({ label, options, selected, onToggle, emptyHint, icon }) => (
    <div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <span className="text-gray-400">{icon}</span>
            {label}
        </label>
        {options.length === 0 ? (
            <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg p-3">
                {emptyHint}
            </p>
        ) : (
            <div className="space-y-2">
                {options.map(option => {
                    const checked = selected.includes(option.id);
                    return (
                        <label
                            key={option.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                checked
                                    ? 'bg-blue-50 border-blue-200'
                                    : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(option.id)}
                                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{option.label}</span>
                        </label>
                    );
                })}
            </div>
        )}
    </div>
);

const InputField: React.FC<{
    id: string;
    label: string;
    value: string;
    onChange: (val: string) => void;
    icon: React.ReactNode;
    type?: string;
    required?: boolean;
}> = ({ id, label, value, onChange, icon, type = 'text', required = true }) => (
    <div>
        <label htmlFor={id} className="text-sm font-medium text-gray-600 sr-only">{label}</label>
        <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">{icon}</span>
            <input
                type={type}
                name={id}
                id={id}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full pl-10 pr-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                placeholder={label}
                required={required}
            />
        </div>
    </div>
);

const AddTeacherScreen: React.FC<AddTeacherScreenProps> = ({
    teacherToEdit,
    forceUpdate,
    handleBack,
}) => {
    const isEditing = Boolean(teacherToEdit?.id);

    const [staffCode, setStaffCode] = useState('');
    const [name, setName] = useState('');
    const [gender, setGender] = useState<'' | 'MALE' | 'FEMALE'>('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [employmentStart, setEmploymentStart] = useState('');
    const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'ARCHIVED'>('ACTIVE');
    const [createAccount, setCreateAccount] = useState(true);

    const [subjectOptions, setSubjectOptions] = useState<Option[]>([]);
    const [classOptions, setClassOptions] = useState<Option[]>([]);
    const [academicYearId, setAcademicYearId] = useState<string | null>(null);
    const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
    const [selectedClasses, setSelectedClasses] = useState<string[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    // Held so the temporary password can be shown exactly once.
    const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

    // Load the pickers. A failure here must not block the form: a teacher can
    // be added without duties, so an empty picker is a usable state and the
    // form explains why it is empty.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [subjects, classes, yearId] = await Promise.all([
                    listSubjectOptions(),
                    listClassOptions(),
                    getCurrentAcademicYearId(),
                ]);
                if (cancelled) return;
                setSubjectOptions(subjects);
                setClassOptions(classes);
                setAcademicYearId(yearId);
            } catch (error) {
                console.error('Could not load the subject/class lists:', error);
                if (!cancelled) toast.error('Could not load the subject and class lists');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // When editing, fill the form from the database rather than trusting the
    // object the caller passed, which may be stale.
    useEffect(() => {
        if (!teacherToEdit?.id) return;
        let cancelled = false;
        (async () => {
            try {
                const existing = await getTeacher(teacherToEdit.id);
                if (!existing || cancelled) return;
                setStaffCode(existing.staffCode);
                setName(existing.fullName);
                setGender(existing.gender ?? '');
                setEmail(existing.email ?? '');
                setPhone(existing.phone ?? '');
                setEmploymentStart(existing.employmentStart ?? '');
                setStatus(existing.status);
                // Subjects and classes come back as names; map them to ids so
                // the checkboxes can show what is already assigned.
                const subjectIds = subjectOptions
                    .filter(o => existing.subjects.includes(o.label))
                    .map(o => o.id);
                const classIds = classOptions
                    .filter(o => existing.classes.includes(o.label))
                    .map(o => o.id);
                setSelectedSubjects(subjectIds);
                setSelectedClasses(classIds);
            } catch (error) {
                console.error('Could not load the teacher:', error);
                toast.error('Could not load this teacher');
            }
        })();
        return () => { cancelled = true; };
        // Deliberately keyed on the teacher only: re-running when the option
        // lists arrive would discard edits the owner has already made.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teacherToEdit?.id]);

    const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
        setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!staffCode.trim() || !name.trim()) {
            toast.error('Staff code and full name are required');
            return;
        }
        if (!isEditing && createAccount && !email.trim()) {
            toast.error('An email address is needed to create a login account');
            return;
        }

        setIsLoading(true);

        try {
            const input = {
                staffCode,
                fullName: name,
                gender: gender === '' ? null : gender,
                phone: phone || null,
                email: email || null,
                employmentStart: employmentStart || null,
                status,
            };

            if (isEditing) {
                const result = await updateTeacher(teacherToEdit!.id, input);
                if (!result.success) {
                    toast.error(result.error || 'Could not save the teacher');
                    return;
                }
                if (academicYearId) {
                    const assignments = await setTeacherAssignments(
                        teacherToEdit!.id, academicYearId, selectedClasses, selectedSubjects
                    );
                    if (!assignments.success) {
                        // The teacher saved, so this is a partial success and is
                        // reported as such rather than as a total failure.
                        toast.error(`Teacher saved, but duties were not: ${assignments.error}`);
                        forceUpdate();
                        handleBack();
                        return;
                    }
                }
                toast.success('Teacher updated');
                forceUpdate();
                handleBack();
                return;
            }

            const result = await createTeacherWithAccount(input, {
                createAccount,
                academicYearId,
                classIds: selectedClasses,
                subjectIds: selectedSubjects,
            });

            if (!result.success) {
                toast.error(result.error || 'Could not save the teacher');
                return;
            }

            // A teacher can be saved while the login account fails (a duplicate
            // email, say). Saying so plainly is better than claiming success and
            // leaving the owner to discover it later.
            if (result.accountWarning) {
                toast.error(result.accountWarning);
                forceUpdate();
                handleBack();
                return;
            }

            toast.success('Teacher saved');

            // The temporary password exists only in the reply from the account
            // step. Showing it here is the one chance to pass it on, so the
            // owner is told plainly to record it now.
            if (createAccount && result.temporaryPassword) {
                setCredentials({ email: email.trim().toLowerCase(), password: result.temporaryPassword });
                return;
            }

            forceUpdate();
            handleBack();
        } catch (error: any) {
            console.error('Failed to save the teacher:', error);
            toast.error(error?.message || 'Could not save the teacher');
        } finally {
            setIsLoading(false);
        }
    };

    /** Creates a login account for a teacher who has none yet (edit mode). */
    const handleCreateAccount = async () => {
        if (!teacherToEdit?.id || !email.trim()) {
            toast.error('An email address is required');
            return;
        }
        setIsLoading(true);
        try {
            const result = await provisionTeacherAccount(teacherToEdit.id, email, name);
            if (result.success) {
                toast.success('Login account created');
                forceUpdate();
            } else {
                toast.error(result.accountWarning || 'Could not create the login account');
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                <main className="flex-grow p-4 space-y-6 overflow-y-auto">

                    {/* Identity */}
                    <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
                        <InputField id="staffCode" label="Staff Code" value={staffCode}
                            onChange={setStaffCode} icon={<UserIcon className="w-5 h-5" />} />
                        <InputField id="name" label="Full Name" value={name}
                            onChange={setName} icon={<UserIcon className="w-5 h-5" />} />
                        <InputField id="email" label="Email" value={email}
                            onChange={setEmail} icon={<MailIcon className="w-5 h-5" />} type="email"
                            required={createAccount} />
                        <InputField id="phone" label="Phone" value={phone}
                            onChange={setPhone} icon={<PhoneIcon className="w-5 h-5" />} type="tel"
                            required={false} />

                        <div>
                            <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                            <select id="gender" value={gender}
                                onChange={e => setGender(e.target.value as '' | 'MALE' | 'FEMALE')}
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-700">
                                <option value="">Not stated</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                            </select>
                        </div>

                        <div>
                            <label htmlFor="employmentStart" className="block text-sm font-medium text-gray-700 mb-1">Employment Start</label>
                            <input id="employmentStart" type="date" value={employmentStart}
                                onChange={e => setEmploymentStart(e.target.value)}
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-700" />
                        </div>

                        {isEditing && (
                            <div>
                                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                                <select id="status" value={status}
                                    onChange={e => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED')}
                                    className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-700">
                                    <option value="ACTIVE">Active</option>
                                    <option value="INACTIVE">Inactive</option>
                                    <option value="ARCHIVED">Archived</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Duties */}
                    <div className="bg-white p-4 rounded-lg shadow-sm space-y-6">
                        <CheckList
                            label="Classes Taught"
                            options={classOptions}
                            selected={selectedClasses}
                            onToggle={id => toggle(selectedClasses, setSelectedClasses, id)}
                            emptyHint="No classes yet. Create classes for the current academic year first."
                            icon={<UsersIcon className="w-5 h-5" />}
                        />
                        <CheckList
                            label="Subjects Taught"
                            options={subjectOptions}
                            selected={selectedSubjects}
                            onToggle={id => toggle(selectedSubjects, setSelectedSubjects, id)}
                            emptyHint="No subjects yet. Add subjects before assigning them."
                            icon={<BookOpenIcon className="w-5 h-5" />}
                        />
                        {selectedSubjects.length > 0 && selectedClasses.length === 0 && (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                                A subject is taught to a class, so pick at least one class for these
                                subjects to be recorded.
                            </p>
                        )}
                    </div>

                    {/* Login account */}
                    {!isEditing ? (
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" checked={createAccount}
                                    onChange={e => setCreateAccount(e.target.checked)}
                                    className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                                <span>
                                    <span className="block text-sm font-medium text-gray-700">
                                        Create a login account
                                    </span>
                                    <span className="block text-xs text-gray-500 mt-1">
                                        A temporary password is shown once after saving. The teacher
                                        must change it the first time they sign in.
                                    </span>
                                </span>
                            </label>
                        </div>
                    ) : (
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <p className="text-sm text-gray-600 mb-3">
                                Create a login account for this teacher if they do not have one yet.
                            </p>
                            <button type="button" onClick={handleCreateAccount} disabled={isLoading}
                                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50">
                                <CheckCircleIcon className="w-5 h-5" />
                                Create Login Account
                            </button>
                        </div>
                    )}
                </main>

                <div className="p-4 mt-auto bg-gray-50">
                    <motion.button
                        whileHover={!isLoading ? { scale: 1.01 } : {}}
                        whileTap={!isLoading ? { scale: 0.98 } : {}}
                        type="submit"
                        disabled={isLoading}
                        className={`w-full flex justify-center py-3 px-4 rounded-lg text-white ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
                    >
                        {isLoading ? 'Saving...' : (isEditing ? 'Update Teacher' : 'Save Teacher')}
                    </motion.button>
                </div>
            </form>

            {credentials && (
                <CredentialsModal
                    isOpen
                    userName={name}
                    username={credentials.email}
                    password={credentials.password}
                    email={credentials.email}
                    userType="Teacher"
                    onClose={() => {
                        setCredentials(null);
                        forceUpdate();
                        handleBack();
                    }}
                />
            )}
        </div>
    );
};

export default AddTeacherScreen;
