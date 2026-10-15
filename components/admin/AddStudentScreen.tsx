/**
 * Add / edit a student — SRIK.
 *
 * Rewritten from the multi-tenant original, which collected branch, bus route,
 * parent-portal credentials, curriculum track and Nigerian/British grading. None
 * of that exists at SRIK: there is one school, students walk or are driven, and
 * a guardian is a contact rather than a system user. Keeping those fields would
 * have meant collecting information nothing reads.
 *
 * A student's class is stored as an enrolment, not a column on the student, so
 * registering them places them in a second step. If that step fails the student
 * still exists, and the screen says so plainly instead of discarding what was
 * typed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    User,
    Calendar,
    Phone,
    MapPin,
    GraduationCap,
    Users,
    Mail,
    History,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
    createStudentWithDetails,
    enrollStudent,
    getStudent,
    listClassOptions,
    suggestNextAdmissionNo,
    updateStudent,
    type ClassOption,
    type GuardianInput,
    type StudentInput,
} from '../../src/lib/supabase/students';

interface AddStudentScreenProps {
    /** Present when editing; absent when adding. */
    studentToEdit?: { id: string } | null;
    forceUpdate?: () => void;
    handleBack: () => void;
}

/** The same inline field used on the teacher screen, for a consistent form. */
const InputField: React.FC<{
    id: string;
    label: string;
    value: string;
    onChange: (val: string) => void;
    icon: React.ReactNode;
    type?: string;
    required?: boolean;
    hint?: string;
}> = ({ id, label, value, onChange, icon, type = 'text', required = true, hint }) => (
    <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-600 mb-1">
            {label}
        </label>
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
        {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
    title,
    icon,
    children,
}) => (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-bold text-gray-800">
            <span className="text-gray-400">{icon}</span>
            {title}
        </h3>
        {children}
    </div>
);

const AddStudentScreen: React.FC<AddStudentScreenProps> = ({
    studentToEdit,
    forceUpdate,
    handleBack,
}) => {
    const { t } = useTranslation();
    const isEditing = Boolean(studentToEdit?.id);
    const queryClient = useQueryClient();

    const [admissionNo, setAdmissionNo] = useState('');
    const [fullName, setFullName] = useState('');
    const [gender, setGender] = useState<'' | 'MALE' | 'FEMALE'>('');
    const [birthDate, setBirthDate] = useState('');
    const [birthPlace, setBirthPlace] = useState('');
    const [nationality, setNationality] = useState('Malaysia');
    const [identityNo, setIdentityNo] = useState('');
    const [address, setAddress] = useState('');
    const [previousSchool, setPreviousSchool] = useState('');
    const [admissionDate, setAdmissionDate] = useState(
        () => new Date().toISOString().slice(0, 10)
    );

    const [guardianName, setGuardianName] = useState('');
    const [guardianRelationship, setGuardianRelationship] = useState('Bapa');
    const [guardianPhone, setGuardianPhone] = useState('');
    const [guardianEmail, setGuardianEmail] = useState('');
    const [guardianOccupation, setGuardianOccupation] = useState('');

    const [classId, setClassId] = useState('');
    const [classOptions, setClassOptions] = useState<ClassOption[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingRecord, setIsLoadingRecord] = useState(isEditing);

    // Load the class list once. A missing CURRENT academic year yields no
    // classes rather than an error: a school with no year set up yet can still
    // register students and place them later.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const options = await listClassOptions();
                if (!cancelled) setClassOptions(options);
            } catch {
                if (!cancelled) setClassOptions([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // When adding, propose the next admission number. Left editable because a
    // school's own numbering may not follow this pattern.
    useEffect(() => {
        if (isEditing) return;
        let cancelled = false;
        (async () => {
            try {
                const suggested = await suggestNextAdmissionNo();
                if (!cancelled) setAdmissionNo(current => current || suggested);
            } catch {
                /* A suggestion is a convenience; failing to get one is not an error. */
            }
        })();
        return () => { cancelled = true; };
    }, [isEditing]);

    // Load the existing record when editing.
    useEffect(() => {
        if (!studentToEdit?.id) return;
        let cancelled = false;
        (async () => {
            setIsLoadingRecord(true);
            try {
                const s = await getStudent(studentToEdit.id);
                if (!s || cancelled) return;
                setAdmissionNo(s.admissionNo);
                setFullName(s.fullName);
                setGender(s.gender ?? '');
                setBirthDate(s.birthDate ?? '');
                setBirthPlace(s.birthPlace ?? '');
                setNationality(s.nationality ?? '');
                setIdentityNo(s.identityNo ?? '');
                setAddress(s.address ?? '');
                setPreviousSchool(s.previousSchool ?? '');
                setAdmissionDate(s.admissionDate);
                setClassId(s.classId ?? '');

                const primary = s.guardians.find(g => g.isPrimary) ?? s.guardians[0];
                if (primary) {
                    setGuardianName(primary.fullName);
                    setGuardianRelationship(primary.relationship);
                    setGuardianPhone(primary.phone);
                    setGuardianEmail(primary.email ?? '');
                }
            } catch (err) {
                if (!cancelled) {
                    toast.error(err instanceof Error ? err.message : t('addStudentScreen.couldNotLoadThisStudent'));
                }
            } finally {
                if (!cancelled) setIsLoadingRecord(false);
            }
        })();
        return () => { cancelled = true; };
    }, [studentToEdit?.id]);

    const input = useMemo<StudentInput>(() => ({
        admissionNo,
        fullName,
        gender: gender || null,
        birthDate: birthDate || null,
        birthPlace: birthPlace || null,
        nationality: nationality || null,
        identityNo: identityNo || null,
        address: address || null,
        previousSchool: previousSchool || null,
        admissionDate: admissionDate || null,
    }), [
        admissionNo, fullName, gender, birthDate, birthPlace,
        nationality, identityNo, address, previousSchool, admissionDate,
    ]);

    const guardian = useMemo<GuardianInput | null>(() => {
        if (!guardianName.trim() || !guardianPhone.trim()) return null;
        return {
            fullName: guardianName,
            relationship: guardianRelationship || 'Penjaga',
            phone: guardianPhone,
            email: guardianEmail || null,
            occupation: guardianOccupation || null,
            isPrimary: true,
            isEmergencyContact: true,
        };
    }, [guardianName, guardianRelationship, guardianPhone, guardianEmail, guardianOccupation]);

    const handleSubmit = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!admissionNo.trim() || !fullName.trim()) {
            toast.error(t('addStudentScreen.pleaseEnterTheAdmissionNumberAndTheStudent'));
            return;
        }

        setIsLoading(true);
        try {
            if (isEditing && studentToEdit?.id) {
                const result = await updateStudent(studentToEdit.id, input);
                if (!result.success) {
                    toast.error(result.error ?? t('addStudentScreen.couldNotSaveTheChanges'));
                    return;
                }
                // A class change is a separate, audited step.
                if (classId) {
                    const enrolled = await enrollStudent(studentToEdit.id, classId, 'Class changed by admin');
                    if (!enrolled.success) {
                        toast.error(`${t('addStudentScreen.savedButTheClassWasNotChanged')}: ${enrolled.error}`);
                        return;
                    }
                }
                toast.success(t('addStudentScreen.studentDetailsSaved'));
                await queryClient.invalidateQueries({ queryKey: ['students'] });
                forceUpdate?.();
                handleBack();
                return;
            }

            const result = await createStudentWithDetails(input, {
                classId: classId || null,
                guardian,
            });

            if (!result.success) {
                toast.error(result.error ?? t('addStudentScreen.couldNotRegisterTheStudent'));
                return;
            }

            // A partial failure is reported rather than hidden: the student
            // exists, and the owner needs to know what is still missing.
            if (result.warning) {
                toast(t('addStudentScreen.studentSavedBut', { warning: result.warning }), { icon: '⚠️' });
            } else {
                toast.success(`${fullName.trim()} has been registered.`);
            }

            await queryClient.invalidateQueries({ queryKey: ['students'] });
            forceUpdate?.();
            handleBack();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('addStudentScreen.somethingWentWrongPleaseTryAgain'));
        } finally {
            setIsLoading(false);
        }
    }, [
        admissionNo, fullName, input, isEditing, studentToEdit?.id, classId,
        guardian, queryClient, forceUpdate, handleBack,
    ]);

    if (isLoadingRecord) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-100">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <form id="student-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                <Section title={t('addStudentScreen.studentDetails')} icon={<User size={18} />}>
                    <InputField
                        id="admissionNo"
                        label={t('addStudentScreen.admissionNumber')}
                        value={admissionNo}
                        onChange={setAdmissionNo}
                        icon={<History size={18} />}
                        hint={t('addStudentScreen.usedOnReportCardsAndReceiptsMustBeUnique')}
                    />
                    <InputField
                        id="fullName"
                        label={t('addStudentScreen.studentFullName')}
                        value={fullName}
                        onChange={setFullName}
                        icon={<User size={18} />}
                    />

                    <div>
                        <label htmlFor="gender" className="block text-sm font-medium text-gray-600 mb-1">
                            Gender
                        </label>
                        <select
                            id="gender"
                            value={gender}
                            onChange={e => setGender(e.target.value as '' | 'MALE' | 'FEMALE')}
                            className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">{t('addStudentScreen.notStated')}</option>
                            <option value="MALE">{t('common.male')}</option>
                            <option value="FEMALE">{t('common.female')}</option>
                        </select>
                    </div>

                    <InputField
                        id="birthDate"
                        label={t('addStudentScreen.dateOfBirth')}
                        value={birthDate}
                        onChange={setBirthDate}
                        icon={<Calendar size={18} />}
                        type="date"
                        required={false}
                    />
                    <InputField
                        id="birthPlace"
                        label={t('addStudentScreen.placeOfBirth')}
                        value={birthPlace}
                        onChange={setBirthPlace}
                        icon={<MapPin size={18} />}
                        required={false}
                    />
                    <InputField
                        id="nationality"
                        label={t('addStudentScreen.nationality')}
                        value={nationality}
                        onChange={setNationality}
                        icon={<MapPin size={18} />}
                        required={false}
                    />
                    <InputField
                        id="identityNo"
                        label={t('addStudentScreen.identityCardNumber')}
                        value={identityNo}
                        onChange={setIdentityNo}
                        icon={<User size={18} />}
                        required={false}
                        hint={t('addStudentScreen.mykadOrBirthCertificateNumberIfAvailable')}
                    />
                    <InputField
                        id="address"
                        label={t('addStudentScreen.homeAddress')}
                        value={address}
                        onChange={setAddress}
                        icon={<MapPin size={18} />}
                        required={false}
                    />
                </Section>

                <Section title={t('addStudentScreen.schoolBackground')} icon={<GraduationCap size={18} />}>
                    <InputField
                        id="previousSchool"
                        label={t('addStudentScreen.previousSchool')}
                        value={previousSchool}
                        onChange={setPreviousSchool}
                        icon={<History size={18} />}
                        required={false}
                        hint={t('addStudentScreen.leaveBlankIfThisIsTheirFirstSchool')}
                    />
                    <InputField
                        id="admissionDate"
                        label={t('addStudentScreen.dateJoined')}
                        value={admissionDate}
                        onChange={setAdmissionDate}
                        icon={<Calendar size={18} />}
                        type="date"
                        required={false}
                    />

                    <div>
                        <label htmlFor="classId" className="block text-sm font-medium text-gray-600 mb-1">
                            Class
                        </label>
                        <select
                            id="classId"
                            value={classId}
                            onChange={e => setClassId(e.target.value)}
                            className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">{t('addStudentScreen.notAssignedYet')}</option>
                            {classOptions.map(c => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                        </select>
                        {classOptions.length === 0 && (
                            <p className="text-xs text-gray-400 mt-1">
                                No classes are set up for the current year yet. You can assign one later.
                            </p>
                        )}
                    </div>
                </Section>

                <Section title={t('addStudentScreen.parentOrGuardian')} icon={<Users size={18} />}>
                    <p className="text-sm text-gray-500">
                        At least a name and a phone number, so the school can reach the family.
                    </p>
                    <InputField
                        id="guardianName"
                        label={t('addStudentScreen.guardianName')}
                        value={guardianName}
                        onChange={setGuardianName}
                        icon={<User size={18} />}
                        required={false}
                    />
                    <div>
                        <label htmlFor="guardianRelationship" className="block text-sm font-medium text-gray-600 mb-1">
                            Relationship to the student
                        </label>
                        <select
                            id="guardianRelationship"
                            value={guardianRelationship}
                            onChange={e => setGuardianRelationship(e.target.value)}
                            className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="Bapa">{t('common.father')}</option>
                            <option value="Ibu">{t('common.mother')}</option>
                            <option value="Penjaga">{t('addStudentScreen.guardian')}</option>
                        </select>
                    </div>
                    <InputField
                        id="guardianPhone"
                        label={t('addStudentScreen.phoneNumber')}
                        value={guardianPhone}
                        onChange={setGuardianPhone}
                        icon={<Phone size={18} />}
                        type="tel"
                        required={false}
                    />
                    <InputField
                        id="guardianEmail"
                        label={t('addStudentScreen.emailIfAny')}
                        value={guardianEmail}
                        onChange={setGuardianEmail}
                        icon={<Mail size={18} />}
                        type="email"
                        required={false}
                    />
                    <InputField
                        id="guardianOccupation"
                        label={t('addStudentScreen.occupation')}
                        value={guardianOccupation}
                        onChange={setGuardianOccupation}
                        icon={<User size={18} />}
                        required={false}
                    />
                </Section>
            </form>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex gap-3">
                <button
                    type="button"
                    onClick={handleBack}
                    className="flex-1 py-3 text-gray-700 bg-gray-100 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                >
                    {t('common.cancel')}
                </button>
                <button
                    type="submit"
                    form="student-form"
                    disabled={isLoading}
                    className="flex-1 py-3 text-white bg-blue-600 font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                    {isLoading ? 'Saving...' : isEditing ? 'Save changes' : 'Register student'}
                </button>
            </div>
        </div>
    );
};

export default AddStudentScreen;
