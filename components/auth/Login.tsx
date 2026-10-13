import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SchoolLogoIcon } from '../../components/shared/SchoolLogoIcon';
import { THEME_CONFIG } from '../../lib/themeConfig';
import { signInWithEmail } from '../../src/lib/supabase/auth';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../shared/LanguageSwitcher';

const EyeIcon = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const EyeOffIcon = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
);


// `onNavigateToSignup` / `onNavigateToCreateSchool` are accepted but
// deliberately unused: self-service signup was removed, because accounts are
// created by an administrator. The props stay in the signature so the router
// that renders this screen does not need to change in the same step.
const Login: React.FC<{ onNavigateToSignup?: () => void; onNavigateToCreateSchool?: () => void }> = () => {
  const [view, setView] = useState<'login' | 'forgot-password' | 'reset-password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { forgotPassword } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  // Verification state
  const [otpCode, setOtpCode] = useState('');


  // Forgot Password flow - Step 1: Request Code
  if (view === 'forgot-password') {
    return (
      <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 p-8 flex flex-col">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 mb-6 self-center">
            <SchoolLogoIcon className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 text-center mb-2">{t('login.forgotPassword')}</h2>
          <p className="text-xs text-slate-500 text-center mb-8">{t('login.enterYourEmailAddressAndWeLlSendYouACodeToRese')}</p>
          
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            if (!email) { setError('Email is required'); return; }
            setIsLoading(true);
            setError('');
            try {
              await forgotPassword(email);
              setView('reset-password');
            } catch (err: any) {
              setError(err.message || 'Failed to send reset code');
            } finally {
              setIsLoading(false);
            }
          }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.yourEmailAddress')}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
              required
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-70 text-sm"
            >
              {isLoading ? 'Sending Code...' : 'Send Reset Code'}
            </button>
            <button
              type="button"
              onClick={() => setView('login')}
              className="w-full py-2 text-slate-400 text-xs font-semibold hover:text-slate-600 transition-colors"
            >
              {t('login.backToSignIn')}
            </button>
          </form>
          {error && <div className="mt-4 p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100">{error}</div>}
        </div>
      </div>
    );
  }

  // Sent-confirmation view.
  //
  // Supabase emails a LINK; it does not send a code. The previous view asked the
  // user to type a 6-digit code and a new password, which could never succeed
  // once Supabase owned identity — the code simply never arrived, so the reset
  // flow was broken while appearing to work.
  //
  // The screen now tells the user what to do rather than collecting input it
  // cannot act on.
  if (view === 'reset-password') {
    return (
      <div className="min-h-screen w-full bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 p-8 flex flex-col">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 mb-6 self-center">
            <SchoolLogoIcon className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 text-center mb-2">{t('login.checkYourEmail')}</h2>
          <p className="text-xs text-slate-500 text-center mb-6">
            We have sent a password reset link to <span className="font-semibold text-slate-700">{email}</span>.
            Open it to choose a new password.
          </p>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-6">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              The link expires after a short time. If it has expired, request a new one below.
            </p>
          </div>

          {error && (
            <p className="text-center text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-4">
              {error}
            </p>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={async () => {
                setIsLoading(true);
                setError('');
                try {
                  await forgotPassword(email);
                } catch (err: any) {
                  setError(err.message || 'Failed to send reset link');
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
              className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-70 text-sm"
            >
              {isLoading ? 'Sending...' : 'Send New Link'}
            </button>
            <button
              type="button"
              onClick={() => { setView('login'); setError(''); }}
              className="w-full py-2 text-slate-400 text-xs font-semibold hover:text-slate-600 transition-colors"
            >
              {t('login.backToSignIn')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setIsLoading(true);

    try {
      // Sign-in goes to Supabase Auth (email + password). The visible contract
      // is unchanged: the same error text ("Invalid credentials"), the same
      // loading state, the same redirect behaviour.
      const result = await signInWithEmail(email, password);

      if (!result.success) {
        // An unconfirmed email is not a wrong password, so the message says so
        // instead of showing a generic failure. Supabase confirms email via a
        // LINK, not a typed code, so there is no code-entry screen to route to:
        // the user is told to check their inbox and the message stays on screen.
        throw new Error(result.error || 'Invalid credentials');
      }

      // The Supabase session is already persisted. AuthContext restores it and
      // resolves the role from the database, so there is no token to forward
      // here. App.tsx swaps this screen for the dashboard once auth state
      // settles, which is why there is no navigate() call.
    } catch (err: any) {
      console.error("Login Error", err);
      setError(err.message || 'Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full bg-slate-100 p-4 sm:p-6">
      {/* Centered Card */}
      <div className="w-full max-w-[400px] bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 relative">

        {/* Language picker — available before sign-in for any user worldwide */}
        <div className="absolute top-3 right-3 z-20">
          <LanguageSwitcher variant="button" />
        </div>

        {/* Top Header Section */}
        <div className="pt-8 pb-6 px-6 sm:px-8 flex flex-col items-center text-center">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 mb-4">
            <SchoolLogoIcon className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">{t('auth.schoolPortalSignIn')}</h2>
        </div>

        {/* Form Section */}
        <div className="px-6 sm:px-8 pb-8">
          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off" noValidate>
            <div>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('auth.email')}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                required
                autoComplete="off"
                name="email_prevent_autofill"
              />
            </div>

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('auth.password')}
                className="w-full px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none pr-12"
                required
                autoComplete="new-password"
                name="password_prevent_autofill"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
              >
                {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 sm:py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-70 text-sm sm:text-base"
            >
              {isLoading ? `${t('auth.signIn')}…` : t('auth.signIn')}
            </button>

            <div className="text-center">
              <button 
                type="button"
                onClick={() => {
                  setError('');
                  setView('forgot-password');
                }}
                className="text-[10px] sm:text-xs text-slate-400 hover:text-slate-600 font-medium"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>
          </form>
        </div>

        {/* Error Message */}
        {error && (
          <div className="absolute top-4 right-4 left-4 sm:left-auto max-w-none sm:max-w-[200px] bg-red-50 text-red-600 text-[10px] sm:text-xs p-3 rounded-lg border border-red-100 shadow-sm animate-fade-in">
            {error}
          </div>
        )}

      </div>

      {/* Footer Info */}
      <div className="mt-6 sm:mt-8 text-center max-w-md px-4">
        <h3 className="text-slate-800 font-bold text-[10px] sm:text-xs tracking-wider">{t('auth.professionalPortal')}</h3>
        <p className="text-slate-400 text-[10px] sm:text-xs mt-1">{t('auth.modernLearning')}</p>
      </div>
    </div>
  );
};

export default Login;
