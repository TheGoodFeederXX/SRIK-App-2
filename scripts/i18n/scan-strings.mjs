#!/usr/bin/env node
/**
 * Lists user-facing strings that still need translating, grouped by file.
 *
 * This is a WORK LIST, not a fixer. Translating a label is not mechanical: "Save" and
 * "Simpan" are obvious, but "Mark the rest present" needs the right Malay sentence, and a
 * noun used as a column heading may not read the same as the same noun on a button. A tool
 * that rewrote them automatically would produce confident-looking nonsense.
 *
 * What IS mechanical is FINDING them. This reports the file, the line, and the string, so
 * the work is a list to work through rather than a search every time.
 *
 * Usage: node scripts/i18n/scan-strings.mjs [--json] [--file <path>]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
// `args.indexOf('--file')` is -1 when the flag is absent, so `args[-1 + 1]` was `args[0]` —
// which made `--json` itself the "file" to scan. The scanner then reported zero files, and a
// zero is easy to mistake for "nothing to do".
const fileIdx = args.indexOf('--file');
const oneFile = fileIdx === -1 ? undefined : args[fileIdx + 1];

// A string is worth reporting when it looks like prose a person reads: it starts with a
// capital, has at least two words or a decent length, and is not obviously code.
const looksLikeProse = (s) => {
    const t = s.trim();
    if (t.length < 3) return false;
    // Skip anything that is obviously not prose.
    if (/^[A-Z_]+$/.test(t)) return false;            // CONSTANTS
    if (/^[a-z-]+$/.test(t)) return false;            // css-class-like
    if (/^[./@#]/.test(t)) return false;              // paths, imports
    if (/[{}<>]/.test(t)) return false;               // template/code
    if (/^\d/.test(t)) return false;
    // Needs either a space or a real word length.
    return /\s/.test(t) || t.length > 6;
};

const files = oneFile
    ? [oneFile]
    : execFileSync('find', ['components', 'src', 'context', '-name', '*.tsx', '-not', '-path', '*__tests__*'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);

const results = [];
for (const file of files) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    const found = [];

    lines.forEach((line, i) => {
        // Skip comment lines: they are for the next programmer, not the user.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

        // JSX text: >Some Words<
        for (const m of line.matchAll(/>([A-Z][^<>{}]{2,80})</g)) {
            if (looksLikeProse(m[1])) found.push({ line: i + 1, text: m[1].trim(), kind: 'jsx' });
        }
        // Quoted strings that look like sentences.
        for (const m of line.matchAll(/(['"])([A-Z][a-zA-Z][^'"]{4,90})\1/g)) {
            if (looksLikeProse(m[2])) found.push({ line: i + 1, text: m[2].trim(), kind: 'string' });
        }
        // TEXT INSIDE A TEMPLATE LITERAL — the part before any `${...}`. Without this the scanner
        // never saw the most common error message in the app
        // (`\`Could not load the register: ${err.message}\``), so those messages stayed English and
        // no dictionary ever held them. The interpolated part is skipped deliberately: it is code.
        for (const m of line.matchAll(/`([^`$]*\$\{)/g)) {
            // Drop the trailing `$` + `{` of the interpolation before judging, because
            // `looksLikeProse` rejects anything containing braces.
            const text = m[1].replace(/\$\{$/, '').replace(/\s*:?\s*$/, '');
            // A CLASS-STRING template is not prose: `p-2 rounded-lg`, `h-6 w-6`,
            // `flex items-center gap-3`. A real message has at least one word that is neither a
            // CSS utility nor a bare number.
            const words = text.trim().split(/\s+/);
            const cssLike = words.every((w) => /^[a-z0-9:.[\]/%-]+$/.test(w));
            if (!cssLike && looksLikeProse(text)) {
                found.push({ line: i + 1, text: text.trim(), kind: 'template' });
            }
        }
    });

    if (found.length) results.push({ file, count: found.length, strings: found });
}

results.sort((a, b) => b.count - a.count);

if (asJson) {
    console.log(JSON.stringify(results, null, 2));
} else {
    const total = results.reduce((n, r) => n + r.count, 0);
    console.log(`Files needing translation: ${results.length}`);
    console.log(`User-facing strings:       ${total}\n`);
    for (const r of results) {
        console.log(`${String(r.count).padStart(4)}  ${r.file}`);
    }
}
