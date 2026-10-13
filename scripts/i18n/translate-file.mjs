#!/usr/bin/env node
/**
 * Translates one file's user-facing strings in a single pass.
 *
 * WHY NOT BY HAND. There are 3,300 strings across 393 files. Doing them one at a time by hand
 * is not finishing; it is starting 393 times. What IS mechanical is the DETECTION and the
 * REWRITE: find a string that is displayed, give it a stable key, replace it. What is NOT
 * mechanical is choosing the Malay. So this tool takes the translations as a MAP — the Malay
 * is still written deliberately, per file — and does the fiddly part.
 *
 * WHAT IT REFUSES. A bare word in JSX (`<span>Present</span>`) is a label. The same word in a
 * comparison (`status === 'Present'`) or as an object key is DATA, and translating it would
 * break behaviour. So it only rewrites:
 *   - JSX text nodes
 *   - values of display props (label, title, placeholder, message, header, description, alt…)
 *   - toast.success/error(...) and window.confirm(...) arguments
 *   - <option> label/value text inside JSX
 * It never touches comparisons, object keys, navigateTo ids, or className.
 *
 * Usage: node scripts/i18n/translate-file.mjs <file> <json-map> [--dry]
 *   json-map: { "English text": "Malay text", ... }
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const mapPath = process.argv[3];
const dry = process.argv.includes('--dry');
if (!file || !mapPath) {
    console.error('usage: translate-file.mjs <file> <json-map> [--dry]');
    process.exit(1);
}

const MAP = JSON.parse(readFileSync(mapPath, 'utf8'));
let src = readFileSync(file, 'utf8');
const used = new Set();
const missed = new Set(Object.keys(MAP));

/** A stable camelCase key from the English text. */
const toKey = (text) => {
    const clean = text.replace(/[^A-Za-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
    const words = clean.split(' ');
    return words
        .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
        .join('')
        .slice(0, 46) || 'text';
};

// Every key is namespaced by the file it came from, so two screens can use the same English
// word with different Malay and not collide. Derived from the file name: components/student/
// StudentDashboard.tsx -> 'studentDashboard'.
const NAMESPACE = (() => {
    const base = file.split('/').pop().replace(/\.tsx?$/, '');
    return base[0].toLowerCase() + base.slice(1);
})();

const keys = new Map(); // English text -> chosen key

function keyFor(english) {
    if (keys.has(english)) return keys.get(english);
    let base = toKey(english);
    let key = base, n = 2;
    const taken = new Set(keys.values());
    while (taken.has(key)) key = `${base}${n++}`;
    const full = `${NAMESPACE}.${key}`;
    keys.set(english, full);
    return full;
}

const changes = [];

/**
 * Regions of the file where a text-match would be WRONG, replaced by inert placeholders and
 * put back afterwards.
 *
 * WHY. The JSX rule looks for `>Some Words<`. That pattern also occurs INSIDE a template
 * literal that generates HTML — for example a PDF transcript built as `<td>No published
 * results yet.</td>`. That is a generated string, and rewriting it destroyed the template and
 * broke the file. Template literals and comments are not display text in the sense this tool
 * means, so they are protected.
 */
const protected_ = [];
// The placeholder is plain ASCII on purpose. An earlier version used a NUL byte, which leaked
// into the output and made three files "binary" to every tool that read them.
const protect = (text) => {
    const token = `__I18N_PROTECTED_${protected_.length}__`;
    protected_.push(text);
    return token;
};
src = src.replace(/`(?:[^`\\]|\\.)*`/gs, protect);           // template literals
src = src.replace(/\/\*[\s\S]*?\*\//g, protect);               // block comments
// Line comments: require start-of-line or whitespace before `//`, so a URL inside a string
// (`https://…`) is not mistaken for a comment.
src = src.replace(/(^|\n)([ \t]*)\/\/[^\n]*/g, (m) => protect(m));

// 1. JSX text nodes.
src = src.replace(/>(\s*)([A-Z][^<>{}]{1,90}?)(\s*)</g, (full, pre, text, post) => {
    const t = text.trim();
    if (!MAP[t]) return full;
    used.add(t); missed.delete(t);
    changes.push(['jsx', t]);
    return `>${pre}{t('${keyFor(t)}')}${post}<`;
});

// 2. Display props.
const PROPS = ['label', 'title', 'placeholder', 'message', 'description', 'header', 'subtitle', 'alt', 'confirmText', 'emptyMessage', 'helperText'];
for (const prop of PROPS) {
    const re = new RegExp(`\\b${prop}=(["'])([^"']{1,90})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([prop, text]);
        return `${prop}={t('${keyFor(text)}')}`;
    });
    // Also `{prop}="X"` inside objects: prop: 'X'
    const re2 = new RegExp(`\\b${prop}:\\s*(['"])([^'"]{1,90})\\1`, 'g');
    src = src.replace(re2, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([`${prop}:`, text]);
        return `${prop}: t('${keyFor(text)}')`;
    });
}

// 3. Toast and confirm calls — these are messages to the reader, always display.
for (const fn of ['toast.success', 'toast.error', 'toast', 'window.confirm', 'confirm']) {
    const re = new RegExp(`\\b${fn.replace('.', '\\.')}\\(\\s*(['"])([^'"]{2,200})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([fn, text]);
        return full.replace(`${q}${text}${q}`, `t('${keyFor(text)}')`);
    });
}

if (changes.length === 0) {
    console.log(`  tiada perubahan: ${file}`);
    process.exit(0);
}

// Add the hook where it is MISSING. This must be checked per component body, not per file: a
// file often has several small components, and one of them already using the hook said nothing
// about the others. Assuming otherwise produced `t` calls with no `t` in scope — caught by tsc.
/**
 * Inserts `const { t } = useTranslation();` into every component that uses `t` without one.
 *
 * THREE THINGS MADE THIS HARD, AND EACH IS HANDLED EXPLICITLY:
 *
 *  1. A file here holds many small components, each with its own scope, so the hook is decided
 *     COMPONENT BY COMPONENT. Assuming one hook per file produced `t` with no `t` in scope.
 *  2. The characters `{` and `}` appear in the type annotation as well as the body. In
 *     `React.FC<{ ... }> = (...) => {` the `}` closes the TYPE and cancels the `{` from the
 *     same line, so counting from the line start reads balance zero and gives up at once.
 *     Counting from the LAST `{` on the line starts inside the body, which is what is needed.
 *  3. Some screens have a CONCISE body — `=> (` with no block at all. A hook cannot live there,
 *     so the body is converted to `=> { ... return ( ... ); };` first.
 *
 * Anything it cannot do confidently is left alone rather than guessed at.
 */
function addHooks(fileSource) {
    let lines = fileSource.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Only a body opening ends this way. `=> {` may follow a long multi-line generic.
        const opensBlock = /(?:=>|\))\s*\{\s*$/.test(line.trim());
        const opensParen = /=>\s*\(\s*$/.test(line.trim());

        if (!opensBlock && !opensParen) { out.push(line); continue; }

        // Confirm a COMPONENT is being defined, by looking back for its name past any lines
        // that belong to a type annotation.
        let name = null;
        for (let k = i; k >= 0 && k > i - 30; k--) {
            const m = lines[k].match(/^(?:export\s+)?(?:const|function)\s+([A-Z]\w*)\b/);
            if (m) { name = m[1]; break; }
            if (/^(?:export\s+)?(?:const|function)\s+[a-z]/.test(lines[k].trim())) break;
        }
        if (!name) { out.push(line); continue; }

        // The body's extent, for the uses/has decision only. Count from the body's own brace.
        const from = opensBlock ? line.lastIndexOf('{') : line.length;
        let depth = 0, j = i, body = '';
        for (; j < lines.length; j++) {
            const chunk = j === i ? (opensBlock ? line.slice(from) : '') : lines[j];
            body += `${chunk}\n`;
            depth += (chunk.match(/\{/g) || []).length - (chunk.match(/\}/g) || []).length;
            if (opensBlock && depth <= 0) break;
            if (opensParen && (lines[j].trim() === ');' || lines[j].trim() === ')')) break;
        }

        const usesT = /(^|[^\w.$])t\(/.test(body);
        const hasT = /const\s*\{\s*t\s*\}\s*=\s*useTranslation/.test(body);
        if (!usesT || hasT) { out.push(line); continue; }

        if (opensBlock) {
            out.push(line);
            out.push('    const { t } = useTranslation();');
        } else {
            // Convert the concise body into a block body, then close it at the matching `);`.
            out.push(line.replace(/=>\s*\(\s*$/, '=> {\n    const { t } = useTranslation();\n    return ('));
            // Emit the body lines, replacing the terminating `);` with `);\n};`.
            for (let k = i + 1; k <= j; k++) {
                if (k === j) out.push(lines[k].replace(/^\s*\)\s*;?\s*$/, '    );\n};'));
                else out.push(lines[k]);
            }
            i = j;
        }
    }
    return out.join('\n');
}

if (!dry) {
    if (/^import .* from 'react';/m.test(src)) {
        if (!/react-i18next/.test(src)) {
            src = src.replace(/^(import .* from 'react';)/m, "$1\nimport { useTranslation } from 'react-i18next';");
        }
    } else if (!/react-i18next/.test(src)) {
        src = `import { useTranslation } from 'react-i18next';\n${src}`;
    }
}

src = addHooks(src);

// Put the protected regions back EXACTLY as they were. Anything matched inside them was never
// recorded as a change, so no key was created for it either.
src = src.replace(/__I18N_PROTECTED_(\d+)__/g, (_, n) => protected_[Number(n)]);

const out = { file, changes: changes.length, keys: Object.fromEntries(keys), unused: [...missed] };
if (dry) {
    console.log(JSON.stringify(out, null, 2));
} else {
    writeFileSync(file, src);

    // Write the keys into BOTH locale files. Skipping this was a real defect: the screen then
    // displayed `studentDashboard.yourFocus` to the reader, which is worse than English because
    // it means nothing at all. The Malay comes from the map; the English is the original text,
    // which is exactly right — the source strings were already English.
    if (keys.size) {
        for (const [localePath, isMalay] of [['lib/i18n/locales/ms.json', true], ['lib/i18n/locales/en.json', false]]) {
            const bundle = JSON.parse(readFileSync(localePath, 'utf8'));
            const group = NAMESPACE;
            bundle[group] = bundle[group] || {};
            for (const [english, fullKey] of keys) {
                const shortKey = fullKey.slice(group.length + 1);
                bundle[group][shortKey] = isMalay ? MAP[english] : english;
            }
            writeFileSync(localePath, `${JSON.stringify(bundle, null, 2)}\n`);
        }
    }
    console.log(`${file}: ${changes.length} diganti, ${keys.size} kunci ditulis, ${missed.size} tidak dijumpai`);
    if (missed.size) console.log('  tidak dijumpai:', [...missed].slice(0, 6));
}
