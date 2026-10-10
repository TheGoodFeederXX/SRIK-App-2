import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import Login from '../Login';
import { renderWithProviders } from '../../../test-utils';
import { signInWithEmail } from '../../../src/lib/supabase/auth';

// Mock the Supabase auth module — the real one would make network calls.
// Only signInWithEmail is exercised by this screen.
vi.mock('../../../src/lib/supabase/auth', () => ({
    signInWithEmail: vi.fn(),
}));

// Mock api to prevent AuthContext initialization errors.
vi.mock('../../../lib/api', () => ({
    api: {
        getMe: vi.fn().mockResolvedValue(null),
        getMemberships: vi.fn().mockResolvedValue([]),
    }
}));

const mockSignIn = vi.fn().mockResolvedValue(undefined);

// Mock AuthContext to provide signIn and prevent auto-initialization.
// switchDemoRole is deliberately absent: the demo flow has been removed, and a
// test that still needed it would be asserting behaviour that no longer exists.
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({
        signIn: mockSignIn,
        forgotPassword: vi.fn(),
        resetPassword: vi.fn(),
        loading: false,
        user: null,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('Login Component Integration Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('renders the sign-in form', async () => {
        renderWithProviders(<Login />);

        expect(await screen.findByText(/School Portal Sign In/i)).toBeDefined();
        // The field is email-only now: the old screen accepted a school ID
        // (e.g. SCH01_BR02_TCH_005), which Supabase Auth cannot represent.
        expect(await screen.findByPlaceholderText(/^Email$/i)).toBeDefined();
        expect(await screen.findByPlaceholderText(/Password/i)).toBeDefined();
    });

    it('offers no way in except email and password', async () => {
        renderWithProviders(<Login />);
        await screen.findByText(/School Portal Sign In/i);

        // These removals are intentional and load-bearing, so assert they are
        // absent rather than merely untested. A regression that quietly restored
        // any of them would reopen a path this project deliberately closed.
        expect(screen.queryByText(/Try Demo School/i)).toBeNull();          // demo role switcher
        expect(screen.queryByText(/Create School Account/i)).toBeNull();    // self-signup
        expect(screen.queryByText(/Loading Google/i)).toBeNull();           // Google / SSO
        expect(screen.queryByText(/Sign in with Google/i)).toBeNull();

        // Exactly two inputs: email and password. A third would mean another
        // credential path crept back in.
        expect(document.querySelectorAll('input:not([type="hidden"])').length).toBe(2);
    });

    describe('Manual Login Flow', () => {
        it('signs in successfully with valid credentials', async () => {
            (signInWithEmail as any).mockResolvedValue({
                success: true,
                data: { userId: '123', email: 'test@example.com' },
            });

            renderWithProviders(<Login />);

            const emailInput = await screen.findByPlaceholderText(/^Email$/i);
            const passwordInput = await screen.findByPlaceholderText(/Password/i);
            const signInBtn = await screen.findByRole('button', { name: /Sign In/i });

            fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
            fireEvent.change(passwordInput, { target: { value: 'password123' } });
            fireEvent.click(signInBtn);

            await waitFor(() => {
                expect(signInWithEmail).toHaveBeenCalledWith('test@example.com', 'password123');
            });
            // The session is established by Supabase and bridged in AuthContext,
            // so this screen must not also be pushing a token into app state.
            expect(mockSignIn).not.toHaveBeenCalled();
        });

        it('shows the same "Invalid credentials" message the old screen showed', async () => {
            (signInWithEmail as any).mockResolvedValue({
                success: false,
                error: 'Invalid credentials',
            });

            renderWithProviders(<Login />);

            const emailInput = await screen.findByPlaceholderText(/^Email$/i);
            const passwordInput = await screen.findByPlaceholderText(/Password/i);
            const signInBtn = await screen.findByRole('button', { name: /Sign In/i });

            fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
            fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
            fireEvent.click(signInBtn);

            await waitFor(() => {
                expect(screen.getByText(/Invalid credentials/i)).toBeDefined();
            });
        });

        it('refuses to submit when a field is empty', async () => {
            renderWithProviders(<Login />);

            const signInBtn = await screen.findByRole('button', { name: /Sign In/i });
            fireEvent.click(signInBtn);

            await waitFor(() => {
                expect(screen.getByText(/Please enter both email and password/i)).toBeDefined();
            });
            // The guard must short-circuit: no request should be attempted.
            expect(signInWithEmail).not.toHaveBeenCalled();
        });

        it('routes an unconfirmed email to verification instead of a dead end', async () => {
            // The old flow computed this flag and then discarded it, leaving the
            // user with no explanation. It must now be surfaced.
            (signInWithEmail as any).mockResolvedValue({
                success: false,
                error: 'Please verify your email before logging in',
                requiresVerification: true,
            });

            renderWithProviders(<Login />);

            const emailInput = await screen.findByPlaceholderText(/^Email$/i);
            const passwordInput = await screen.findByPlaceholderText(/Password/i);
            fireEvent.change(emailInput, { target: { value: 'unverified@example.com' } });
            fireEvent.change(passwordInput, { target: { value: 'password123' } });
            fireEvent.click(await screen.findByRole('button', { name: /Sign In/i }));

            await waitFor(() => {
                expect(screen.getByText(/verify your email/i)).toBeDefined();
            });
        });

        it('surfaces a disabled-account message rather than a wrong-password message', async () => {
            (signInWithEmail as any).mockResolvedValue({
                success: false,
                error: 'This account has been disabled. Contact the school administrator.',
            });

            renderWithProviders(<Login />);

            const emailInput = await screen.findByPlaceholderText(/^Email$/i);
            const passwordInput = await screen.findByPlaceholderText(/Password/i);
            fireEvent.change(emailInput, { target: { value: 'disabled@example.com' } });
            fireEvent.change(passwordInput, { target: { value: 'password123' } });
            fireEvent.click(await screen.findByRole('button', { name: /Sign In/i }));

            await waitFor(() => {
                expect(screen.getByText(/account has been disabled/i)).toBeDefined();
            });
        });
    });
});
