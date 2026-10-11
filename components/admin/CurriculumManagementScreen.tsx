import React, { useState, useEffect, useCallback } from 'react';
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

// These are the school's own codes and labels. They used to be the Nigerian
// curriculum codes (NIGERIAN / "Nigerian (NERDC)") — NERDC is Nigeria's
// curriculum body, and SRIK is accredited for KSSR, so the school was listed
// as offering a curriculum it does not teach.
const SCHOOL_CURRICULA = [
    { code: 'KSSR', label: 'KSSR' },
    { code: 'BRITISH', label: 'British (UK NC)' },
];

const BRANCH_FOCUS_OPTIONS = [
    { value: 'kssr', label: 'KSSR' },
    { value: 'british', label: 'British (UK NC)' },
    { value: 'american', label: 'American (Common Core)' },
    { value: 'dual', label: 'Dual Curriculum' },
];

const STUDENT_TRACK_OPTIONS = ['KSSR', 'British', 'Both'];

interface CurriculumManagementScreenProps {
    navigateTo?: (view: string, title: string, props?: any) => void;
}

const CurriculumManagementScreen: React.FC<CurriculumManagementScreenProps> = () => {
    const { currentSchool, currentBranchId } = useAuth();

    const [schoolCurricula, setSchoolCurricula] = useState<string[]>([]);
    const [savingSchool, setSavingSchool] = useState(false);


    const [students, setStudents] = useState<any[]>([]);
    const [studentsLoading, setStudentsLoading] = useState(true);
    const [studentSearch, setStudentSearch] = useState('');
    const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

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
            toast.error('Failed to load students.');
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
            toast.success('School curricula updated.');
        } catch (err) {
            console.error('Error saving school curricula:', err);
            toast.error('Failed to save school curricula.');
        } finally {
            setSavingSchool(false);
        }
    };

    const changeStudentTrack = async (studentId: string, track: string) => {
        setSavingStudentId(studentId);
        const prev = students;
        setStudents(cur => cur.map(s => s.id === studentId ? { ...s, curriculum_type: track } : s));
        try {
            // SRIK has no per-student curriculum field, and this used to call
            // `api.updateStudent` on a server that is not deployed — so the change
            // looked saved, reverted on the next load, and nothing said why.
            // Putting the row back is the honest behaviour: the screen must not
            // show a value the school does not store.
            setStudents(prev);
            toast.error('Per-student curriculum is not recorded for this school yet.');
        } finally {
            setSavingStudentId(null);
        }
    };

    const filteredStudents = students.filter(s =>
        (s.full_name || s.name || '').toLowerCase().includes(studentSearch.toLowerCase()) ||
        (s.admission_number || '').toLowerCase().includes(studentSearch.toLowerCase())
    );

    if (loading) return <CenteredLoader message="Loading curriculum settings..." className="py-12" />;

    return (
        <div className="p-4 space-y-6 bg-gray-100 min-h-full">
            {/* 1. School-wide curricula */}
            <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-bold text-lg text-gray-800">School Curricula</h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">Which curricula this school is accredited to offer overall.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SCHOOL_CURRICULA.map(c => (
                        <button
                            key={c.code}
                            onClick={() => toggleSchoolCurriculum(c.code)}
                            className={`flex items-center justify-between p-4 rounded-xl border-2 text-left transition-colors ${schoolCurricula.includes(c.code) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                            <span className="font-semibold text-gray-800">{c.label}</span>
                            {schoolCurricula.includes(c.code) && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
                        </button>
                    ))}
                </div>
                <div className="mt-4 flex justify-end">
                    <motion.button
                        whileTap={{ scale: 0.97 }}
                        disabled={savingSchool}
                        onClick={saveSchoolCurricula}
                        className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50"
                    >
                        {savingSchool ? 'Saving...' : 'Save School Curricula'}
                    </motion.button>
                </div>
            </div>

            {/* 3. Per-student curriculum track */}
            <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-bold text-lg text-gray-800 mb-1">Student Curriculum Tracks</h2>
                <p className="text-sm text-gray-500 mb-4">
                    Which curriculum each student is enrolled in — this is what teachers and parents see.
                </p>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Search students by name or admission number..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                </div>
                {studentsLoading ? (
                    <CenteredLoader message="Loading students..." className="py-8" />
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
                                <select
                                    value={s.curriculum_type || 'KSSR'}
                                    disabled={savingStudentId === s.id}
                                    onChange={(e) => changeStudentTrack(s.id, e.target.value)}
                                    className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white flex-shrink-0 disabled:opacity-50"
                                >
                                    {STUDENT_TRACK_OPTIONS.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                        {filteredStudents.length === 0 && (
                            <p className="text-sm text-gray-500 text-center py-8">No students found.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CurriculumManagementScreen;
