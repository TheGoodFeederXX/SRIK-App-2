import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { SchoolLogoIcon } from '../shared/SchoolLogoIcon';
import LanguageSwitcher from '../shared/LanguageSwitcher';
import { updatePassword, clearTemporaryPasswordFlag, signOut } from '../../src/lib/supabase/auth';

/**
 * Forced password change for an account created with a temporary password.
 *
 * Why this screen must exist: when an administrator creates an account they
 * choose the first password, so it is known to someone other than its owner.
 * Without forcing a change, that shared password would work forever.
 *
 * The ordering here is deliberate and security-relevant. The password is
 * changed FIRST, and the flag is cleared only after Supabase confirms the
 * change. Clearing the flag first would mark the account as safe while the
 * administrator's temporary password still worked.
 */
const ChangePasswordScreen: React.FC = () => {
    const { t } = useTranslation();
    const { user, refreshUser, signOut: appSignOut } = useAuth();

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!password || !confirm) {
            setError('Please fill in both fields.');
            return;
        }
        if (password !== confirm) {
            setError('The two passwords do not match.');
            return;
        }
        // Mirrors the project's minimum_password_length so the user is told
        // before a round trip, rather than after a confusing rejection.
        if (password.length < 12) {
            setError('Password must be at least 12 characters.');
            return;
        }

        setIsSaving(true);
        try {
            // 1. Change the credential itself — Supabase owns the password.
            const changed = await updatePassword(password);
            if (!changed.success) {
                throw new Error(changed.error || 'Could not update the password.');
            }

            // 2. Only now mark the account as no longer temporary. If this step
            //    fails the password is still changed, which is the safe order:
            //    the user may be asked again, but the shared password is gone.
            const cleared = await clearTemporaryPasswordFlag();
            if (!cleared.success) {
                throw new Error(
                    cleared.error || 'Password changed, but the account could not be released. Please contact the administrator.'
                );
            }

            // 3. Refresh so the app sees the cleared flag and moves on.
            await refreshUser();
        } catch (err: any) {
            console.error('Change password error:', err);
            setError(err.message || 'Could not update the password.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen w-full bg-slate-100 p-4 sm:p-6">
            <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 relative">
                <div className="absolute top-3 right-3 z-20">
                    <LanguageSwitcher variant="button" />
                </div>

                <div className="pt-8 pb-6 px-6 sm:px-8 flex flex-col items-center text-center">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 mb-4">
                        <SchoolLogoIcon className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-800">
                        {t('auth.changePasswordTitle', 'Set Your Password')}
                    </h2>
                    <p className="text-sm text-slate-500 mt-2">
                        {t('auth.changePasswordSubtitle', 'Your account was set up with a temporary password. Please choose your own to continue.')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="px-6 sm:px-8 pb-8 space-y-4" autoComplete="off" noValidate>
                    {user?.email && (
                        <p className="text-center text-xs text-slate-400">{user.email}</p>
                    )}

                    <div className="relative">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('auth.newPassword', 'New Password')}
                            className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                            autoComplete="new-password"
                            required
                        />
                    </div>

                    <div className="relative">
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder={t('auth.confirmPassword', 'Confirm New Password')}
                            className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                            autoComplete="new-password"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSaving}
                        className="w-full py-2.5 sm:py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-70 text-sm sm:text-base"
                    >
                        {isSaving ? `${t('auth.savePassword', 'Save Password')}…` : t('auth.savePassword', 'Save Password')}
                    </button>

                    {error && (
                        <p className="text-center text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                            {error}
                        </p>
                    )}

                    {/* An escape hatch: without it a user who cannot set a
                        password is stuck on this screen with no way out. */}
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => {
                                void signOut();
                                void appSignOut();
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            {t('auth.signOut', t('auth.backToSignIn', 'Sign out'))}
                        </button>
                    </div>
                </form>
            </div>

            <div className="mt-6 sm:mt-8 text-center max-w-md px-4">
                <h3 className="text-slate-800 font-bold text-[10px] sm:text-xs tracking-wider">{t('auth.professionalPortal')}</h3>
                <p className="text-slate-400 text-[10px] sm:text-xs mt-1">{t('auth.modernLearning')}</p>
            </div>
        </div>
    );
};

export default ChangePasswordScreen;
