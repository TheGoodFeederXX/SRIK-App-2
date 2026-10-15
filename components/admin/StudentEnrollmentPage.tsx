import { useTranslation } from 'react-i18next';
﻿import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAutoSync } from '../../hooks/useAutoSync';
import { toast } from 'react-hot-toast';
import { UserIcon, BookOpenIcon, CheckCircleIcon, UploadIcon, IdentificationIcon, AcademicCapIcon, HomeIcon, PhoneIcon, MailIcon } from '../../constants';
import { useProfile } from '../../context/ProfileContext';
import { checkUserLimit } from '../../lib/usage-limits';
import { listClasses } from '../../src/lib/supabase/academics';
import { createStudent, enrollStudent, addGuardian } from '../../src/lib/supabase/students';
import { uploadFile } from '../../src/lib/supabase/storage';

interface EnrollmentPageProps {
    onComplete: () => void;
    handleBack: () => void;
    schoolId?: string;
    currentBranchId?: string;
}

const StudentEnrollmentPage: React.FC<EnrollmentPageProps> = ({ onComplete, handleBack, schoolId, currentBranchId }) => {
    const { t } = useTranslation();
    const { profile } = useProfile();
    const [loading, setLoading] = useState(false);

    const [availableClasses, setAvailableClasses] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        parentName: '',
        parentEmail: '',
        parentPhone: '',
        parentAddress: '',
        studentFirstName: '',
        studentLastName: '',
        studentDob: '',
        studentGender: 'Male',
        classId: '',
        grade: -3,
        section: 'A',
        // The school's curriculum, and the only one it follows. This was typed
        // 'KSSR' | 'BRITISH' | 'DUAL' and offered as three pickable cards, but the value
        // was never sent when the child was saved — so choosing British or Dual did
        // nothing except look as though it had. KSSR is what the school teaches.
        curriculum: 'KSSR'
    });
    const [uploadedDocs, setUploadedDocs] = useState<File[]>([]);

    const loadClasses = useCallback(async () => {
        const sid = schoolId || profile.schoolId;
        if (!sid) return;
        try {
            // There is one school and no branch to pass. The year level comes from
            // the class's own column rather than being read back out of its name.
            const classes = await listClasses();
            setAvailableClasses(classes as unknown as typeof availableClasses);
            if (classes.length > 0) {
                setFormData(prev => ({
                    ...prev,
                    classId: classes[0].id,
                    grade: classes[0].yearLevel,
                    section: '',
                }));
            }
        } catch (err) {
            console.error("Error loading classes:", err);
        }
    }, [schoolId, profile.schoolId]);

    useEffect(() => { loadClasses(); }, [loadClasses]);

    useAutoSync(['classes'], loadClasses);

    const selectedClass = useMemo(() => {
        return availableClasses.find(c => c.id === formData.classId);
    }, [availableClasses, formData.classId]);

    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        // Validation
        const required = ['parentName', 'parentEmail', 'parentPhone', 'studentFirstName', 'studentLastName', 'studentDob', 'classId'];
        const missing = required.filter(field => !formData[field as keyof typeof formData]);

        if (missing.length > 0) {
            toast.error(t('studentEnrollmentPage.pleaseFillInAllRequiredFields'));
            return;
        }

        if (profile.schoolId) {
            setLoading(true);
            const { allowed, count, limit } = await checkUserLimit(profile.schoolId);
            if (!allowed) {
                toast.error(t('studentEnrollmentPage.freeLimitReached', { count, limit }));
                setLoading(false);
                return;
            }
        }

        setLoading(true);
        try {
            // ENROLING A CHILD IS THREE REAL STEPS, and they used to be one call to a
            // server that is not deployed. The order matters: the child must exist
            // before they can be placed in a class, and the class placement must exist
            // before a guardian can be linked as that child's parent.
            //
            // A child is created first, so a failure part-way through leaves a student
            // record the office can see and finish — not a silent nothing.

            // The admission number is the school's own identifier. The form has no
            // field for it, so one is derived from the year and the child's name, and
            // the office can correct it afterwards.
            const admissionNo =
                `${new Date().getFullYear()}-${formData.studentFirstName.trim().toUpperCase().slice(0, 3)}`
                + `${Date.now().toString().slice(-4)}`;

            const created = await createStudent({
                admissionNo,
                fullName: `${formData.studentFirstName} ${formData.studentLastName}`.trim(),
                gender: (formData.studentGender as 'MALE' | 'FEMALE') || null,
                birthDate: formData.studentDob || null,
                address: formData.parentAddress || null,
                admissionDate: new Date().toISOString().slice(0, 10),
            });
            if (!created.success || !created.studentId) {
                throw new Error(created.error || 'The student could not be created.');
            }

            // Enrolment documents, attached to the child who now exists.
            if (uploadedDocs.length > 0) {
                try {
                    for (const file of uploadedDocs) {
                        await uploadFile({ type: 'STUDENT', id: created.studentId }, file);
                    }
                } catch (uploadErr: any) {
                    // The child EXISTS at this point, so failing the whole enrolment
                    // would be worse than carrying on and letting the office re-attach
                    // the paperwork.
                    console.error('Document upload error:', uploadErr);
                    toast.error(t('studentEnrollmentPage.theStudentWasSavedButSomeDocumentsDidNotUpload'));
                }
            }

            // Place the child in the class they were enrolled into.
            if (formData.classId) {
                const enrolled = await enrollStudent(created.studentId, formData.classId);
                if (!enrolled.success) {
                    throw new Error(enrolled.error || 'The student could not be placed in that class.');
                }
            }

            // Link the parent, so the child is not left with nobody able to see them.
            if (formData.parentName?.trim() && formData.parentPhone?.trim()) {
                await addGuardian(created.studentId, {
                    fullName: formData.parentName,
                    // "PARENT" is the default the enrolment form implies. The office
                    // can correct it on the child's record if it is wrong.
                    relationship: 'PARENT',
                    phone: formData.parentPhone,
                    email: formData.parentEmail || undefined,
                    address: formData.parentAddress || undefined,
                });
            }

            toast.success(t('studentEnrollmentPage.enrollmentSubmittedSuccessfully'));
            if (onComplete) onComplete(); else handleBack();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || t('studentEnrollmentPage.enrollmentFailed'));
        } finally {
            setLoading(false);
        }
    };

    const SelectCard = ({ value, title, desc, icon: Icon }: any) => (
        <motion.div
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            onClick={() => handleChange('curriculum', value)}
            className={`cursor-pointer p-4 rounded-xl border-2 transition-all relative overflow-hidden group ${formData.curriculum === value ? 'border-indigo-600 bg-indigo-50/50 shadow-md ring-1 ring-indigo-500' : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50'}`}
        >
            <div className={`absolute top-0 right-0 p-2 ${formData.curriculum === value ? 'text-indigo-600' : 'text-gray-200 group-hover:text-indigo-200'}`}>
                {formData.curriculum === value ? <CheckCircleIcon className="w-6 h-6" /> : <Icon className="w-12 h-12 opacity-20" />}
            </div>
            <h4 className={`font-bold text-lg mb-1 ${formData.curriculum === value ? 'text-indigo-900' : 'text-gray-700'}`}>{title}</h4>
            <p className="text-sm text-gray-500 leading-relaxed pr-6">{desc}</p>
        </motion.div>
    );

    return (
        <div className="w-full h-full bg-white flex flex-col overflow-hidden">

            {/* HEADER */}
            <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5 border-b border-gray-100 bg-white z-20">
                <div className="flex-1 min-w-0">
                    <h2 className="text-lg sm:text-2xl font-bold text-gray-900 flex items-center gap-2 truncate">
                        <UserIcon className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 shrink-0" />
                        New Student Enrollment
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-500 truncate sm:whitespace-normal">{t('studentEnrollmentPage.registerStudentAssignCurriculumAndUploadDocs')}</p>
                </div>
                <button onClick={handleBack} className="p-1 sm:p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors shrink-0 flex items-center gap-1 font-medium text-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    <span className="hidden sm:inline">{t('common.back')}</span>
                </button>
            </div>

            {/* SCROLLABLE CONTENT */}
            <div className="flex-grow overflow-y-auto bg-gray-50/50 p-4 sm:p-8 smooth-scroll">
                <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">

                        {/* LEFT COLUMN: PERSONAL DETAILS */}
                        <div className="lg:col-span-8 space-y-8">

                            {/* 1. STUDENT INFO */}
                            <section className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <h3 className="text-xs sm:text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 sm:mb-6 flex items-center gap-2 border-b border-gray-100 pb-2">
                                    <IdentificationIcon className="w-4 h-4" /> {t('studentEnrollmentPage.studentInformation')}
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.firstName')}</label>
                                        <input
                                            className="input-field"
                                            placeholder={t('common.exampleFirstName')}
                                            value={formData.studentFirstName}
                                            onChange={e => handleChange('studentFirstName', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.lastName')}</label>
                                        <input
                                            className="input-field"
                                            placeholder={t('common.exampleLastName')}
                                            value={formData.studentLastName}
                                            onChange={e => handleChange('studentLastName', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.dateOfBirth')}</label>
                                        <input
                                            type="date"
                                            className="input-field"
                                            value={formData.studentDob}
                                            onChange={e => handleChange('studentDob', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('common.gender')}</label>
                                        <select
                                            className="input-field"
                                            value={formData.studentGender}
                                            onChange={e => handleChange('studentGender', e.target.value)}
                                        >
                                            <option>{t('common.male')}</option>
                                            <option>{t('common.female')}</option>
                                        </select>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.assignedClassAcademicLevel')}</label>
                                        <select
                                            className="input-field"
                                            value={formData.classId}
                                            onChange={e => {
                                                const clss = availableClasses.find(c => c.id === e.target.value);
                                                setFormData(prev => ({ 
                                                    ...prev, 
                                                    classId: e.target.value,
                                                    grade: clss?.grade || prev.grade,
                                                    section: clss?.section || prev.section
                                                }));
                                            }}
                                        >
                                            <option value="">{t('studentEnrollmentPage.selectAClass')}</option>
                                            {availableClasses.map(cls => (
                                                <option key={cls.id} value={cls.id}>
                                                    {cls.name} {cls.section ? `(${cls.section})` : ''} 
                                                    {cls.branch_id ? ` - Branch: ${cls.branch_id.slice(0, 8)}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </section>

                            {/* 2. PARENT INFO */}
                            <section className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <h3 className="text-xs sm:text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 sm:mb-6 flex items-center gap-2 border-b border-gray-100 pb-2">
                                    <HomeIcon className="w-4 h-4" /> Guardian Details
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                    <div className="sm:col-span-2">
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.fullName')}</label>
                                        <div className="relative">
                                            <UserIcon className="absolute left-3.5 top-3 w-5 h-5 text-gray-400" />
                                            <input
                                                className="input-field pl-11"
                                                placeholder={t('studentEnrollmentPage.parentGuardianName')}
                                                value={formData.parentName}
                                                onChange={e => handleChange('parentName', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.emailAddress')}</label>
                                        <div className="relative">
                                            <MailIcon className="absolute left-3.5 top-3 w-5 h-5 text-gray-400" />
                                            <input
                                                type="email"
                                                className="input-field pl-11"
                                                placeholder="parent@example.com"
                                                value={formData.parentEmail}
                                                onChange={e => handleChange('parentEmail', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.phoneNumber')}</label>
                                        <div className="relative">
                                            <PhoneIcon className="absolute left-3.5 top-3 w-5 h-5 text-gray-400" />
                                            <input
                                                type="tel"
                                                className="input-field pl-11"
                                                placeholder="080..."
                                                value={formData.parentPhone}
                                                onChange={e => handleChange('parentPhone', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="label text-xs sm:text-sm">{t('studentEnrollmentPage.homeAddress')}</label>
                                        <textarea
                                            className="input-field resize-none h-20"
                                            placeholder={t('studentEnrollmentPage.streetAddress')}
                                            value={formData.parentAddress}
                                            onChange={e => handleChange('parentAddress', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </section>
                        </div>

                        {/* RIGHT COLUMN: CURRICULUM & DOCS */}
                        <div className="lg:col-span-4 space-y-8">

                            {/* 3. CURRICULUM */}
                            <section className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <h3 className="text-xs sm:text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 sm:mb-6 flex items-center gap-2 border-b border-gray-100 pb-2">
                                    <AcademicCapIcon className="w-4 h-4" /> Academic Track
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-1 gap-3 sm:gap-4 overflow-x-auto pb-1 hide-scrollbar">
                                    {/* Was three pickable cards: KSSR, British and Dual.
                                        The school follows KSSR and the choice was never
                                        saved, so the two extra cards only invited an admin
                                        to pick a track that would be silently ignored. The
                                        remaining card keeps the same shape and position. */}
                                    <SelectCard value="KSSR" title="KSSR" desc={t('studentEnrollmentPage.kssrDescription')} icon={BookOpenIcon} />
                                </div>
                            </section>

                            {/* 4. DOCUMENTS */}
                            <section className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <h3 className="text-xs sm:text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 sm:mb-6 flex items-center gap-2 border-b border-gray-100 pb-2">
                                    <CheckCircleIcon className="w-4 h-4" /> Documents
                                </h3>

                                <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 hover:bg-gray-50 transition-colors text-center cursor-pointer group relative">
                                    <input
                                        type="file"
                                        multiple
                                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        onChange={(e) => {
                                            if (e.target.files) setUploadedDocs(Array.from(e.target.files));
                                        }}
                                    />
                                    <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                        <UploadIcon className="w-6 h-6 text-indigo-600" />
                                    </div>
                                    <p className="text-sm font-bold text-gray-700">{t('studentEnrollmentPage.uploadRecords')}</p>
                                    <p className="text-xs text-gray-400 mt-1">{t('studentEnrollmentPage.birthCertPreviousResults')}</p>
                                </div>

                                {uploadedDocs.length > 0 && (
                                    <div className="mt-4 space-y-2">
                                        {uploadedDocs.map((file, i) => (
                                            <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">
                                                <CheckCircleIcon className="w-4 h-4 text-green-500" />
                                                <span className="truncate flex-1">{file.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-4 sm:px-8 py-4 sm:py-5 bg-white border-t border-gray-100 z-20 flex flex-col sm:flex-row justify-end gap-3 sm:gap-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={handleBack}
                    className="order-2 sm:order-1 px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition-colors text-sm sm:text-base"
                >
                    {t('common.cancel')}
                </motion.button>
                <motion.button
                    whileHover={!loading ? { scale: 1.02 } : {}} whileTap={!loading ? { scale: 0.98 } : {}}
                    onClick={handleSubmit}
                    disabled={loading}
                    className="order-1 sm:order-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                    {loading ? t('studentEnrollmentPage.registering') : t('studentEnrollmentPage.completeEnrollment')}
                    {!loading && <CheckCircleIcon className="w-5 h-5" />}
                </motion.button>
            </div>
        </div>
    );
};

export default StudentEnrollmentPage;
