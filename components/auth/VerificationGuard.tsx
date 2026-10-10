import React from 'react';

/**
 * Pass-through wrapper.
 *
 * This used to block protected routes until an email was verified by typing a
 * 6-digit code. Email confirmation now happens through Supabase, which sends a
 * LINK and gates the session itself, so a client-side route guard has nothing
 * left to enforce — and a guard that appears to enforce something while doing
 * nothing is worse than no guard at all.
 *
 * It is kept as an explicit pass-through rather than deleted so that App.tsx
 * and any future route does not have to change in the same step. If no caller
 * needs it after the legacy auth path is removed, delete it then.
 */
interface VerificationGuardProps {
    children: React.ReactNode;
    /** Accepted for compatibility; no longer changes behaviour. */
    requireVerification?: boolean;
}

export const VerificationGuard: React.FC<VerificationGuardProps> = ({ children }) => <>{children}</>;

export default VerificationGuard;
