
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { LockIcon, EyeIcon, EyeOffIcon } from '../../constants';
import { changePassword, describePasswordProblem } from '../../src/lib/supabase/auth';

const PasswordInput = ({ id, label, value, onChange }: { id: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
            <div className="relative mt-1">
                <LockIcon className="absolute inset-y-0 left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                    type={showPassword ? "text" : "password"}
                    id={id}
                    value={value}
                    onChange={onChange}
                    required
                    className="w-full pl-10 pr-14 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500"
                />
                <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-2 flex items-center justify-center w-11 text-gray-400 hover:text-gray-600 cursor-pointer focus:outline-none"
                >
                    {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
            </div>
        </div>
    );
};

const ParentChangePasswordScreen: React.FC = () => {
    const { t } = useTranslation();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error(t('parentChangePasswordScreen.newPasswordsDoNotMatch'));
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
        const loadingToast = toast.loading("Updating password...");
        try {
            // See ChangePasswordScreen: the current password is re-checked, so an
            // unlocked laptop cannot be used to take the account away.
            const result = await changePassword(currentPassword, newPassword);
            if (!result.success) {
                throw new Error(result.error || 'Could not change the password.');
            }

            toast.success(t('parentChangePasswordScreen.passwordUpdatedSuccessfully'), { id: loadingToast });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            console.error("Error updating password:", err);
            toast.error(err.message || "Failed to update password", { id: loadingToast });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                <main className="flex-grow p-4 overflow-y-auto">
                    <div className="bg-white p-4 rounded-xl shadow-sm space-y-4">
                        <PasswordInput id="currentPassword" label={t('parentChangePasswordScreen.currentPassword')} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                        <PasswordInput id="newPassword" label={t('parentChangePasswordScreen.newPassword')} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                        <PasswordInput id="confirmPassword" label={t('parentChangePasswordScreen.confirmNewPassword')} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                    </div>
                </main>
                <div className="p-4 mt-auto bg-gray-50 border-t border-gray-200">
                    <motion.button
                        whileHover={{ scale: loading ? 1 : 1.01 }}
                        whileTap={{ scale: loading ? 1 : 0.97 }}
                        type="submit"
                        disabled={loading}
                        className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-green-600 hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${loading ? 'opacity-50' : ''}`}
                    >
                        {loading ? 'Updating...' : 'Update Password'}
                    </motion.button>
                </div>
            </form>
        </div>
    );
};
export default ParentChangePasswordScreen;
