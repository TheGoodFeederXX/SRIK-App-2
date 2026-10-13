
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { LockIcon } from '../../constants';
import { changePassword, describePasswordProblem } from '../../src/lib/supabase/auth';
import { toast } from 'react-hot-toast';

const PasswordInput = ({ id, label, value, onChange }: { id: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
    <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
        <div className="relative mt-1">
            <LockIcon className="absolute inset-y-0 left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input type="password" id={id} value={value} onChange={onChange} required className="w-full pl-10 pr-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-sky-500 focus:border-sky-500" />
        </div>
    </div>
);

const ChangePasswordScreen: React.FC = () => {
    const { t } = useTranslation();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            toast.error(t('changePasswordScreen.newPasswordsDoNotMatch'));
            return;
        }

        // AUDIT F39 — this used to hard-code eight characters while the server requires ten
        // plus three character classes. A nine-character password was refused HERE, by the
        // school's own screen, before the server ever saw it. The rule is asked for, not
        // repeated, so the screen and the server cannot disagree.
        const passwordProblem = describePasswordProblem(newPassword);
        if (passwordProblem) {
            toast.error(passwordProblem);
            return;
        }

        setLoading(true);
        try {
            // The current password is re-checked inside `changePassword`. Supabase
            // would let whoever holds the session set a new password, which in a
            // staffroom means someone at an unlocked laptop could lock the real
            // owner out. Asking for the current one means the person typing must
            // already know it.
            const result = await changePassword(currentPassword, newPassword);
            if (!result.success) {
                throw new Error(result.error || 'Could not change the password.');
            }
            toast.success(t('changePasswordScreen.passwordChangedSuccessfully'));
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            console.error('Error changing password:', err);
            toast.error(err.message || 'Failed to change password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                <main className="flex-grow p-4 overflow-y-auto">
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="bg-white p-4 rounded-xl shadow-sm space-y-4">
                        <PasswordInput id="currentPassword" label={t('changePasswordScreen.currentPassword')} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                        <PasswordInput id="newPassword" label={t('changePasswordScreen.newPassword')} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                        <PasswordInput id="confirmPassword" label={t('changePasswordScreen.confirmNewPassword')} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                    </motion.div>
                </main>
                <div className="p-4 mt-auto bg-gray-50 border-t border-gray-200">
                    <motion.button whileHover={!loading ? { scale: 1.01 } : {}} whileTap={!loading ? { scale: 0.98 } : {}} type="submit" disabled={loading} className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-sky-500 hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        {loading ? 'Updating...' : 'Update Password'}
                    </motion.button>
                </div>
            </form>
        </div>
    );
};
export default ChangePasswordScreen;
