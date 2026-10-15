import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { Globe, CheckCircle2, Search } from 'lucide-react';
import { getSchoolProfile, updateSchoolSettings } from '../../src/lib/supabase/schoolProfile';
import { listStudents } from '../../src/lib/supabase/students';
import { useAuth } from '../../context/AuthContext';
import CenteredLoader from '../ui/CenteredLoader';

// One hub for the three separate places curriculum is set across the app:
// 1. School.curricula_config   — which curricula the school is accredited to offer at all
// 3. Student.curriculum_type   — the actual track each individual student is enrolled in
// (Teachers' "Mark by Curriculum Track" attendance screen filters students by #3.)

// THE SCHOOL'S CURRICULUM IS KSSR. NOT A LIST OF ONE.
//
// `SCHOOL_CURRICULA` used to offer 'KSSR' and 'BRITISH'. `BRANCH_FOCUS_OPTIONS` —
// which was never read anywhere, so it offered nothing while still claiming the
// school could be 'american' — listed four. `STUDENT_TRACK_OPTIONS` let an admin
// mark an individual child as following the British curriculum or a dual stream.
// The school is accredited for KSSR, follows the Malaysian primary syllabus, and
// has no dual stream, so each of those was a way to record a curriculum that is
// not taught. They are gone rather than hidden.
const SCHOOL_CURRICULUM = 'KSSR';

interface CurriculumManagementScreenProps {
    navigateTo?: (view: string, title: string, props?: any) => void;
}

const CurriculumManagementScreen: React.FC<CurriculumManagementScreenProps> = () => {
    const { t } = useTranslation();
    const { currentSchool, currentBranchId } = useAuth();

    const [schoolCurricula, setSchoolCurricula] = useState<string[]>([]);
    const [savingSchool, setSavingSchool] = useState(false);


    const [students, setStudents] = useState<any[]>([]);
    const [studentsLoading, setStudentsLoading] = useState(true);
    const [studentSearch, setStudentSearch] = useState('');

    const [loading, setLoading] = useState(true);

    const fetchSchool = useCallback(async () => {
        if (!currentSchool?.id) return;
        try {
            // Read from the school's own settings. There is no school id to pass.
            const profile = await getSchoolProfile();
            const stored = (profile.settings as any)?.curricula_config;
            setSchoolCurricula(Array.isArray(stored) ? stored : ['KSSR']);
        } catch {
            setSchoolCurricula(['KSSR']);
        }
    }, [currentSchool]);

    const fetchStudents = useCallback(async () => {
        if (!currentSchool?.id) return;
        setStudentsLoading(true);
        try {
            // No school or branch argument: one school, and the roster is what the
            // database returns.
            const data = await listStudents();
            setStudents(data.map(s => ({ id: s.id, name: s.fullName, admissionNo: s.admissionNo })) as any);
        } catch (err) {
            console.error('Error loading students for curriculum management:', err);
            toast.error(t('curriculumManagementScreen.failedToLoadStudents'));
        } finally {
            setStudentsLoading(false);
        }
    }, [currentSchool?.id, currentBranchId]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await Promise.all([fetchSchool(), fetchStudents()]);
            setLoading(false);
        })();
    }, [fetchSchool, fetchStudents]);

    const toggleSchoolCurriculum = (code: string) => {
        setSchoolCurricula(prev =>
            prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
        );
    };

    const saveSchoolCurricula = async () => {
        if (!currentSchool?.id) return;
        setSavingSchool(true);
        try {
            // Merged in the database, so it cannot revert a setting changed on
            // another screen while this one was open.
            await updateSchoolSettings({ curricula_config: schoolCurricula });
            toast.success(t('curriculumManagementScreen.schoolCurriculaUpdated'));
        } catch (err) {
            console.error('Error saving school curricula:', err);
            toast.error(t('curriculumManagementScreen.failedToSaveSchoolCurricula'));
        } finally {
            setSavingSchool(false);
        }
    };

    // `changeStudentTrack` stood here. It wrote a per-student curriculum the school does
    // not store: the change appeared to save, reverted on the next load, and the teacher
    // was told nothing. With the track selector gone there is no per-student curriculum
    // to change, so the handler went with it rather than being left to rot unwired.

    const filteredStudents = students.filter(s =>
        (s.full_name || s.name || '').toLowerCase().includes(studentSearch.toLowerCase()) ||
        (s.admission_number || '').toLowerCase().includes(studentSearch.toLowerCase())
    );

    if (loading) return <CenteredLoader message={t('curriculumManagementScreen.loadingCurriculumSettings')} className="py-12" />;

    return (
        <div className="p-4 space-y-6 bg-gray-100 min-h-full">
            {/* 1. School-wide curricula */}
            <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-bold text-lg text-gray-800">{t('curriculumManagementScreen.schoolCurricula')}</h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">{t('curriculumManagementScreen.whichCurriculaThisSchoolIsAccreditedToOfferOve')}</p>
                {/* Was a grid of toggle buttons for KSSR / British. The school has one
                    curriculum, so the toggle let an admin switch off the only syllabus
                    the school teaches. The value stays where the controls were, in the
                    same card, so the layout does not move. */}
                <div className="flex items-center justify-between p-4 rounded-xl border-2 border-indigo-500 bg-indigo-50">
                    <span className="font-semibold text-gray-800">{SCHOOL_CURRICULUM}</span>
                    <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="mt-4 flex justify-end">
                    <motion.button
                        whileTap={{ scale: 0.97 }}
                        disabled={savingSchool}
                        onClick={saveSchoolCurricula}
                        className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50"
                    >
                        {savingSchool ? t('curriculumManagementScreen.saving') : t('curriculumManagementScreen.saveSchoolCurricula')}
                    </motion.button>
                </div>
            </div>

            {/* 3. Per-student curriculum track */}
            <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-bold text-lg text-gray-800 mb-1">{t('curriculumManagementScreen.studentCurriculumTracks')}</h2>
                <p className="text-sm text-gray-500 mb-4">
                    {t('curriculumManagementScreen.whichCurriculumEachStudentIsEnrolledInThisIsWhatTeachersAndParentsSee')}
                </p>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder={t('curriculumManagementScreen.searchStudentsByNameOrAdmissionNumber')}
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                </div>
                {studentsLoading ? (
                    <CenteredLoader message={t('curriculumManagementScreen.loadingStudents')} className="py-8" />
                ) : (
                    <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                        {filteredStudents.map(s => (
                            <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-gray-800 truncate">{s.full_name || s.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {s.grade ? `Grade ${s.grade}${s.section ? ` ${s.section}` : ''}` : s.admission_number}
                                    </p>
                                </div>
                                {/* Was a dropdown offering KSSR / British / Both per
                                    child. The school follows KSSR, so the only honest
                                    thing this row can say is KSSR; the three-way
                                    choice existed to record a track the school does
                                    not store (see `changeStudentTrack`, which has to
                                    undo the change and explain why). */}
                                <span className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 text-gray-700 flex-shrink-0">
                                    {t('curriculumManagementScreen.kssr')}
                                </span>
                            </div>
                        ))}
                        {filteredStudents.length === 0 && (
                            <p className="text-sm text-gray-500 text-center py-8">{t('curriculumManagementScreen.noStudentsFound')}</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CurriculumManagementScreen;
