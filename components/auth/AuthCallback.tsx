import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../src/lib/supabase/client';

/**
 * AuthCallback — handles links that Supabase sends by email
 * (password recovery, email confirmation).
 *
 * WHY THIS WAS REWRITTEN
 * ----------------------
 * This screen used to POST the token from the URL to the legacy Express
 * endpoint `/auth/verify-email`. Supabase issues the link now, and its token is
 * signed and understood by Supabase alone. Posting it to the legacy backend
 * could only ever fail, which meant a teacher clicking "reset your password"
 * reached an error page and could not recover their account. That was a broken
 * feature, not merely dead code.
 *
 * WHAT IT DOES NOW
 * ----------------
 * Supabase parses the token itself. Two shapes arrive here:
 *   * a URL fragment  (#access_token=...&type=recovery)  — the default flow
 *   * a query string  (?code=...)                        — PKCE flow
 * Supabase's client reads both, provided URL detection is enabled, so this
 * screen no longer parses or validates anything by hand. Hand-parsing was how
 * the old bug hid: it looked like careful work while validating the wrong
 * thing against the wrong service.
 *
 * The only job left is to confirm a session exists and send the user onward.
 * For a recovery link the destination is the password screen, because a
 * recovery session may change a password but must not be treated as a normal
 * login.
 */
const AuthCallback: React.FC = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
    const [message, setMessage] = useState('Verifying your link…');
    const [errorDetails, setErrorDetails] = useState<string | null>(null);

    useEffect(() => {
        const settle = async () => {
            try {
                if (!isSupabaseConfigured || !supabase) {
                    throw new Error('Authentication is not configured yet.');
                }

                // Any error Supabase passed back in the URL (expired link, etc.).
                const query = new URLSearchParams(window.location.search);
                const hashParams = new URLSearchParams(
                    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
                );
                const errorDescription =
                    query.get('error_description') || hashParams.get('error_description');
                if (errorDescription) {
                    throw new Error(errorDescription.replace(/\+/g, ' '));
                }

                // Supabase reads the session from the URL as the client loads.
                // getSession() here waits for that to settle, and is also what
                // proves the link was genuinely valid.
                const { data, error } = await supabase.auth.getSession();
                if (error) throw new Error(error.message);

                const session = data.session;
                if (!session?.user) {
                    throw new Error('This link is invalid or has expired. Please request a new one.');
                }

                // `type=recovery` marks a password-reset link. Such a session is
                // only good for setting a new password, so the user is sent
                // there rather than into the app.
                const type = hashParams.get('type') || query.get('type');
                const isRecovery = type === 'recovery';

                setStatus('success');
                setMessage(
                    isRecovery
                        ? 'Verified. Please choose a new password.'
                        : 'Verification successful! Welcome.'
                );

                // Replace the URL so the token is not left in the address bar or
                // in browser history, where it could be replayed or shared.
                window.history.replaceState(null, '', isRecovery ? '/set-password' : '/');

                setTimeout(() => {
                    // A fragment-based token must be cleared by a real navigation
                    // (replaceState cannot strip a fragment before the router
                    // reads it), so send the user onward explicitly.
                    window.location.href = isRecovery ? '/set-password' : '/';
                }, 1200);
            } catch (err: any) {
                console.error('AuthCallback error:', err);
                setStatus('error');
                setMessage('Verification Failed');
                setErrorDetails(err.message || 'The link may be expired or invalid.');
            }
        };

        void settle();
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-gray-100">
                {status === 'processing' && (
                    <div className="space-y-4">
                        <div className="flex justify-center">
                            <div className="relative">
                                <div className="h-20 w-20 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Loader2 className="h-8 w-8 text-indigo-600 animate-pulse" />
                                </div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">{message}</h2>
                        <p className="text-gray-500">{t('authCallback.thisWillOnlyTakeAMoment')}</p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="space-y-4 animate-in fade-in zoom-in duration-500">
                        <div className="flex justify-center">
                            <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center">
                                <CheckCircle className="h-10 w-10 text-green-600" />
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">{message}</h2>
                        <div className="flex justify-center items-center text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Preparing your workspace...
                        </div>
                    </div>
                )}

                {status === 'error' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-center">
                            <div className="h-20 w-20 bg-red-100 rounded-full flex items-center justify-center">
                                <XCircle className="h-10 w-10 text-red-600" />
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">{message}</h2>
                        <p className="text-red-500 bg-red-50 p-3 rounded-lg text-sm border border-red-100">
                            {errorDetails}
                        </p>
                        <button
                            onClick={() => window.location.href = '/'}
                            className="mt-6 w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-indigo-200"
                        >
                            Back to Login
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuthCallback;
