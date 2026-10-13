#!/usr/bin/env node
/**
 * Finds which component files a running app can actually reach.
 *
 * WHY THIS IS NOT A SIMPLE IMPORT SCAN. The obvious approach — follow `import` statements
 * from the entry point — MISSES THE MAIN PATTERN THIS CODEBASE USES. Nearly every screen is
 * loaded with `lazyWithRetry(() => import('./Foo'))`, so the path appears inside a call
 * expression rather than in an `import ... from` clause. A scanner that only reads `from`
 * clauses reported 246 files as "unused", including `AddStudentScreen` — which is reached
 * from two dashboards. Translating 246 dead files is wasted effort; skipping live ones leaves
 * English in front of a teacher. Getting this wrong in either direction is costly, so the
 * scan reads BOTH forms.
 *
 * Usage: node scripts/i18n/reachability.mjs [--json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ROOTS = ['App.tsx', 'index.tsx', 'src/main.tsx'];

/** Every relative module path a file refers to, in any of the forms used here. */
function referencedPaths(src) {
    const out = new Set();
    // 1. Static: import x from './y'
    for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) out.add(m[1]);
    // 2. Dynamically lazy: lazyWithRetry(() => import('./y')) / React.lazy(() => import('./y'))
    for (const m of src.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.add(m[1]);
    // 3. Bare side-effect imports: import './y'
    for (const m of src.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g)) out.add(m[1]);
    return [...out];
}

function resolveModule(fromFile, spec) {
    const base = normalize(join(dirname(fromFile), spec));
    const candidates = [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')];
    return candidates.find((c) => existsSync(c) && !c.includes('node_modules'));
}

// Walk from the entry points.
const seen = new Set();
const queue = ROOTS.filter(existsSync);
if (queue.length === 0) {
    console.error('No entry point found (App.tsx / index.tsx / src/main.tsx).');
    process.exit(1);
}
while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const spec of referencedPaths(src)) {
        const target = resolveModule(file, spec);
        if (target && !seen.has(target)) queue.push(target);
    }
}

const sorted = [...seen].sort();
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(sorted, null, 2));
} else {
    console.log(`Reachable files: ${sorted.length}`);
    console.log(`Of which components/: ${sorted.filter((f) => f.startsWith('components/')).length}`);
}
