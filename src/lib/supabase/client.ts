/**
 * Supabase browser client — SRIK.
 *
 * Reference: docs/srik/03_PHASE_1_SUPABASE_AUTH.md
 *
 * SECURITY — read before editing:
 *   Only the PUBLISHABLE key may ever appear here. It is designed to be public
 *   and is protected by Row Level Security in the database. The SECRET key
 *   bypasses RLS entirely and must never be imported into frontend code, given
 *   a VITE_ prefix, or placed in a bundle. Server-only work that needs it
 *   belongs in an Edge Function (see supabase/functions/).
 *
 * Why the key is read eagerly and validated: a missing or placeholder key used
 * to be the kind of problem that surfaced as a confusing runtime failure deep
 * in a request. Failing loudly at construction makes the cause obvious.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Vite's env bag, typed loosely on purpose: not every key is declared. */
const env = import.meta.env as unknown as Record<string, string | undefined>;

const rawUrl = env.VITE_SUPABASE_URL;
const rawPublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** True when both Supabase env vars are present and non-placeholder. */
export const isSupabaseConfigured: boolean = Boolean(
    rawUrl &&
    rawPublishableKey &&
    !rawUrl.includes('your-project') &&
    !rawPublishableKey.includes('xxxx')
);

/**
 * A guard against the one mistake that matters here: shipping the secret key.
 * `sb_secret_` keys bypass RLS, so reaching the browser with one is a data
 * breach, not a misconfiguration. Detect it at module load and refuse to build
 * a client rather than silently leaking privileged access.
 */
const looksLikeSecretKey = (key: string): boolean =>
    key.startsWith('sb_secret_') || key.startsWith('service_role');

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
    if (looksLikeSecretKey(rawPublishableKey!)) {
        throw new Error(
            '[supabase] VITE_SUPABASE_PUBLISHABLE_KEY looks like a SECRET key. ' +
            'Secret keys bypass Row Level Security and must never reach the browser. ' +
            'Use the project publishable key instead.'
        );
    }

    client = createClient(rawUrl!, rawPublishableKey!, {
        auth: {
            // Session restoration is explicit so the app controls when it
            // happens, rather than racing the first render.
            autoRefreshToken: true,
            persistSession: true,
            // MUST stay true. Password-recovery and confirmation links arrive as
            // a URL fragment (#access_token=...&type=recovery), and Supabase only
            // reads that if this is enabled. With it off, a teacher clicking
            // "reset your password" lands on a callback with no session, and
            // account recovery silently fails.
            detectSessionInUrl: true,
            // Pin the storage key so a future default change cannot silently
            // orphan every existing session.
            storageKey: 'srik-auth',
        },
        global: {
            headers: {
                // Makes requests identifiable in logs without leaking anything.
                'x-application-name': 'srik',
            },
        },
    });
}

/**
 * The Supabase client, or null when Supabase is not configured.
 *
 * Callers must handle null. That is intentional: it keeps "Supabase is not set
 * up" a visible, handleable state rather than a crash on an unrelated screen,
 * which matters while the legacy auth path is still present during cutover.
 */
export const supabase: SupabaseClient | null = client;

/**
 * Returns the client or throws a clear error.
 * Use in code paths that genuinely cannot proceed without Supabase.
 */
export function requireSupabase(): SupabaseClient {
    if (!supabase) {
        throw new Error(
            '[supabase] Not configured. Set VITE_SUPABASE_URL and ' +
            'VITE_SUPABASE_PUBLISHABLE_KEY in .env, then restart the dev server.'
        );
    }
    return supabase;
}
