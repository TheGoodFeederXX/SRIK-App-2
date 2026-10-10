/**
 * A leak detector for the company this app was originally built for.
 *
 * This file exists because the previous cleanup was done file by file, by hand,
 * and it MISSED the most visible file in the whole app. `index.html` still said
 * "Oliskey School App" in 38 places long after every screen had been renamed —
 * including the browser tab, the search-result title and every WhatsApp link
 * preview a parent would see. Worse, the SEO test then *asserted* that name, so
 * fixing it would have failed the suite. A check that names the forbidden words
 * once, and scans the shipped surface, catches the next one automatically.
 *
 * It scans only code a user can reach — components, entry HTML, app source,
 * public assets and data modules — not documentation. Several documents
 * deliberately record that the source project was Oliskey, and rewriting history
 * there would lose the explanation for why this codebase looks the way it does.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const root = join(__dirname, '..', '..');

/**
 * Names that must not appear in shipped code.
 *
 * `Oliskey` is the vendor; `Paystack` and `Flutterwave` are its payment
 * providers; `Naira`/`NGN` are its currency. SRIK uses none of them.
 */
const FORBIDDEN = [
    // The vendor's own name, which was on every screen.
    /\boliskey\b/i,
    // Payment providers this school does not use.
    /\bpaystack\b/i,
    /\bflutterwave\b/i,
    // Currency that is not the ringgit.
    /₦/,
    /\bnaira\b/i,
    // THE COUNTRY THE PRODUCT CAME FROM. This is not a branding leak like the
    // others — it is a correctness bug, because a school's country decides its
    // currency, its calendar, its timezone and its curriculum. The scan found
    // Nigerian crons running seven hours late, a school year on the wrong half
    // of the calendar, four grade scales, and a national flag rendered on a
    // Malaysian teacher's profile. All of those were reachable from the words
    // below, so the words are banned.
    /\bnigeri(a|an)\b/i,
    // The flag, which is harder to notice in a diff than a word.
    /🇳🇬/,
    // States and the teachers' registration council.
    /\blagos\b/i,
    /\b(abuja|kano|ibadan)\b/i,
    /\btrcn\b/i,
    // ANOTHER COUNTRY'S LAW. This was the Nigerian Data Protection Regulation;
    // Malaysia's is the Personal Data Protection Act 2010. They are different
    // statutes with different duties, so naming the wrong one on a consent form
    // tells the office it is complying when it is not.
    /\bndpr\b/i,
    // FOREIGN EXAMINATION BOARDS. WAEC, NECO and JAMB are West African; a
    // Malaysian pupil sits UPSR-style school assessment. A dropdown offering
    // these is a dropdown with no correct answer.
    /\b(waec|neco|jamb|bece|wasce|wassce)\b/i,
];

/** Directories that are shipped code, and therefore must be clean. */
/**
 * Every tree that ships or serves code a person can reach.
 *
 * `backend` was MISSING from this list, and that omission is the whole reason
 * most of the vendor leaks survived a first pass that claimed to be finished.
 * The frontend was scanned; the backend was not — and the backend is where the
 * worst of them were: emails sent to real parents from a vendor's domain,
 * password-reset links pointing at a website the school does not own, a Naira
 * amount read aloud by the AI assistant, a school year on the wrong calendar,
 * and a security script checking for a database role that does not exist.
 *
 * A scan list is part of the guard. Leaving a tree out of it does not cause a
 * false positive; it causes silence.
 */
const ROOTS = [
    'components', 'src', 'public', 'hooks', 'context', 'utils', 'lib', 'services',
    // The Express backend. Still present during the staged migration to Supabase,
    // and still sending mail and running scheduled work.
    'backend/src',
];

/** Files scanned individually at the repository root. */
const ROOT_FILES = ['index.html', 'metadata.json', 'public/manifest.json'];

const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', '.git', 'coverage', '__tests__', '__mocks__',
    // Backend integration tests intentionally exercise the legacy multi-tenant
    // ("branch") model and are scheduled for removal with it. They are not
    // shipped and cannot reach a user, so they are out of scope for this guard.
    'tests',
]);
const SKIP_EXT = new Set(['.map', '.min.js', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.zip', '.pdf']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.json', '.css']);

/**
 * Files allowed to mention the old name.
 *
 * Each entry has a reason, and that reason is the point: it forces a human to
 * say WHY this mention is acceptable, so an accidental one cannot hide here.
 */
const ALLOWED = new Map<string, string>([
    // ── What is left of the vendor layer, and why ─────────────────────────────
    //
    // The owner decided to DELETE the vendor billing feature rather than keep it
    // listed, so the eight screens, the whole `saas/` console, the proprietor and
    // alumni modules, the backend subscription/payment-gateway services and the
    // AI paywall are all gone. What remains below is the small residue: an unused
    // picker of currencies, the legacy API client that still names a gateway in a
    // parameter, and one stored cookie key.
    //
    // Each entry must name a file that EXISTS — a stale entry here would hide the
    // next real leak behind a reason nobody can check. The test below enforces it.
    ['lib/paymentGateways.ts', 'unused currency picker; still reachable from legacy settings screens'],
    ['lib/api.ts', 'legacy API client; a gateway name survives only as a parameter, no live calls'],
    // NOT vendor code: the CSRF session cookie key, where the vendor name is a
    // STORED identifier. Renaming it would invalidate every session already open
    // and sign every signed-in user out mid-work. It is never shown to anyone.
    ['backend/src/middleware/csrf.middleware.ts', 'stored session cookie key; renaming signs everyone out'],
]);

function walk(dir: string, hits: string[], seen: Set<string>) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }

        if (st.isDirectory()) { walk(full, hits, seen); continue; }

        const ext = name.slice(name.lastIndexOf('.'));
        if (SKIP_EXT.has(ext) || !CODE_EXT.has(ext)) continue;

        const rel = relative(root, full);
        if (ALLOWED.has(rel)) continue;
        if (seen.has(rel)) continue;
        seen.add(rel);

        let text: string;
        try { text = readFileSync(full, 'utf8'); } catch { continue; }

        const lines = text.split('\n');
        lines.forEach((line, i) => {
            // A comment may explain the history; it cannot leak to a user.
            //
            // THIS ONLY SKIPS A LINE THAT *STARTS* AS A COMMENT, and that is
            // deliberate. Stripping comments from the middle of a line would
            // mean writing a JSX-aware parser here, and getting it subtly wrong
            // would HIDE a real leak rather than report a false one. The failure
            // mode of being strict is an annoying failure; the failure mode of
            // being clever is a silent one. So `</div>{/* ... */}` is still
            // reported, and the fix is to put the comment on its own line.
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//')
                || trimmed.startsWith('/*') || trimmed.startsWith('{/*')) return;

            for (const pattern of FORBIDDEN) {
                if (pattern.test(line)) {
                    hits.push(`${rel}:${i + 1}: ${trimmed.slice(0, 150)}`);
                }
            }
        });
    }
}

describe('no legacy branding reaches a user', () => {
    it('THE RULE: no shipped file names the old vendor, its currency or its providers', () => {
        const hits: string[] = [];
        const seen = new Set<string>();

        for (const dir of ROOTS) walk(join(root, dir), hits, seen);
        for (const f of ROOT_FILES) {
            let text: string;
            try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
            text.split('\n').forEach((line, i) => {
                // Same rule as above: a line that STARTS as a comment only.
                const trimmed = line.trim();
                if (trimmed.startsWith('*') || trimmed.startsWith('//')
                    || trimmed.startsWith('/*') || trimmed.startsWith('{/*')) return;
                for (const pattern of FORBIDDEN) {
                    if (pattern.test(line)) hits.push(`${f}:${i + 1}: ${trimmed.slice(0, 150)}`);
                }
            });
        }

        expect(hits, `legacy branding found in shipped code:\n${hits.join('\n')}`).toEqual([]);
    });

    it('THE RULE: every allowed file still exists', () => {
        // A stale entry is worse than no entry: it states a reason for a file
        // nobody can open, and it silently pre-authorises that PATH if the file
        // is ever recreated. Fourteen entries pointed at deleted files until this
        // check was added.
        const missing = [...ALLOWED.keys()].filter(rel => !existsSync(join(root, rel)));
        expect(missing, `allowed entries pointing at files that do not exist:\n${missing.join('\n')}`).toEqual([]);
    });

    it('THE RULE: every allowed exception states its reason', () => {
        // An allowlist entry without a justification is how a leak gets hidden.
        for (const [file, reason] of ALLOWED) {
            expect(reason.length, `no reason given for allowing ${file}`).toBeGreaterThan(10);
        }
    });
});
