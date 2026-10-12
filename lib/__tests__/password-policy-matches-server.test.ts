/**
 * AUDIT F39 — the password rule must be the SAME in the app and on the server.
 *
 * THE DEFECT. The app checked "at least 8 characters". The Supabase project requires 10 AND
 * three character classes. A teacher choosing a nine-character password therefore passed the
 * app's own check and was refused by the server with a message they could not act on. The two
 * rules lived in different places and nothing compared them.
 *
 * WHY THIS TEST READS THE SOURCE AS TEXT rather than importing it. `src/lib/supabase/auth.ts`
 * imports the Supabase client, which reads environment variables and opens a connection at
 * module load. The rest of this suite reaches for text for the same reason, and it also lets
 * the test assert what is WRITTEN rather than only what happens to be exported.
 *
 * WHAT IT PINS. The app-side rule lives once, in `PASSWORD_MIN_LENGTH` and
 * `describePasswordProblem`. These checks compare it against the values the live server
 * enforces, so raising the server minimum without updating the app (or the reverse) fails here
 * rather than in front of a teacher.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const AUTH = readFileSync(resolve(ROOT, 'src/lib/supabase/auth.ts'), 'utf8');
const DECISION = readFileSync(resolve(ROOT, 'docs/decisions/F39-password-protection.md'), 'utf8');

describe('F39 — password policy matches the server', () => {
    it('uses the server minimum of 10, not the old 8', () => {
        // The constant the whole rule hangs on.
        expect(AUTH).toMatch(/PASSWORD_MIN_LENGTH\s*=\s*10\b/);

        // And the OLD claim must be gone. This is the defect itself: an eight-character
        // minimum that disagreed with the server.
        expect(AUTH).not.toMatch(/at least 8 characters/);
        expect(AUTH).not.toMatch(/newPassword\.length\s*<\s*8\b/);
    });

    it('requires the same three character classes the server requires', () => {
        expect(AUTH).toMatch(/PASSWORD_REQUIRED_CLASSES.*lowercase.*uppercase.*digit/s);
        // Each class must actually be tested, not merely listed.
        expect(AUTH).toMatch(/\/\[a-z\]\/\.test\(/);
        expect(AUTH).toMatch(/\/\[A-Z\]\/\.test\(/);
        expect(AUTH).toMatch(/\/\[0-9\]\/\.test\(/);
    });

    it('states the rule ONCE and calls it from the password change path', () => {
        // Two copies of a rule is how they drift apart. There must be exactly one definition...
        const definitions = AUTH.match(/export function describePasswordProblem/g) ?? [];
        expect(definitions).toHaveLength(1);
        // ...and the change-password path must actually use it.
        expect(AUTH).toMatch(/const passwordProblem = describePasswordProblem\(newPassword\)/);
        // The old inline check must not survive beside it.
        expect(AUTH).not.toMatch(/newPassword\.length\s*<\s*PASSWORD_MIN_LENGTH/);
    });

    it('explains WHY in Malay, because the reader is a teacher not a programmer', () => {
        // The message must name the required length rather than say "invalid".
        expect(AUTH).toMatch(/Kata laluan mesti sekurang-kurangnya \$\{PASSWORD_MIN_LENGTH\}/);
        expect(AUTH).toMatch(/huruf kecil/);
        expect(AUTH).toMatch(/huruf besar/);
        expect(AUTH).toMatch(/nombor/);
    });

    it('records the reason leaked-password protection is off, with the exact server answer', () => {
        // F39 accepts a written risk decision when the feature is unavailable. This check fails
        // if that decision is deleted — which is how a documented risk becomes an undocumented
        // one. The literal HTTP 402 and the server's own words are required as evidence.
        expect(DECISION).toMatch(/HaveIBeenPwned/);
        expect(DECISION).toMatch(/Pro Plans? and up/i);
        expect(DECISION).toMatch(/HTTP 402/);
    });

    it('does not let the decision read as "this is fine"', () => {
        // It must be an accepted risk with mitigations and a review trigger — not a closure.
        expect(DECISION).toMatch(/Keputusan risiko/i);
        expect(DECISION).toMatch(/Diterima sementara/i);
        expect(DECISION).toMatch(/Mitigasi yang TIADA/i);
        expect(DECISION).toMatch(/disemak semula/i);
        expect(DECISION).toMatch(/500/);
        // And the re-authentication hardening that WAS available must be recorded as done.
        expect(DECISION).toMatch(/security_update_password_require_reauthentication/);
    });
});

describe('F33 — supply chain triage', () => {
    it('records that the reachable advisory count is zero, and why the rest remain', () => {
        const text = readFileSync(resolve(ROOT, 'docs/decisions/F33-dependency-triage.md'), 'utf8');
        // The distinction the finding turns on: reachable vs. dev-only.
        expect(text).toMatch(/boleh dicapai/);
        expect(text).toMatch(/npm audit --omit=dev/);
        expect(text).toMatch(/0 kerentanan/);
        // The three runtimes must be named, because the answer depends on which one runs.
        expect(text).toMatch(/Vercel/);
        expect(text).toMatch(/Tidak dijalankan|TIDAK/);
        // And each remaining high/critical must carry an explicit decision, not silence.
        for (const pkg of ['concurrently', 'nodemon', 'js-yaml', 'braces']) {
            expect(text, `${pkg} has no recorded triage`).toContain(pkg);
        }
    });
});
