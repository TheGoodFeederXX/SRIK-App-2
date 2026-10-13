import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { getMyPreferences, saveMyPreferences } from '../../src/lib/supabase/preferences';
import { toast } from 'react-hot-toast';
import {
    Bell,
    Clock,
    Mail,
    MessageSquare,
    Smartphone,
    Volume2,
    VolumeX,
    AlertTriangle,
    BookOpen,
    CreditCard,
    Calendar,
    Users,
    Save,
    CheckCircle2,
    Info,
    Loader2
} from 'lucide-react';
import CenteredLoader from '../ui/CenteredLoader';

interface NotificationCategory {
    id: string;
    label: string;
    icon: React.ReactNode;
    description: string;
    mode: 'instant' | 'digest' | 'off';
    channel: 'push' | 'sms' | 'whatsapp' | 'email';
}

const NotificationDigestSettings = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [digestTime, setDigestTime] = useState('19:00');
    // Which channels this deployment can actually send on. The API reports it;
    // anything false is shown disabled rather than offered as if it worked.
    const [available, setAvailable] = useState<Record<string, boolean>>({ inapp: true });
    const [isSaving, setIsSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    const [categories, setCategories] = useState<NotificationCategory[]>([
        { id: 'homework', label: t('notificationDigestSettings.homeworkAssignments'), icon: <BookOpen className="w-5 h-5" />, description: t('notificationDigestSettings.newAssignmentsSubmissionRemindersGrades'), mode: 'digest', channel: 'push' },
        { id: 'fees', label: t('notificationDigestSettings.feeReminders'), icon: <CreditCard className="w-5 h-5" />, description: t('notificationDigestSettings.paymentDueDatesReceiptsBalanceUpdates'), mode: 'instant', channel: 'whatsapp' },
        { id: 'attendance', label: t('notificationDigestSettings.attendance'), icon: <CheckCircle2 className="w-5 h-5" />, description: t('notificationDigestSettings.dailyAttendanceStatusLateArrivalAlerts'), mode: 'instant', channel: 'push' },
        { id: 'emergency', label: t('notificationDigestSettings.emergencyAlerts'), icon: <AlertTriangle className="w-5 h-5" />, description: t('notificationDigestSettings.schoolEmergenciesSafetyAlertsClosures'), mode: 'instant', channel: 'sms' },
        { id: 'events', label: t('notificationDigestSettings.eventsCalendar'), icon: <Calendar className="w-5 h-5" />, description: t('notificationDigestSettings.schoolEventsPTAMeetingsHolidays'), mode: 'digest', channel: 'push' },
        { id: 'behavior', label: t('notificationDigestSettings.behaviorReports'), icon: <Users className="w-5 h-5" />, description: t('notificationDigestSettings.behaviorLogsMeritsDemerits'), mode: 'instant', channel: 'push' },
        { id: 'general', label: t('notificationDigestSettings.generalAnnouncements'), icon: <Bell className="w-5 h-5" />, description: t('notificationDigestSettings.schoolWideAnnouncementsAndUpdates'), mode: 'digest', channel: 'push' },
    ]);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            // The caller's own preferences.
            const settings = await getMyPreferences() as any;
            if (settings) {
                if (settings.channels) setAvailable(settings.channels);
                setDigestTime(settings.digest_time || '19:00');
                if (settings.categories) {
                    setCategories(prev => prev.map(c => {
                        const loaded = (settings.categories as any[]).find(l => l.id === c.id);
                        return loaded ? { ...c, mode: loaded.mode, channel: loaded.channel } : c;
                    }));
                }
            }
        } catch (err) {
            console.error('Fetch settings error:', err);
            // toast.error('Failed to load preferences');
        } finally {
            setLoading(false);
        }
    };

    const updateCategory = (id: string, field: 'mode' | 'channel', value: string) => {
        if (id === 'emergency' && field === 'mode' && value !== 'instant') {
            toast.error(t('notificationDigestSettings.emergencyAlertsMustAlwaysBeInstant'));
            return;
        }
        if (field === 'channel' && available[value] === false) {
            toast.error(`${value === 'sms' ? 'SMS' : value === 'whatsapp' ? 'WhatsApp' : 'Push'} is not set up for this school yet.`);
            return;
        }
        setCategories(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Only these two keys, merged in the database, so saving the digest
            // cannot revert a preference changed on another screen meanwhile.
            await saveMyPreferences({
                digest_time: digestTime,
                categories: categories.map(c => ({ id: c.id, mode: c.mode, channel: c.channel })),
            });
            toast.success(t('notificationDigestSettings.notificationPreferencesSaved'));
        } catch (err) {
            toast.error(t('notificationDigestSettings.failedToSavePreferences'));
        } finally {
            setIsSaving(false);
        }
    };

    const modes = [
        { value: 'instant', label: t('notificationDigestSettings.instant'), icon: <Volume2 className="w-4 h-4" />, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        { value: 'digest', label: 'Digest', icon: <Clock className="w-4 h-4" />, color: 'bg-amber-100 text-amber-700 border-amber-200' },
        { value: 'off', label: 'Off', icon: <VolumeX className="w-4 h-4" />, color: 'bg-gray-100 text-gray-500 border-gray-200' },
    ];

    const channels = [
        { value: 'inapp', label: 'In-app', icon: <Bell className="w-4 h-4" /> },
        { value: 'email', label: 'Email', icon: <Mail className="w-4 h-4" /> },
        { value: 'push', label: 'Push', icon: <Smartphone className="w-4 h-4" /> },
        { value: 'sms', label: 'SMS', icon: <MessageSquare className="w-4 h-4" /> },
        { value: 'whatsapp', label: t('notificationDigestSettings.whatsapp'), icon: <MessageSquare className="w-4 h-4" /> },
    ];

    if (loading) {
        return <CenteredLoader message={t('notificationDigestSettings.loadingYourPreferences')} className="min-h-[400px]" />;
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-8">
            <header>
                <h1 className="text-3xl font-bold text-gray-900 font-outfit">{t('notificationDigestSettings.notificationPreferences')}</h1>
                <p className="text-gray-500 text-sm mt-1">{t('notificationDigestSettings.controlHowAndWhenYouReceiveNotifications')}</p>
            </header>

            {/* Digest Time */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600"><Clock className="w-6 h-6" /></div>
                        <div>
                            <h3 className="font-bold text-gray-800">{t('notificationDigestSettings.dailyDigestTime')}</h3>
                            <p className="text-xs text-gray-500">{t('notificationDigestSettings.whenDigestModeNotificationsAreBatchedAndSent')}</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        <input type="time" value={digestTime} onChange={e => setDigestTime(e.target.value)}
                            className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                </div>
            </div>

            {/* Emergency Warning */}
            <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-3 flex items-center space-x-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <p className="text-sm text-red-700 min-w-0"><strong>{t('notificationDigestSettings.emergencyAlerts')}</strong> always arrive instantly via all channels and cannot be muted or delayed.</p>
            </div>

            {/* Categories */}
            <div className="space-y-4">
                {categories.map((cat, ci) => (
                    <motion.div key={cat.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(ci, 15) * 0.03 }} className={`bg-white p-4 sm:p-5 rounded-2xl shadow-sm border transition-all ${cat.id === 'emergency' ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                        <div className="flex items-start gap-3 sm:gap-4">
                            <div className="p-2 rounded-xl bg-gray-50 text-gray-600 mt-1 flex-shrink-0">{cat.icon}</div>
                            <div className="flex-grow min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <h3 className="font-bold text-gray-800">{cat.label}</h3>
                                    {cat.id === 'emergency' && <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{t('notificationDigestSettings.alwaysInstant')}</span>}
                                </div>
                                <p className="text-xs text-gray-500 mb-3">{cat.description}</p>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                                    {/* Mode Selector */}
                                    <div className="flex flex-wrap p-0.5 bg-gray-100 rounded-lg gap-0.5">
                                        {modes.map(m => (
                                            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} key={m.value} onClick={() => updateCategory(cat.id, 'mode', m.value)}
                                                className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${cat.mode === m.value ? `${m.color} border` : 'text-gray-400'}`}>
                                                {m.icon}<span>{m.label}</span>
                                            </motion.button>
                                        ))}
                                    </div>
                                    {/* Channel Selector */}
                                    {cat.mode !== 'off' && (
                                        <div className="flex flex-wrap p-0.5 bg-gray-100 rounded-lg gap-0.5">
                                            {channels.map(ch => (
                                                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} key={ch.value} onClick={() => updateCategory(cat.id, 'channel', ch.value)}
                                                    title={available[ch.value] === false ? `${ch.label} is not set up for this school yet` : undefined}
                                                    className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                                                        cat.channel === ch.value
                                                            ? 'bg-white shadow-sm text-indigo-600 border border-indigo-200'
                                                            : available[ch.value] === false
                                                                ? 'text-gray-300 cursor-not-allowed'
                                                                : 'text-gray-400'}`}>
                                                    {ch.icon}<span>{ch.label}</span>
                                                </motion.button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Save */}
            <motion.button whileHover={!isSaving ? { scale: 1.01 } : {}} whileTap={!isSaving ? { scale: 0.98 } : {}} onClick={handleSave} disabled={isSaving}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center space-x-2 disabled:opacity-60">
                {isSaving ? <Clock className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                <span>{isSaving ? t('notificationDigestSettings.saving') : t('notificationDigestSettings.savePreferences')}</span>
            </motion.button>
        </div>
    );
};

export default NotificationDigestSettings;
