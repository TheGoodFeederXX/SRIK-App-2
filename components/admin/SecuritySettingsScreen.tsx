import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheckIcon, ClockIcon as HistoryIcon, LockIcon, LoginIcon } from '../../constants';
import { useAuth } from '../../context/AuthContext';
import { listAuditLog } from '../../src/lib/supabase/auditTrail';
import { updateSchoolSettings } from '../../src/lib/supabase/schoolProfile';
import { toast } from 'react-hot-toast';

const SecuritySettingsScreen: React.FC = () => {
    const { t } = useTranslation();
    const { currentSchool, currentBranchId } = useAuth();
    const [passwordPolicy, setPasswordPolicy] = useState({
        minLength: 8,
        requireUppercase: true, 
        requireNumber: true, 
        requireSpecial: false, 
    });
    const [loginHistory, setLoginHistory] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (currentSchool?.settings?.security?.passwordPolicy) {
            setPasswordPolicy(prevPolicy => ({
                ...prevPolicy,
                ...currentSchool.settings.security.passwordPolicy
            }));
        }

        const fetchLoginHistory = async () => {
            if (!currentSchool?.id) return;
            try {
                // Use the real audit-logs endpoint (school + branch scoped on the
                // backend). The old chained query builder isn't supported here.
                // The school's own audit trail. This is the record of who changed
                // security settings, so a screen that could not read it was showing
                // an empty list where the evidence should be.
                const entries = await listAuditLog({ limit: 20 });
                const logs = entries.map(e => ({
                    id: String(e.id),
                    action: e.action,
                    user_email: e.actor_email ?? '',
                    created_at: e.created_at,
                }));
                const loginLogs = (logs || []).filter((log: any) =>
                    /login|token/i.test(log.action || log.type || '')
                ).slice(0, 5);

                setLoginHistory(loginLogs.map((log: any) => ({
                    id: log.id,
                    user: log.user_name || log.user?.full_name || 'System',
                    action: 'Logged In',
                    time: new Date(log.created_at).toLocaleString('ms-MY'),
                    device: log.metadata?.device || 'Unknown Device',
                    location: log.metadata?.location || 'Unknown Location',
                    isCurrent: false
                })));
            } catch (error: any) {
                console.error("Error fetching login history:", error);
            }
        };

        fetchLoginHistory();
    }, [currentSchool, currentBranchId]);

    const handleSavePolicy = async () => {
        if (!currentSchool?.id) {
            toast.error(t('securitySettingsScreen.noSchoolSelectedToSavePolicy'));
            return;
        }
        setIsLoading(true);
        try {
            // Persist via the real schools endpoint instead of the unsupported
            // Chained .from().update().eq() builder (which threw
            // "api.from(...).update(...).eq is not a function").
            // Merged in the database. The old code wrote back the whole settings
            // object it had read, so a save here reverted any setting another screen
            // had changed since — silently, with no error.
            await updateSchoolSettings({
                security: { ...((currentSchool.settings as any)?.security || {}), passwordPolicy },
            });
            toast.success(t('securitySettingsScreen.securitySettingsSaved'));
        } catch (error: any) {
            toast.error(`${t('common.error')}: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-4 space-y-5 bg-gray-50">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="bg-white p-4 rounded-xl shadow-sm">
                <h3 className="font-bold text-gray-800 mb-3">{t('securitySettingsScreen.passwordPolicy')}</h3>
                <div className="space-y-3 text-sm text-gray-700">
                    <div className="flex justify-between items-center">
                        <label>Minimum Length: {passwordPolicy.minLength}</label>
                        <input type="range" min="6" max="16" value={passwordPolicy.minLength} onChange={e => setPasswordPolicy(p => ({ ...p, minLength: parseInt(e.target.value) }))} className="w-24" />
                    </div>
                    <div className="flex justify-between items-center">
                        <label>{t('securitySettingsScreen.requireUppercaseLetter')}</label>
                        <input type="checkbox" checked={passwordPolicy.requireUppercase} onChange={e => setPasswordPolicy(p => ({ ...p, requireUppercase: e.target.checked }))} className="h-4 w-4 rounded text-indigo-600" />
                    </div>
                    <div className="flex justify-between items-center">
                        <label>{t('securitySettingsScreen.requireNumber')}</label>
                        <input type="checkbox" checked={passwordPolicy.requireNumber} onChange={e => setPasswordPolicy(p => ({ ...p, requireNumber: e.target.checked }))} className="h-4 w-4 rounded text-indigo-600" />
                    </div>
                    <div className="flex justify-between items-center">
                        <label className="text-gray-700 text-sm">{t('securitySettingsScreen.forceSpecialCharacters')}</label>
                        <input type="checkbox" checked={passwordPolicy.requireSpecial} onChange={e => setPasswordPolicy({ ...passwordPolicy, requireSpecial: e.target.checked })} />
                    </div>
                </div>
                <motion.button
                    whileHover={!isLoading ? { scale: 1.01 } : {}}
                    whileTap={!isLoading ? { scale: 0.98 } : {}}
                    onClick={handleSavePolicy}
                    disabled={isLoading}
                    className="mt-4 w-full bg-indigo-600 text-white font-bold py-2 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
                >
                    {isLoading ? t('securitySettingsScreen.saving') : t('securitySettingsScreen.savePolicy')}
                </motion.button>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }} className="bg-white p-4 rounded-xl shadow-sm">
                <h3 className="font-bold text-gray-800 mb-3">{t('securitySettingsScreen.recentSystemLogins')}</h3>
                <ul className="space-y-3">
                    {loginHistory.map((item, index) => (
                        <motion.li key={index} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: index * 0.03 }} className="flex items-center space-x-4">
                            <LoginIcon className="text-gray-400 h-6 w-6" />
                            <div className="flex-grow">
                                <p className="font-semibold text-gray-700">{item.device}</p>
                                <p className="text-sm text-gray-500">{item.location} - {item.time}</p>
                            </div>
                            {item.isCurrent && <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">{t('securitySettingsScreen.activeNow')}</span>}
                        </motion.li>
                    ))}
                </ul>
            </motion.div>
        </div>
    );
};
export default SecuritySettingsScreen;
