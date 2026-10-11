import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

/**
 * GUARD: the test suite must pass with NO `.env` file, because that is what CI has.
 *
 * THE FAILURE THIS PREVENTS, and it happened. `.env` is gitignored, so CI has none.
 * Locally every test passed, and on the runner the suite failed — a green local run is
 * not evidence about the runner unless the two are actually the same. I only found it
 * by moving `.env` aside and running the suite again, which is the check this file
 * automates for the specific way it went wrong.
 *
 * WHAT WENT WRONG. A screen's data load reached Supabase. `requireSupabase()` throws
 * when the client is not configured — correctly, since a screen cannot read a database
 * with no connection — and the screen had no mock for that module, so the real one ran.
 *
 * The rule is not "never touch Supabase in a test". It is: A TEST THAT RENDERS A SCREEN
 * WHICH READS THE DATABASE MUST MOCK THAT READ, or it will be testing whether `.env`
 * exists.
 */

const ROOT = process.cwd();

function testFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            testFiles(p, out);
        } else if (/\.(test|spec)\.tsx?$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

/** Every module that reaches for the database client at import time. */
const DATA_MODULES = [
    'family',
    'attendance',
    'academics',
    'assessments',
    'announcements',
    'students',
    'teachers',
    'finance',
    'stats',
    'timetable',
    'staffAttendance',
    'preferences',
    'roles',
];

describe('the suite runs with no .env, as CI does', () => {
    it('every test that renders a screen reading the database mocks that read', () => {
        const offenders: string[] = [];

        for (const file of testFiles(ROOT)) {
            const src = readFileSync(file, 'utf8');

            // Does this test RENDER a component? (a pure unit test cannot trip this)
            if (!/from ['"]@testing-library\/react['"]/.test(src)) continue;

            const mocks = new Set(
                [...src.matchAll(/vi\.mock\(\s*['"][^'"]*\/lib\/supabase\/(\w+)['"]/g)]
                    .map(m => m[1]),
            );
            // WHICH data modules does this test REACH? Not the ones it imports — the
            // ones the COMPONENT it renders imports. The first version of this check
            // only looked at the test file's own imports, and a test file imports no
            // data module at all: it imports a SCREEN. So the check could never fail.
            // Deleting a mock from a real test passed it, which is how this was found.
            const rendered = new Set(
                [...src.matchAll(/from\s+['"]([^'"]*\/[A-Z]\w+)['"]/g)].map(m => m[1]),
            );

            const needed = new Set<string>();
            for (const spec of rendered) {
                // Resolve RELATIVE TO THE TEST FILE, which is what a relative import
                // means. Resolving from the repo root turned '../../../ParentDashboard'
                // into '/ParentDashboard.tsx', which never exists — so this check found
                // no component, required no mock, and passed on a deleted mock.
                const base = spec.startsWith('.') ? join(dirname(file), spec) : join(ROOT, spec);
                const guess = [`${base}.tsx`, `${base}.ts`]
                    .find(p => { try { return statSync(p).isFile(); } catch { return false; } });
                if (!guess) continue;

                const compSrc = readFileSync(guess, 'utf8');
                for (const m of compSrc.matchAll(/from\s+['"][^'"]*\/lib\/supabase\/(\w+)['"]/g)) {
                    needed.add(m[1]);
                }
            }

            for (const mod of needed) {
                if (!DATA_MODULES.includes(mod)) continue;
                if (!mocks.has(mod)) {
                    offenders.push(`${file.replace(ROOT + '/', '')} renders a screen that uses supabase/${mod}.ts, and does not mock it`);
                }
            }
        }

        expect(
            offenders,
            'these tests will fail on CI, which has no .env:\n' + offenders.join('\n'),
        ).toEqual([]);
    });

    it('the guard can actually see tests and data modules', () => {
        // A guard whose file walk finds nothing passes while checking nothing.
        const files = testFiles(ROOT);
        expect(files.length, 'no test files were found').toBeGreaterThan(20);
        expect(DATA_MODULES.length).toBeGreaterThan(8);
    });
});
