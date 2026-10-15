/**
 * Every translation key used in a component must exist in BOTH locale files.
 *
 * WHY THIS IS THE MOST IMPORTANT GUARD FOR THIS WORK. Translating a screen means replacing text
 * with `t('some.key')`. If that key is not in the locale file, the reader sees the KEY ITSELF —
 * `studentDashboard.yourFocus` — which is worse than the English it replaced, because it means
 * nothing at all and looks like a broken page.
 *
 * Nothing else catches this. `tsc` is happy, the screen compiles, the tests pass, and the defect
 * appears only in front of a child. This test reads the source of every screen, extracts every
 * `t('…')` key, and checks it resolves in Malay AND has a matching English entry.
 *
 * It also asserts the two locales stay symmetrical, so a key added to one and forgotten in the
 * other cannot ship.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import ms from '../locales/ms.json';
import en from '../locales/en.json';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');

const flatten = (obj: unknown, prefix = ''): string[] =>
    Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
            ? flatten(v, `${prefix}${k}.`)
            : [`${prefix}${k}`],
    );

const MS_KEYS = new Set(flatten(ms));
const EN_KEYS = new Set(flatten(en));

// One representative per folder, plus the screens already migrated, so the guard covers the
// work that exists without walking the whole tree on every run.
const SCREENS = execFileSync(
    'find',
    ['components', 'src', 'context', '-name', '*.tsx', '-not', '-path', '*__tests__*'],
    { cwd: ROOT, encoding: 'utf8' },
)
    .trim()
    .split('\n')
    .filter(Boolean);

describe('translation keys used by screens actually resolve', () => {
    it('finds screens to check', () => {
        // A guard that walks a path that moved checks nothing while staying green.
        expect(SCREENS.length).toBeGreaterThan(100);
    });

    it('every t() key in a component exists in Malay and in English', () => {
        const missing: string[] = [];
        for (const file of SCREENS) {
            let src: string;
            try { src = readFileSync(resolve(ROOT, file), 'utf8'); } catch { continue; }
            // Strip comments so a documented example key is not treated as a real one.
            const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            for (const m of code.matchAll(/\bt\(\s*['"]([A-Za-z][\w.]*)['"]/g)) {
                const key = m[1];
                // i18next stores plurals as `<key>_one` / `<key>_other`, so a call to
                // `t('x.y', { count })` legitimately has no bare `x.y` entry. Accept either
                // the key itself or its plural forms — otherwise this guard would report a
                // correct plural call as a missing key and push someone to "fix" it wrongly.
                const exists = (set: Set<string>) =>
                    set.has(key) || set.has(`${key}_one`) || set.has(`${key}_other`);
                if (!exists(MS_KEYS)) missing.push(`ms:${file}:${key}`);
                if (!exists(EN_KEYS)) missing.push(`en:${file}:${key}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('the two locales define exactly the same keys', () => {
        const onlyMs = [...MS_KEYS].filter((k) => !EN_KEYS.has(k));
        const onlyEn = [...EN_KEYS].filter((k) => !MS_KEYS.has(k));
        expect({ onlyMs, onlyEn }).toEqual({ onlyMs: [], onlyEn: [] });
    });

    it('a value passed where a KEY belongs is not actually an English sentence', () => {
        // A KEY THAT IS SECRETLY A SENTENCE renders the sentence itself, so the screen looks
        // translated and is not. `UserRolesScreen` carried
        // `descriptionKey: 'A parent or guardian. Sees only their own children.'` — the guard
        // above passes it, because `t()` of a missing key returns the key, and nobody noticed
        // the guardian card was still English on a Malay screen.
        //
        // A real key has no spaces at all. That single rule is unambiguous and cannot mistake
        // a legitimate key for a sentence.
        const offenders: string[] = [];
        for (const file of SCREENS) {
            let src: string;
            try { src = readFileSync(resolve(ROOT, file), 'utf8'); } catch { continue; }
            const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            // `xKey: '…'` / `xKey = '…'` — a value that claims to be a key.
            for (const m of code.matchAll(/\b\w*[Kk]ey\s*[:=]\s*['"]([^'"]+)['"]/g)) {
                const value = m[1];
                if (/\s/.test(value)) offenders.push(`${file}: ${value}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
