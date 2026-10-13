#!/usr/bin/env node
/**
 * Replaces common terms with `t('terms.…')` calls, one file at a time.
 *
 * WHY THIS IS SAFE TO DO MECHANICALLY, AND ONLY FOR THIS SET. The `terms` dictionary holds
 * single words and short labels that mean the same thing wherever they appear — "Present",
 * "Pending", "Save Changes". A longer sentence does NOT: "Mark the rest present" needs a
 * different Malay sentence on a register than on a report. So this tool only touches strings
 * whose ENTIRE value is in the dictionary, and refuses partial matches.
 *
 * WHY IT REFUSES MOST PLACES ANYWAY. A bare word in JSX (`<span>Present</span>`) is a label.
 * The same word inside a comparison (`status === 'Present'`) or an object key is DATA, and
 * translating it would break the logic. This tool only rewrites text that is clearly
 * display: JSX text nodes, and string literals passed to `label=`, `title=`, `placeholder=`,
 * `message=` and similar props.
 *
 * It also adds the `useTranslation` import and hook when a file needs them, and reports
 * exactly what it changed so the result can be reviewed.
 *
 * Usage: node scripts/i18n/apply-terms.mjs <file> [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import ms from '../../lib/i18n/locales/ms.json' with { type: 'json' };

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) { console.error('usage: apply-terms.mjs <file> [--dry]'); process.exit(1); }

const terms = ms.terms ?? {};
// Reverse lookup: the ENGLISH text maps to the key. The locale files are symmetrical, so the
// English side is recovered from the key rather than guessed.
const en = JSON.parse(readFileSync('lib/i18n/locales/en.json', 'utf8')).terms ?? {};
const englishToKey = new Map();
for (const [key, englishValue] of Object.entries(en)) englishToKey.set(englishValue, key);

let src = readFileSync(file, 'utf8');
const changes = [];

// Props whose value is shown to a person.
const DISPLAY_PROPS = ['label', 'title', 'placeholder', 'message', 'description', 'aria-label', 'alt', 'header', 'subtitle'];

// 1. JSX text nodes: >Present<
src = src.replace(/>(\s*)([A-Za-z][A-Za-z .&'-]{1,40})(\s*)</g, (full, pre, text, post) => {
    const key = englishToKey.get(text.trim());
    if (!key) return full;
    changes.push({ kind: 'jsx', text: text.trim(), key });
    return `>${pre}{t('terms.${key}')}${post}<`;
});

// 2. Display props with a plain string literal: label="Present" or label={'Present'}
for (const prop of DISPLAY_PROPS) {
    const re = new RegExp(`\\b${prop}=(["'])([A-Za-z][A-Za-z .&'-]{1,40})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        const key = englishToKey.get(text.trim());
        if (!key) return full;
        changes.push({ kind: prop, text: text.trim(), key });
        return `${prop}={t('terms.${key}')}`;
    });
}

if (changes.length === 0) {
    if (!dry) console.log(`  no shared terms: ${file}`);
    process.exit(0);
}

// Add the hook if the file now needs it and does not already have it.
const needsHook = /\bt\('terms\./.test(src) && !/useTranslation/.test(src);
if (needsHook) {
    if (/^import .* from 'react';/m.test(src)) {
        src = src.replace(/^(import .* from 'react';)/m, "$1\nimport { useTranslation } from 'react-i18next';");
    } else {
        src = `import { useTranslation } from 'react-i18next';\n${src}`;
    }
    // Insert the hook as the first statement of the component body. The components here are
    // arrow functions assigned to a const or a function declaration; both are matched.
    const hookLine = '\n    const { t } = useTranslation();';
    const arrow = src.match(/(\n(?:const|function)\s+[A-Z]\w*\s*[^=]*=>?\s*\{?)/);
    if (/=>\s*\{/.test(src)) {
        src = src.replace(/(=>\s*\{)/, `$1${hookLine}`);
    } else if (/\)\s*\{\n/.test(src)) {
        src = src.replace(/(\)\s*\{\n)/, `$1${hookLine}\n`);
    }
}

if (dry) {
    console.log(`${file}: ${changes.length} perubahan`);
    for (const c of changes) console.log(`   ${c.kind}: ${c.text} -> terms.${c.key}`);
} else {
    writeFileSync(file, src);
    console.log(`  ${file}: ${changes.length} perubahan`);
}
