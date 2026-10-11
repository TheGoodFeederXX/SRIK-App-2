#!/usr/bin/env node
// Runs before `vite build` (see package.json's prebuild/prebuild:vps).
//
// Frontend env vars get baked into the built JS bundle at build time. A missing
// one does not fail loudly the way a missing backend secret does — it ships a
// bundle that cannot talk to anything. And a placeholder is worse: it ships a
// real-looking key that is not a key.
//
// TWO DIFFERENT CHECKS, and they are different jobs:
//
//   1. REQUIRED. The app is useless without the Supabase connection details.
//      Without them `requireSupabase()` has nothing to build a client from and
//      every screen that loads data shows an empty state — the deploy looks
//      finished, the site answers 200, and nobody can log in. That is exactly the
//      failure this check exists to stop, so these must be present.
//
//   2. PLACEHOLDER. Everything else is optional and the app degrades gracefully
//      (see lib/config.ts, lib/ai.ts). A var that is set but still looks like an
//      example value is a copy-paste that will not work, so it fails too — whether
//      or not the feature is optional.
//
// The previous version only did (2), and its list was all legacy vars: it checked
// VITE_PAYSTACK_PUBLIC_KEY, VITE_FLUTTERWAVE_PUBLIC_KEY and a Gemini key for
// modules this project removed, while never checking the two variables the app
// cannot run without. So the build passed, correctly, and a deployment could still
// be broken in the way that matters most.

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const root = process.cwd();
const envFiles = ['.env.production.local', '.env.production', '.env.local', '.env'];

const vars = {};
for (const file of envFiles) {
    const p = resolve(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, key, rawValue] = m;
        if (!(key in vars)) vars[key] = rawValue.replace(/^["']|["']$/g, '');
    }
}

const valueOf = (key) =>
    process.env[key] !== undefined ? process.env[key] : vars[key];

/**
 * What the app cannot work without.
 *
 * `VITE_SUPABASE_PUBLISHABLE_KEY` is the publishable key — safe in a browser, by
 * design. A SECRET key must never appear here, and client.ts refuses to build a
 * browser client from one; see the guard below, which is the reason this file
 * knows the difference.
 */
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

const PLACEHOLDER_PATTERNS = [
    /^your[-_]/i,
    /^YOUR_/,
    /_xxx$/i,
    /^xxx/i,
    /replace-with/i,
    /change[-_]?me/i,
    // The example file's own placeholder host. A real project URL is
    // https://<project-ref>.supabase.co, and the example uses this exact host.
    /^https?:\/\/your-project\.supabase\.co/i,
];

const isPlaceholder = (value) => PLACEHOLDER_PATTERNS.some((re) => re.test(value));

/**
 * Vars that are set only when someone wants them, but must then be real.
 *
 * The legacy payment, chat and weather keys are gone with the modules that used
 * them. Keeping them in the list meant the check spent its attention on variables
 * nothing reads and had none left for the two that matter.
 */
const OPTIONAL_BUT_REAL = [
    'VITE_SENTRY_DSN',
    'VITE_API_URL',
];

const failures = [];

for (const key of REQUIRED) {
    const value = valueOf(key);

    if (value === undefined || value.trim() === '') {
        failures.push(
            `  ${key} — MISSING.\n`
            + '      Without this the built app cannot connect to anything: every screen\n'
            + '      shows an empty state and no one can sign in, while the site itself\n'
            + '      answers normally.',
        );
        continue;
    }

    if (isPlaceholder(value)) {
        failures.push(`  ${key} — still an example value: ${value}`);
    }
}

// A secret key in a VITE_ variable would be baked into the bundle and served to
// every visitor. client.ts already refuses to use one; catching it at build time
// means it never gets that far.
for (const key of REQUIRED) {
    const value = valueOf(key) ?? '';
    if (/^sb_secret_/.test(value) || /service_role/.test(value)) {
        failures.push(
            `  ${key} — this is a SECRET key.\n`
            + '      Everything behind a VITE_ prefix is public: it is compiled into the\n'
            + '      JavaScript that every visitor downloads. Use the publishable key.',
        );
    }
}

for (const key of OPTIONAL_BUT_REAL) {
    const value = valueOf(key);
    if (value && isPlaceholder(value)) {
        failures.push(`  ${key} — still an example value: ${value}`);
    }
}

if (failures.length > 0) {
    console.error('\n❌ Build blocked: the frontend environment is not usable.\n');
    console.error(failures.join('\n'));
    console.error('\nSet the real values in your .env file (see .env.example), then build');
    console.error('again. For the Supabase values: the project URL and the publishable');
    console.error('key are both shown in the project\'s API settings.\n');
    process.exit(1);
}

console.log(`✅ [check-env] Supabase connection configured (${valueOf('VITE_SUPABASE_URL')}).`);
console.log('✅ [check-env] No placeholder values found in frontend env vars.');
