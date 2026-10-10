/**
 * test-utils.tsx
 * Custom render helper that wraps components with all required providers.
 * Use `renderWithProviders` instead of `render` in tests that need context.
 */
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

import { AuthProvider } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { SchoolScopeProvider } from './context/SchoolScopeContext';

const defaultQueryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: Infinity },
        mutations: { retry: false },
    },
});

/**
 * The client `renderWithProviders` uses, exported so a test can reset it.
 *
 * WHY. `staleTime: Infinity` means a query answered once is never asked again for
 * the life of the suite. That is a sensible default for most tests — it keeps them
 * off the network — but it makes it impossible for a test to assert on what happens
 * when a query FAILS, if an earlier test in the same file already made it succeed.
 * The success is served from cache, the failing mock is never called, and the test
 * reports a missing UI element that is really a stale cache.
 *
 * A test that needs a different answer calls `resetTestQueryClient()` first.
 */
export function resetTestQueryClient() {
    defaultQueryClient.clear();
}

export { defaultQueryClient as testQueryClient };

function AllProviders({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider client={defaultQueryClient}>
            <MemoryRouter>
                <AuthProvider>
                    <ProfileProvider>
                        <SchoolScopeProvider>
                            {children}
                        </SchoolScopeProvider>
                    </ProfileProvider>
                </AuthProvider>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {}

export function renderWithProviders(
    ui: ReactElement,
    options: RenderWithProvidersOptions = {}
) {
    return render(ui, { wrapper: AllProviders, ...options });
}

// Also export a createTestQueryClient helper
export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
}

// Re-export everything from testing-library for convenience
export * from '@testing-library/react';
