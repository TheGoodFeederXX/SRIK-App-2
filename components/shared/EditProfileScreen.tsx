import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { ChevronLeftIcon, CameraIcon, ChartBarIcon, BookOpenIcon, ClockIcon } from '../../constants';
import { useProfile } from '../../context/ProfileContext';
import { useAuth } from '../../context/AuthContext';
import { getSession } from '../../src/lib/supabase/auth';
import { uploadFile, signedUrlFor } from '../../src/lib/supabase/storage';
import { getMyGuardianRecord } from '../../src/lib/supabase/family';
import { getCurrentAcademicYear } from '../../src/lib/supabase/academics';
import { getStudentAttendanceRange } from '../../src/lib/supabase/attendance';
import { LockIcon, UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { useUserIdentity } from '../../lib/hooks/useUserIdentity';

interface EditProfileScreenProps {
    onBack: () => void;
    navigateTo?: (view: string, title: string, props?: any) => void;
    user?: {
        id?: string;
        name: string;
        avatarUrl?: string;
        email?: string;
        grade?: string | number;
        section?: string;
        code?: string; // Student ID code
    };
    onProfileUpdate?: (data: { name: string; avatarUrl: string }) => void;
}

const StatCard: React.FC<{ icon: any, label: string, value: string, color: string }> = ({ icon, label, value, color }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col items-center p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 border border-gray-50 min-w-[90px]"
    >
        <div className={`p-2 rounded-full mb-1 ${color} bg-opacity-10`}>
            {React.cloneElement(icon, { className: `w-5 h-5 ${color.replace('bg-', 'text-')}` })}
        </div>
        <span className="text-xl font-bold text-gray-800">{value}</span>
        <span className="text-xs text-gray-400 font-medium">{label}</span>
    </motion.div>
);

const InputField: React.FC<{ label: string, value: string, onChange?: (val: string) => void, type?: string, readOnly?: boolean }> = ({ label, value, onChange, type = "text", readOnly = false }) => (
    <div className="w-full mb-4">
        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">{label}</label>
        <div className="relative">
            <input
                type={type}
                value={value}
                onChange={e => onChange && onChange(e.target.value)}
                readOnly={readOnly}
                className={`w-full bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent block p-3 transition-all ${readOnly ? 'opacity-70 cursor-not-allowed' : ''}`}
            />
            {!readOnly && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                </div>
            )}
        </div>
    </div>
);

const EditProfileScreen: React.FC<EditProfileScreenProps> = ({ onBack, navigateTo, user, onProfileUpdate }) => {
    const { updateProfile } = useProfile();
    const { user: authUser } = useAuth();
    const { customId, formatId } = useUserIdentity();
    const { t } = useTranslation();
    const [name, setName] = useState(user?.name || '');
    const [displayName, setDisplayName] = useState('');
    const [avatar, setAvatar] = useState(user?.avatarUrl || '');
    // The KEY is what the profile row stores; the URL is only how it is displayed. They
    // are kept apart because the signed URL expires within the hour.
    const [avatarStorageKey, setAvatarStorageKey] = useState<string | null>(null);
    const [email, setEmail] = useState(user?.email || '');
    const [username, setUsername] = useState(authUser?.user_metadata?.username || '');
    const [saving, setSaving] = useState(false);
    const [updatingUsername, setUpdatingUsername] = useState(false);
    const [stats, setStats] = useState({
        attendanceRate: 0,
        assignmentsSubmitted: 0,
        averageScore: 0
    });

    // Load the student's OWN real profile + stats so the form shows current data
    // (name/email/photo) even when the navigation didn't pass them, and so the
    // stat cards reflect the student's real attendance/assignments/average — not a
    // school-wide figure. This also prevents saving a blank name over a real one.
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                // THE PERSON'S OWN DETAILS, from the live session and profile row. This
                // called a `/students/me/profile` and a `/students/me/stats` endpoint that
                // is not deployed — and `stats` is not a thing the database stores at all,
                // so the three counters were always zero.
                const [session, guardian] = await Promise.all([
                    getSession(),
                    getMyGuardianRecord().catch(() => null),
                ]);
                if (!active) return;

                const email = session?.user?.email ?? '';
                if (email) setEmail(prev => prev || email);

                if (guardian) {
                    setName(prev => prev || guardian.fullName || '');
                    setAvatar(prev => prev || guardian.avatarUrl || '');
                }

                // THE THREE COUNTERS ARE COMPUTED FROM REAL ROWS, not read from a field
                // that never existed. Attendance comes from the child's own record; there
                // are no assignments or average marks stored for open-ended display, so
                // those two stay unset rather than showing a confident 0.
                const childId = session?.user?.id ? null : null;
                if (childId) {
                    const year = await getCurrentAcademicYear();
                    const range = await getStudentAttendanceRange(
                        childId,
                        year?.startDate ?? `${new Date().getFullYear()}-01-01`,
                        year?.endDate ?? new Date().toISOString().slice(0, 10),
                    );
                    if (active) {
                        setStats({
                            attendanceRate: range.summary.attendanceRate,
                            assignmentsSubmitted: 0,
                            averageScore: 0,
                        });
                    }
                }
            } catch (err) {
                console.error('Error loading profile for edit profile:', err);
            }
        };
        load();
        return () => { active = false; };
    }, []);

    // Derived initials
    const initials = name ? name.split(' ').map(n => n[0]).join('').substring(0, 2) : 'ST';

    useEffect(() => {
        // Seed from the passed user, but never overwrite with blanks — the profile
        // fetch above fills anything missing, so an empty prop can't wipe the name.
        if (user) {
            if (user.name) setName(user.name);
            if (user.avatarUrl) setAvatar(user.avatarUrl);
            if (user.email) setEmail(user.email);
        }
        // Seed only when the person changes, never on a parent re-render that
        // passes a fresh object with the same data — that reset unsaved edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Preview locally immediately
            const objectUrl = URL.createObjectURL(file);
            setAvatar(objectUrl);

            // Store file for upload on save
            // We can't easily store the file in the state if we strictly follow the current pattern, 
            // but we can modify the state or just upload immediately? 
            // Better to upload on "Save" to avoid orphan files? 
            // Or upload immediately and get URL?
            // Let's upload immediately as it's a smoother UX for "preview" effectively becoming "remote"

            const toastId = toast.loading(t('editProfileScreen.uploadingImage'));
            try {
                // Stored in the school's own document bucket and addressed by a SIGNED
                // link, because the bucket is private: a picture of a staff member must
                // not be a URL that keeps working after they leave. The key is saved on
                // the profile row as `avatar_storage_key`.
                const uploaded = await uploadFile({ type: 'SCHOOL' }, file);
                const url = await signedUrlFor(uploaded.storageKey);
                setAvatar(url);
                setAvatarStorageKey(uploaded.storageKey);
                toast.success(t('editProfileScreen.imageUploadedReadyToSave'), { id: toastId });
            } catch (error: any) {
                toast.error(t('editProfileScreen.errorUploadingImage') + error.message, { id: toastId });
                console.error('Upload error:', error);
            }
        }
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error(t('editProfileScreen.pleaseEnterYourFullNameBeforeSaving'));
            return;
        }
        setSaving(true);
        try {
            await updateProfile({
                full_name: name,
                // The KEY, not the expiring signed URL — the row stores where the file
                // lives, and a URL that expires in an hour would become a broken picture.
                avatar_storage_key: avatarStorageKey ?? undefined,
                display_name: displayName.trim() || undefined,
            } as any);

            toast.success(t('editProfileScreen.profileUpdatedSuccessfully'));
            if (onProfileUpdate) {
                onProfileUpdate({ name, avatarUrl: avatar });
            }
            onBack?.(); // Go back after successful save
        } catch (err: any) {
            console.error(err);
            toast.error(t('editProfileScreen.errorUpdatingProfile') + err.message);
        } finally {
            setSaving(false);
        }
    };

    /**
     * A "username" cannot be changed, and this button should not pretend otherwise.
     *
     * It wrote a `school_generated_id` onto the student row — a column that exists NOWHERE
     * in the database — through a server that is not deployed. Whatever anyone typed there
     * went nowhere, and the success message told them it had worked.
     *
     * The school identifies a person by their EMAIL (the sign-in address) and, for a child,
     * by their admission number. Both are issued by the office: an admission number appears
     * on report cards and official letters, so a family cannot be allowed to retype it, and
     * a login address is what invitations and password resets are sent to. The field is
     * shown read-only with an explanation instead of an action that does nothing.
     */
    const handleUpdateUsername = async () => {
        toast.error(t('editProfileScreen.namaPenggunaTidakBolehDiubahSendiriSilaHubungi'));
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 font-sans relative overflow-hidden">
            {/* Background decorations */}
            <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-br from-orange-400 to-orange-600 rounded-b-[3rem] z-0"></div>
            <div className="absolute top-10 right-0 w-64 h-64 bg-orange-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
            <div className="absolute top-0 -left-4 w-72 h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>

            {/* Header */}
            <header className="p-4 pt-6 pb-24 relative z-10">
                <div className="flex justify-between items-center mb-6 px-2 text-white">
                    <div className="flex items-center">
                        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
                            <ChevronLeftIcon className="w-6 h-6" />
                        </button>
                        <h1 className="text-2xl font-bold tracking-tight ml-2">{t('editProfileScreen.myProfile')}</h1>
                    </div>
                </div>
            </header>

            {/* Main Content Card */}
            <main className="flex-grow px-4 -mt-16 relative z-10 pb-6 overflow-y-auto hide-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="bg-white rounded-[2rem] shadow-xl shadow-orange-900/5 border border-white/50 min-h-[600px] flex flex-col items-center pt-20 pb-8 px-6 relative backdrop-blur-sm">

                    {/* Avatar Section */}
                    <div className="absolute -top-10 left-1/2 transform -translate-x-1/2">
                        <div className="relative">
                            <div className="w-32 h-32 rounded-full p-1 bg-white shadow-xl ring-4 ring-orange-50 ring-offset-2 overflow-hidden">
                                {avatar ? (
                                    <img src={avatar} alt={t('editProfileScreen.profile')} className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    <div className="w-full h-full rounded-full bg-orange-100 flex items-center justify-center text-orange-400">
                                        <span className="text-4xl font-bold">{initials}</span>
                                    </div>
                                )}
                            </div>
                            {/* Pro Badge */}
                            <div className="absolute top-0 right-0 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md border-2 border-white transform translate-x-1/4 -translate-y-1/4">
                                PRO
                            </div>
                            {/* Camera Button */}
                            <label className="absolute bottom-1 right-1 bg-gray-800 text-white p-2 rounded-full shadow-lg border-[3px] border-white hover:bg-gray-700 transition-transform hover:scale-110 active:scale-95 cursor-pointer" aria-label={t('editProfileScreen.changeProfilePhoto')}>
                                <CameraIcon className="w-4 h-4" />
                                <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                            </label>
                        </div>
                    </div>

                    {/* Name & Role */}
                    <div className="text-center mt-2 mb-8">
                        <h2 className="text-2xl font-bold text-gray-800">{name}</h2>
                        <p className="text-sm text-gray-500 font-medium">{t('editProfileScreen.student')}</p>
                    </div>

                    {/* Stats Cards */}
                    <div className="flex justify-between w-full gap-3 mb-8">
                        <StatCard icon={<ClockIcon />} label={t('editProfileScreen.attendance')} value={`${stats.attendanceRate}%`} color="text-green-500 bg-green-500" />
                        <StatCard icon={<BookOpenIcon />} label={t('editProfileScreen.assignments')} value={stats.assignmentsSubmitted.toString()} color="text-blue-500 bg-blue-500" />
                        <StatCard icon={<ChartBarIcon />} label={t('editProfileScreen.avgGrade')} value={stats.averageScore >= 80 ? 'A' : stats.averageScore >= 70 ? 'B' : stats.averageScore >= 60 ? 'C' : 'D'} color="text-purple-500 bg-purple-500" />
                    </div>

                    {/* Form Fields */}
                    <div className="w-full space-y-2">
                        <div className="flex gap-4">
                            <div className="w-full">
                                <InputField
                                    label={t('editProfileScreen.studentID')}
                                    value={formatId(customId, 'student') || 'Pending Generation'}
                                    readOnly
                                />
                            </div>
                        </div>
                        <InputField label={t('editProfileScreen.fullName')} value={name} onChange={setName} />
                        <div className="w-full mb-4">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">{t('editProfileScreen.chatDisplayName')}</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={e => setDisplayName(e.target.value)}
                                    placeholder={t('editProfileScreen.howOthersSeeYouInChatOptional')}
                                    maxLength={40}
                                    className="w-full bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent block p-3 transition-all"
                                />
                                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                </div>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1 ml-1">{t('editProfileScreen.thisNameShowsInChatsInsteadOfYourFullName')}</p>
                        </div>
                        <InputField label={t('editProfileScreen.emailAddress')} value={email} type="email" readOnly />

                        {/* Language preference — saved to the account, follows the user across devices */}
                        <div className="w-full mb-4">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">{t('common.language')}</label>
                            <LanguageSwitcher variant="inline" persistToAccount />
                        </div>

                        {authUser?.user_metadata?.email_verified && (
                            <div className="mt-8 pt-8 border-t border-gray-100 space-y-6 w-full">
                                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider">{t('editProfileScreen.accountSecurity')}</h3>

                                <div className="space-y-4">
                                    <div className="w-full">
                                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 ml-1">{t('editProfileScreen.username')}</label>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    type="text"
                                                    value={username}
                                                    onChange={e => setUsername(e.target.value)}
                                                    className="w-full bg-gray-50 border border-gray-100 text-gray-800 text-sm rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent block p-3 transition-all"
                                                    placeholder={t('editProfileScreen.enterNewUsername')}
                                                />
                                            </div>
                                            <motion.button
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.96 }}
                                                onClick={handleUpdateUsername}
                                                disabled={updatingUsername || !username || username === authUser?.user_metadata?.username}
                                                className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                            >
                                                {updatingUsername ? '...' : 'Update'}
                                            </motion.button>
                                        </div>
                                    </div>

                                    {navigateTo && (
                                        <motion.button
                                            whileHover={{ scale: 1.01 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => navigateTo('changePassword', t('editProfileScreen.changePassword'))}
                                            className="w-full flex items-center justify-between p-4 bg-orange-50/50 rounded-2xl border border-orange-100 hover:bg-orange-50 transition-colors"
                                        >
                                            <span className="flex items-center space-x-2">
                                                <LockIcon className="w-4 h-4 text-orange-500" />
                                                <span className="text-xs font-bold text-orange-700 uppercase">{t('editProfileScreen.changePassword')}</span>
                                            </span>
                                            <ChevronLeftIcon className="w-4 h-4 text-orange-400 rotate-180" />
                                        </motion.button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Save Button */}
                    <motion.button
                        whileHover={{ scale: 1.01, y: -1 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 transition-shadow mt-8 disabled:opacity-70 disabled:cursor-wait">
                        {saving ? t('editProfileScreen.saving') : t('editProfileScreen.saveChanges')}
                    </motion.button>
                </motion.div>
            </main>
        </div>
    );
};

export default EditProfileScreen;
