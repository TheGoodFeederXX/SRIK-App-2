/**
 * Numbers shown to schools must come from the database, never from Math.random.
 *
 * Found in production code: components/proprietor/CurriculumToggle.tsx rendered
 *
 *     averagePerformance: Math.random() * 30 + 70   // "Mock for now"
 *
 * as an "Avg Performance" percentage on a school owner's dashboard — a
 * fabricated figure between 70% and 100%, with a progress bar, indistinguishable
 * from a real one. A school could have made decisions on it.
 *
 * Random values are legitimate in plenty of places (games, animations, client
 * ids, retry jitter), so this does not ban Math.random. It bans Math.random
 * flowing into a field whose NAME claims it is a measurement.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

/** Product code only: games and tests legitimately randomise. */
const SEARCH_DIRS = ['components', 'lib', 'services'];
const SKIP_DIR = /[\\/](games|adventure|node_modules|__tests__|dist)[\\/]/;

/** Field names that assert a real measurement to a user. */
const STAT_FIELD = new RegExp(
    '\\b(' + [
        'average\\w*', 'avg\\w*', '\\w*performance', '\\w*score', '\\w*rate',
        '\\w*percentage', '\\w*percent', 'total\\w*', '\\w*count', '\\w*revenue',
        '\\w*balance', '\\w*attendance', '\\w*enrolled', '\\w*outstanding',
        '\\w*expenses', '\\w*profit', '\\w*growth',
    ].join('|') + ')\\s*[:=]\\s*[^;,\\n]*Math\\.random', 'i');

function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (SKIP_DIR.test(p + '/')) continue;
        if (statSync(p).isDirectory()) out = out.concat(walk(p));
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
    }
    return out;
}

describe('no fabricated statistics in product code', () => {
    it('no displayed metric is generated with Math.random', () => {
        const offenders: string[] = [];
        for (const dir of SEARCH_DIRS) {
            for (const file of walk(join(root, dir))) {
                readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                    if (line.trim().startsWith('*') || line.trim().startsWith('//')) return; // comments
                    if (STAT_FIELD.test(line)) {
                        offenders.push(`${file.replace(root, '').replace(/\\/g, '/')}:${i + 1}  ${line.trim().slice(0, 100)}`);
                    }
                });
            }
        }
        expect(offenders, `fabricated statistics rendered to users:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('the curriculum performance figure is not invented', () => {
        // The screen that produced this figure has been DELETED, along with the
        // rest of the vendor's proprietor console — `PROPRIETOR` is not a role in
        // this school, so the screen was unreachable and the fabricated number
        // could never reach anyone. The guard changes from "the file states null"
        // to "the file is gone", which is the stronger claim: an absent file
        // cannot fabricate anything, and a reinstated one fails this test.
        const file = join(root, 'components', 'proprietor', 'CurriculumToggle.tsx');
        expect(existsSync(file), 'the vendor console returned — check what it renders').toBe(false);
    });

    it('THE RULE: no screen derives a measurement from Math.random', () => {
        // The original bug: a dashboard showed `Math.random() * 30 + 70` as an
        // "Avg Performance" percentage, with a progress bar, indistinguishable
        // from a real figure. The first test above scans for the same pattern;
        // this one states the rule in the words a reviewer would search for.
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'].includes(name)) continue;
                const full = join(dir, name);
                if (statSync(full).isDirectory()) walk(full);
                else if (/\.tsx?$/.test(name)) {
                    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                        // A random value assigned to something NAMED as a measurement.
                        if (/(performance|average|score|grade|percentage|rate|accuracy)\s*[:=]\s*[^;]*Math\.random/i.test(line)) {
                            offenders.push(`${full.replace(root + '/', '')}:${i + 1}: ${line.trim().slice(0, 90)}`);
                        }
                    });
                }
            }
        };
        walk(join(root, 'components'));
        walk(join(root, 'src'));
        walk(join(root, 'lib'));
        expect(offenders, `fabricated measurement:\n${offenders.join('\n')}`).toEqual([]);
    });
});
