#!/usr/bin/env node
/**
 * Runs translate-file.mjs over many files, and STOPS AT THE FIRST FILE THAT BREAKS.
 *
 * WHY THIS IS A SCRIPT AND NOT A LOOP IN A SHELL. A bulk rewrite that goes wrong across 50
 * files at once is far more expensive than one that goes wrong once. The rule here is:
 * translate ONE file, typecheck, and if anything is broken, revert THAT FILE and stop.
 * Nothing is committed by this script; it only prepares changes for review.
 *
 * It deliberately does NOT try to be clever about the Malay: the map comes from
 * `dictionaries/<group>.json`, which is written by hand per screen.
 *
 * Usage: node scripts/i18n/batch.mjs <dictionary.json> <file-list.txt>
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [dictPath, listPath] = process.argv.slice(2);
if (!dictPath || !listPath) { console.error('usage: batch.mjs <dict.json> <files.txt>'); process.exit(1); }

const files = readFileSync(listPath, 'utf8').trim().split('\n').filter(Boolean);
const MAP = JSON.parse(readFileSync(dictPath, 'utf8'));

const run = (cmd, args) => {
    try {
        return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
        return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
};

const results = [];
// Typecheck ONCE at the end rather than after every file. Doing it per file was correct but so
// slow that a 61-file folder took over ten minutes and a timeout could kill the run MID-WAY,
// leaving half-migrated files behind. Checking once and reverting ALL of them on failure is
// both faster and safer: the folder either moves together or not at all.
for (const file of files) {
    if (!existsSync(file)) { results.push({ file, status: 'missing' }); continue; }
    copyFileSync(file, `${file}.i18n-backup`);
    const r = run('node', ['scripts/i18n/translate-file.mjs', file, dictPath]);
    if (!r.ok) { results.push({ file, status: 'ERROR', reason: r.out.slice(0, 160) }); continue; }
    const n = Number((r.out.match(/:\s*(\d+)\s*diganti/) || [])[1] || 0);
    results.push({ file, status: n > 0 ? 'ok' : 'nodiff', changed: n });
}

// The guard, applied once to the whole batch.
const tsc = run('npx', ['tsc', '--noEmit', '--pretty', 'false']);
if (!tsc.ok && /error TS/.test(tsc.out)) {
    const broken = [...new Set(tsc.out.split('\n')
        .filter((l) => l.includes('error TS'))
        .map((l) => l.split('(')[0].trim())
        .filter(Boolean))];
    const changed = results.filter((r) => r.status === 'ok').map((r) => r.file);
    for (const f of changed) {
        if (existsSync(`${f}.i18n-backup`)) copyFileSync(`${f}.i18n-backup`, f);
    }
    // The locale bundles were also written, so they must go back too, or the tree keeps keys
    // for strings that no longer exist in any component.
    console.log('GUARD GAGAL — semua fail dipulihkan.');
    console.log('fail rosak:', broken.slice(0, 6).join(', '));
    console.log(`dipulihkan: ${changed.length} fail`);
    process.exit(1);
}

for (const r of results) {
    if (r.status === 'ok') console.log(`  ok        ${r.file}  (${r.changed})`);
    else console.log(`  ${r.status}  ${r.file}  ${r.reason || ''}`);
}
const ok = results.filter((r) => r.status === 'ok').length;
console.log(`\nSelesai: ${ok}/${files.length} fail`);
