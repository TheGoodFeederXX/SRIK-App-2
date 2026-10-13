/**
 * No screen may show a hard-coded display string.
 *
 * WHY THIS EXISTS, AND WHY IT IS DIFFERENT FROM THE OTHER TWO GUARDS.
 *
 * `locale-parity` catches a key missing in one language. `screen-keys-resolve` catches a key that
 * resolves to nothing, so the reader would see `studentDashboard.yourFocus` on the screen. Both
 * start from a `t('…')` call.
 *
 * Neither can see the defect that actually happened repeatedly while translating this app: text
 * that was NEVER WRAPPED in `t()` at all. The screen renders a literal English or Malay sentence,
 * every key resolves, both locales are symmetrical, every test is green — and a reader who chose
 * English still sees Malay, or the reverse. Nothing in the suite noticed. The only thing that
 * found these was a person reading the source.
 *
 * So this guard reads the source and flags prose that reaches the screen without going through a
 * translation. It is deliberately narrow: it checks the shapes where display text is certain
 * (a JSX text node, a `title=`/`label=`/`placeholder=` attribute, a toast message), and it skips
 * comments, log lines, and known non-display values (view IDs, status codes, class names, URLs),
 * because a guard that cries wolf gets switched off.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');

// ONLY REACHABLE FILES. A screen nothing imports cannot be opened, so its text never reaches a
// reader; flagging it would fill this guard with work that changes nothing and train the next
// person to ignore it. Reachability is computed the same way the translation tool computes it, so
// the two never disagree about what counts as live.
const REACHABLE = new Set(
    JSON.parse(
        execFileSync('node', ['scripts/i18n/reachability.mjs', '--json'], { cwd: ROOT, encoding: 'utf8' }),
    ),
);
const FILES = execFileSync(
    'find',
    ['components', 'context', '-name', '*.tsx', '-not', '-path', '*__tests__*', '-not', '-path', '*backup*'],
    { cwd: ROOT, encoding: 'utf8' },
)
    .split('\n')
    .filter(Boolean)
    .filter((f) => REACHABLE.has(f));

/** A sentence a person reads: two capitalised words and a space between them. */
const looksLikeDisplay = (s: string): boolean => {
    const t = s.trim();
    if (t.length < 8 || t.length > 200) return false;
    const words = t.split(/\s+/);
    if (words.length < 2) return false;
    // Must contain a real word, not just CSS utilities or an identifier.
    if (!/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(t)) return false;
    // Skip code-like values.
    if (/^[a-z][a-zA-Z]*$/.test(t)) return false;
    if (/[{}<>]|https?:|^\s*[\w-]+\s+\{/.test(t)) return false;
    if (/^[a-z]+(-[a-z0-9]+)+$/.test(t)) return false;
    return true;
};

describe('no untranslated display text', () => {
    it('no slide renders a literal sentence outside a translation call', () => {
        const offenders: string[] = [];

        for (const file of FILES) {
            const src = readFileSync(resolve(ROOT, file), 'utf8');
            const lines = src.split('\n');

            lines.forEach((line, i) => {
                const raw = line;
                const trimmed = line.trim();
                // Comments are for the next programmer, not the reader.
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
                // Logs never reach a screen.
                if (/console\.(log|error|warn|info|debug)/.test(raw)) return;
                // `new Promise<void>(...)` is code: the text rule sees `Promise` between `>` and `<`
                // and reads it as prose. A JSX text node can never contain a bare identifier that
                // starts with a lowercase word followed by `<`, so this is safe to skip.
                if (/new\s+Promise\s*</.test(raw)) return;
                // Already translated on this line.
                if (/\bt\(|i18n\.t\(/.test(raw)) return;

                // JSX TEXT NODE: `>Some Sentence Here<`
                for (const m of raw.matchAll(/>([^<>{}]+)</g)) {
                    if (looksLikeDisplay(m[1])) {
                        offenders.push(`${file}:${i + 1} jsx: ${m[1].trim().slice(0, 60)}`);
                    }
                }
                // DISPLAY ATTRIBUTES with a bare literal.
                for (const m of raw.matchAll(/\b(title|label|placeholder|message|confirmText|description)=(["'])([^"']{8,})\2/g)) {
                    if (looksLikeDisplay(m[3])) {
                        offenders.push(`${file}:${i + 1} ${m[1]}=: ${m[3].slice(0, 60)}`);
                    }
                }
                // TOAST with a bare literal.
                for (const m of raw.matchAll(/\btoast\.(success|error|loading)\(\s*(["'])([^"']{8,})\2/g)) {
                    if (looksLikeDisplay(m[3])) {
                        offenders.push(`${file}:${i + 1} toast: ${m[3].slice(0, 60)}`);
                    }
                }
            });
        }

        // Report a few examples rather than 500 lines, so the failure is readable.
        const shown = offenders.slice(0, 30).join('\n  ');
        expect(
            offenders,
            `${offenders.length} display string(s) never wrapped in t():\n  ${shown}`,
        ).toEqual([]);
    });
});
