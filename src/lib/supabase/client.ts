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

/**
 * The largest number of rows the Data API will return in one response.
 *
 * This is not a preference. Asking for more does not give you more — the response
 * simply stops here, with no error and no indication that it was cut short. A list
 * of 1,250 students arrives as 1,000 students and looks complete.
 */
export const MAX_ROWS_PER_REQUEST = 1000;

/** A page of rows, read in the order the caller asked for. */
export type PageReader<T> = (
    from: number,
    to: number,
    // `any` for the wrapper, and it is the honest answer rather than laziness.
    //
    // A Supabase query builder resolves to a different concrete type for every
    // combination of table, select and filter — `PostgrestFilterBuilder<any, any,
    // any, GenericStringError[], 'students', unknown, 'GET', false>`. Naming that
    // shape here means copying a signature that changes with the library, and a
    // narrower guess does not accept a builder at all: it fails to compile with
    // "Type 'PostgrestFilterBuilder<...>' is not assignable to type
    // 'PromiseLike<...>'", which is how the CI caught it.
    //
    // The ROWS stay typed. `T` is the row the caller names and it is what comes back
    // out of `readAllPages<T>`; the untyped part is only the wrapper, which nothing
    // in this function inspects beyond `data` and `error`.
) => PromiseLike<{ data: any; error: { message: string } | null }>;

/**
 * Reads a list in pages until the database has nothing left to give.
 *
 * WHY THIS EXISTS (audit F28). Several of these modules ask for "all the students"
 * or "this family's charges" and then show them on a screen. With ~250 students and
 * a school week of Sunday to Thursday, one week of attendance is already 1,250 rows,
 * and a few months of charges passes 1,000 comfortably. Past that line the response
 * is silently cut short. There is no error to catch: the list is valid, non-empty
 * and incomplete. The screen shows a full register that is quietly missing people,
 * and nobody has any reason to look further.
 *
 * The fix cannot be "raise the limit", because there is no wider request to make.
 * The only correct way to read an unbounded list is to keep asking until the answer
 * runs out.
 *
 * HOW TO USE IT. Pass a function that builds one page of the query with `range`:
 *
 *     const rows = await readAllPages<StudentRow>((from, to) =>
 *         db.from('students').select('...').order('full_name').range(from, to),
 *     );
 *
 * ALWAYS give the query an `order`. Without one the database is free to return rows
 * in a different order for each page, and a row sitting on a page boundary can be
 * returned twice or skipped entirely — a paging bug that looks like missing data.
 *
 * `MAX_PAGES` is a backstop, not a limit anyone should reach. It stops a query that
 * matches far more than expected — a broken filter, say — from looping forever and
 * draining the browser. Reaching it is a genuine error and is reported as one,
 * because a partial list presented as a complete one is the exact failure this
 * function exists to prevent.
 */
export async function readAllPages<T>(
    read: PageReader<T>,
    pageSize: number = MAX_ROWS_PER_REQUEST,
): Promise<T[]> {
    const MAX_PAGES = 100;
    const all: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data, error } = await read(from, to);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) return all;

        all.push(...data);

        // A short page means the end of the data. An exactly-full page might be the
        // end too, so the loop asks once more and stops on the empty answer — one
        // extra request, in exchange for never silently losing the last row.
        if (data.length < pageSize) return all;
    }

    throw new Error(
        `[supabase] Reading this list stopped after ${MAX_PAGES} pages ` +
        `(${MAX_PAGES * pageSize} rows). The result would have been incomplete, so ` +
        `it was refused rather than shown as if it were the whole list.`,
    );
}
