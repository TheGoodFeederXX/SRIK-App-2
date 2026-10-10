/**
 * Every date a user reads is a MALAYSIAN date.
 *
 * This is a guard, not a check of behaviour, and it exists because the defect it
 * prevents is invisible in testing. A `toLocaleDateString()` with no locale
 * passes on any machine — it simply follows whichever locale the device happens
 * to have. So on the developer's machine it looks right, and on a parent's phone
 * it silently reads "3/2/2026" instead of "2 Mac 2026", with no error anywhere.
 *
 * The rules, in the order the report found them:
 *   1. A date call with NO locale follows the device. Forbidden.
 *   2. A date call with `'default'` or `[]` means the same thing. Forbidden.
 *   3. A date call with `en-US`/`en-GB`/`en-NG` is an English date in a Malay
 *      school. Forbidden.
 *   4. Speech recognition set to `en-NG` mis-hears Malay. Forbidden.
 *
 * The shared helpers in `src/lib/branding.ts` are the answer, and they are
 * exempt because they are where the locale is defined.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const root = join(__dirname, '..', '..');
const ROOTS = ['components', 'src', 'lib', 'hooks', 'context', 'utils'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__', '__mocks__']);
const EXT = new Set(['.ts', '.tsx']);

/** The one file allowed to name a non-Malay locale, and why. */
const ALLOWED: Record<string, string> = {
    'src/lib/branding.ts':
        'defines the school locale and uses en-CA deliberately, because it is the '
        + 'one locale whose short date is already YYYY-MM-DD — used for machine '
        + 'keys and query strings, never shown to a user',
    'src/lib/supabase/attendance.ts':
        'uses en-CA for the same reason as branding.ts: a YYYY-MM-DD key for the '
        + 'attendance table, with Asia/Kuala_Lumpur pinned alongside it',
};

/** Patterns that mean "the device decides". */
const DEVICE_LOCALE = [
    /toLocale(?:Date|Time)?String\(\s*\)/,              // no argument at all
    /toLocale(?:Date|Time)?String\(\s*\[\]\s*[,)]/,     // [] means the device
    /toLocale(?:Date|Time)?String\(\s*'default'/,       // 'default' means the device
];

/** Patterns that mean "a country this school is not in". */
const FOREIGN_LOCALE = [
    /'(?:en-US|en-GB|en-NG|en-AU|en-CA)'/,
];

function scan(dir: string, hits: string[]) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) { scan(full, hits); continue; }

        const ext = name.slice(name.lastIndexOf('.'));
        if (!EXT.has(ext)) continue;

        const rel = relative(root, full);
        if (ALLOWED[rel]) continue;

        const text = readFileSync(full, 'utf8');
        text.split('\n').forEach((line, i) => {
            const trimmed = line.trim();
            // A comment may explain the history; it cannot reach a user.
            if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

            for (const pattern of DEVICE_LOCALE) {
                if (pattern.test(line)) {
                    hits.push(`DEVICE LOCALE ${rel}:${i + 1}: ${trimmed.slice(0, 130)}`);
                }
            }
            // `en-CA` is only foreign outside the two allowed files above, and
            // the foreign check runs here so a stray one is still caught.
            for (const pattern of FOREIGN_LOCALE) {
                if (pattern.test(line)) {
                    hits.push(`WRONG COUNTRY ${rel}:${i + 1}: ${trimmed.slice(0, 130)}`);
                }
            }
        });
    }
}

describe('no date follows the device locale', () => {
    it('THE RULE: every date call names the school\u2019s locale, never the device\u2019s', () => {
        const hits: string[] = [];
        for (const dir of ROOTS) scan(join(root, dir), hits);
        expect(hits, `dates that follow the device or another country:\n${hits.join('\n')}`).toEqual([]);
    });

    it('THE RULE: speech recognition listens in Malay', () => {
        const hits: string[] = [];
        for (const dir of ROOTS) scan(join(root, dir), hits);
        // Covered by the foreign-locale scan above, asserted separately so the
        // failure message names the problem rather than a locale string.
        expect(hits.filter(h => h.includes('en-NG'))).toEqual([]);
    });

    it('every allowed exception states its reason', () => {
        for (const [file, reason] of Object.entries(ALLOWED)) {
            expect(reason.length, `no reason given for allowing ${file}`).toBeGreaterThan(20);
        }
    });
});
