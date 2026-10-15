import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SchoolLogoIcon } from '../shared/SchoolLogoIcon';
import LanguageSwitcher from '../shared/LanguageSwitcher';
import { updatePassword, signOut } from '../../src/lib/supabase/auth';

/**
 * SetPasswordScreen — landing page for a verified Supabase password-recovery
 * link, and the fallback destination when a user arrives at /set-password.
 *
 * WHY IT IS SEPARATE FROM ChangePasswordScreen
 * --------------------------------------------
 * Both screens set a password, but they mean different things and have
 * different side effects:
 *
 *   * ChangePasswordScreen  — an administrator-created account with a
 *     TEMPORARY password. Clearing `must_change_password` is part of the job,
 *     because that flag is what proves the credential is no longer shared.
 *   * SetPasswordScreen     — a FORGOTTEN password. There is no flag to clear:
 *     the user is not a shared-credential risk, they simply could not get in.
 *     Clearing a flag here would be meaningless, and falsely marking an account
 *     as "owner-set" would defeat the purpose of the flag.
 *
 * Keeping them apart also means a recovery session can never be mistaken for a
 * normal signed-in session, which is why App.tsx routes recovery here rather
 * than into the app.
 */
const SetPasswordScreen: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
    const { t } = useTranslation();

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!password || !confirm) {
            setError(t('setPasswordScreen.pleaseFillInBothFields'));
            return;
        }
        if (password !== confirm) {
            setError(t('setPasswordScreen.theTwoPasswordsDoNotMatch'));
            return;
        }
        // Mirrors the project's minimum_password_length, so the user is told
        // immediately rather than after a rejection they cannot interpret.
        if (password.length < 12) {
            setError(t('setPasswordScreen.passwordMustBeAtLeast12Characters'));
            return;
        }

        setIsSaving(true);
        try {
            const result = await updatePassword(password);
            if (!result.success) {
                throw new Error(result.error || 'Could not update the password.');
            }

            // No flag to clear here — see the note above. Signing out after the
            // change forces a clean sign-in with the new password, so the user
            // confirms it works and no half-authenticated recovery session is
            // left behind.
            await signOut();

            if (onDone) onDone();
            else window.location.href = '/';
        } catch (err: any) {
            console.error('Set password error:', err);
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
                        {t('auth.resetPasswordSubtitle', 'Please choose a new password for your account.')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="px-6 sm:px-8 pb-8 space-y-4" autoComplete="off" noValidate>
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

                    {/* Without an escape hatch, a user whose link has already
                        expired would be stuck here with no way back. */}
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => { window.location.href = '/'; }}
                            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            {t('auth.backToSignIn', 'Back to Sign In')}
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

export default SetPasswordScreen;
