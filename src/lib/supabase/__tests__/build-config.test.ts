import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * GUARD FOR AUDIT F35 — the build must refuse to ship an app that cannot connect,
 * and the storage limits must not contradict each other.
 *
 * TWO DEFECTS.
 *
 * 1. `scripts/check-env.mjs` checked only for placeholder values, and its list was
 *    entirely legacy: a Paystack key, a Flutterwave key and a Gemini key, for
 *    modules this project removed. It never checked VITE_SUPABASE_URL or
 *    VITE_SUPABASE_PUBLISHABLE_KEY — the two variables the app cannot run without.
 *
 *    The failure that hides is specific and nasty: the deploy succeeds, the site
 *    answers 200, and every screen shows an empty state because the browser has
 *    nothing to connect with. It looks like a quiet school with no data, not like a
 *    broken build.
 *
 * 2. `supabase/config.toml` set a 10 MiB upload limit while the bucket and the
 *    `documents.size_bytes` check constraint both allow 25 MB. A local stack would
 *    refuse an 11 MiB upload that production accepts — and nobody would look in the
 *    local config for it, because the local config describes production.
 */

const ROOT = process.cwd();

describe('F35: the build refuses an unusable frontend environment', () => {
    // Comments are stripped before the negative assertions below. The rewrite's own
    // explanation NAMES the variables it removed, and matching against the prose
    // would fail on the correct file.
    const checkEnv = readFileSync(join(ROOT, 'scripts/check-env.mjs'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    it('requires the Supabase connection settings', () => {
        expect(
            checkEnv,
            'the build must fail when VITE_SUPABASE_URL is missing: without it the '
            + 'deploy succeeds and the site loads, but nothing can connect',
        ).toMatch(/VITE_SUPABASE_URL/);

        expect(
            checkEnv,
            'the build must fail when the publishable key is missing, for the same reason',
        ).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    });

    it('refuses a secret key behind a VITE_ prefix', () => {
        // Everything behind VITE_ is compiled into the public bundle.
        expect(
            checkEnv,
            'a secret key behind a VITE_ prefix would be served to every visitor',
        ).toMatch(/sb_secret_/);
        expect(checkEnv, 'service_role keys are secrets too').toMatch(/service_role/);
    });

    it('no longer spends its attention on removed modules', () => {
        // Paystack, Flutterwave and Gemini are removed from the product. A check
        // that still names them is a check reading variables nothing consumes.
        for (const dead of ['VITE_PAYSTACK_PUBLIC_KEY', 'VITE_FLUTTERWAVE_PUBLIC_KEY', 'VITE_GEMINI_API_KEY']) {
            expect(
                checkEnv,
                `${dead} belongs to a removed module; the check should not list it`,
            ).not.toMatch(new RegExp(dead));
        }
    });

    it('the storage limits agree', () => {
        const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
        const migration = readFileSync(
            join(ROOT, 'supabase/migrations/20261016000001_phase6_storage_buckets.sql'),
            'utf8',
        );

        const configMatch = config.match(/file_size_limit\s*=\s*"(\d+)MiB"/i);
        expect(configMatch, 'config.toml must set a storage file_size_limit').toBeTruthy();
        const configBytes = Number(configMatch![1]) * 1024 * 1024;

        // The bucket limit and the documents check constraint: the number appears
        // as bytes in the migration.
        const migrationMatch = migration.match(/file_size_limit[\s\S]{0,200}?(\d{6,})/);
        expect(migrationMatch, 'the storage migration must set a byte limit').toBeTruthy();
        const migrationBytes = Number(migrationMatch![1]);

        expect(
            configBytes,
            `config.toml allows ${configBytes} bytes and the bucket allows ${migrationBytes}. `
            + 'A local stack would refuse an upload that production accepts.',
        ).toBe(migrationBytes);
    });
});
