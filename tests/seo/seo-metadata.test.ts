/**
 * What the world sees before the app loads — SRIK.
 *
 * This file used to guard the SEO of a multi-tenant product sold to many
 * schools: a company homepage, a product page, a canonical URL on the vendor's
 * domain, an Open Graph card on that domain, a G2 review profile, and a
 * `SoftwareApplication` schema node. Every one of those assertions was then a
 * REASON NOT TO CHANGE THE PAGE. That is exactly what happened: `index.html`
 * still carried the vendor's name in 38 places long after the rest of the app had
 * been renamed, because fixing it would have failed this suite.
 *
 * SRIK is ONE school, so the questions are different. Not "does the company's
 * brand beat the product's in search?" but:
 *   - does the page say the school's name, in the school's language?
 *   - is the school's own phone number and address the one published?
 *   - is the app kept OUT of search engines? It is a private school system: a
 *     parent's marks and a family's fee balance must not appear in a search
 *     result, and nothing here should invite a crawler in.
 *   - is the page honest? No rating, no award, no customer count, because a
 *     school cannot substantiate those and should not have to.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const html = read('index.html');

/** The school, as it must appear. */
const SCHOOL_NAME = 'SRI Al-Khairiah';
const SCHOOL_FULL_NAME = 'Sekolah Rendah Islam Al-Khairiah';

/**
 * Names that must NEVER appear on a page a visitor sees.
 *
 * `Oliskey` is the company the codebase was originally written for; `Naira`
 * and `NGN` are its currency; `Paystack` is its payment provider. None of them
 * has anything to do with this school. Written as a list so a future rename can
 * extend it in one place.
 */
const FORBIDDEN = ['oliskey', 'paystack', 'flutterwave', 'naira', 'ngn'];

describe('index.html says the school\u2019s name, and only the school\u2019s', () => {
    it('THE RULE: the vendor\u2019s name appears nowhere on the page', () => {
        const lower = html.toLowerCase();
        const found = FORBIDDEN.filter((term) => lower.includes(term));
        expect(found, `the page still names a company that is not this school: ${found.join(', ')}`).toEqual([]);
    });

    it('has exactly one title, and it is the school', () => {
        const titles = html.match(/<title>([\s\S]*?)<\/title>/g) ?? [];
        expect(titles.length, 'there must be exactly one <title>').toBe(1);
        const title = titles[0].replace(/<\/?title>/g, '').trim();
        expect(title).toContain(SCHOOL_NAME);
        expect(title.length, 'title is too long for a search result').toBeLessThanOrEqual(70);
        expect(title).not.toMatch(/^(React App|Vite App|Dashboard|School App)$/i);
    });

    it('declares Malay as the document language', () => {
        // Every word the user reads is Malay. Declaring English makes a screen
        // reader pronounce Malay with English phonetics, and tells a browser to
        // offer translation into a language the page is already written in.
        expect(html).toMatch(/<html[^>]+lang="ms"/);
    });

    it('has exactly one meta description of a sensible length', () => {
        const descs = [...html.matchAll(/<meta\s+name="description"[\s\S]*?content="([\s\S]*?)"/g)];
        expect(descs.length, 'duplicate meta descriptions confuse search engines').toBe(1);
        const d = descs[0][1].trim();
        expect(d.length).toBeGreaterThan(60);
        expect(d.length).toBeLessThanOrEqual(320);
    });

    it('THE RULE: the app is not offered up to search engines', () => {
        // Marks, attendance and fee balances live behind this page. Nothing here
        // should invite a crawler in, and there must be no canonical URL pointing
        // at a domain this school does not own.
        expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/);
        expect(html, 'a canonical URL would name a domain that is not the school\u2019s').not.toMatch(/rel="canonical"/);
    });

    it('asks for no third-party script it does not use', () => {
        // Google's identity script was loaded for a sign-in method this school
        // does not offer — every visitor fetched it for nothing.
        expect(html).not.toContain('accounts.google.com');
    });

    it('carries the share-preview tags, in the school\u2019s language', () => {
        expect(html).toMatch(/property="og:title"/);
        expect(html).toMatch(/property="og:description"/);
        expect(html).toMatch(/property="og:image"/);
        expect(html).toContain('og:site_name');
        expect(html, 'the share locale must be Malaysian Malay').toContain('ms_MY');
        expect(html).not.toContain('en_NG');
    });

    it('points every share image at a file that exists', () => {
        const images = [...html.matchAll(/(?:og:image|twitter:image)"\s+content="([^"]+)"/g)]
            .map((m) => m[1]);
        expect(images.length).toBeGreaterThan(0);
        for (const src of images) {
            // Local only: an external image could change or vanish without this
            // school knowing, and a broken card looks careless when shared.
            expect(src.startsWith('http'), `share image should be local, got ${src}`).toBe(false);
            expect(existsSync(join(root, 'public', src.replace(/^\//, ''))), `missing share image: ${src}`).toBe(true);
        }
    });

    it('names the installed app in the school\u2019s short form', () => {
        expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="SRIK"/);
    });
});

describe('structured data', () => {
    const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => m[1].trim());

    it('has exactly one JSON-LD block and it parses', () => {
        expect(blocks.length).toBe(1);
        expect(() => JSON.parse(blocks[0])).not.toThrow();
    });

    it('THE RULE: describes a school, not a software company', () => {
        const node = JSON.parse(blocks[0]);
        expect(node['@type']).toBe('School');
        expect(node.name).toBe(SCHOOL_FULL_NAME);
        // There is no company behind this app other than the school itself, so
        // there is no second entity to link to and no vendor domain to claim.
        expect(JSON.stringify(node)).not.toMatch(/oliskey/i);
    });

    it('publishes the school\u2019s real telephone and address, and no other', () => {
        const node = JSON.parse(blocks[0]);
        expect(node.telephone).toBe('+60105119582');
        expect(node.address.addressCountry).toBe('MY');
        expect(node.address.addressRegion).toBe('Kedah');
        expect(node.address.postalCode).toBe('06300');
        expect(node.address.addressLocality).toBe('Kuala Nerang');
    });

    it('THE RULE: claims nothing that cannot be verified', () => {
        // A school cannot substantiate a rating, a review count or a customer
        // number, and asserting one in structured data would be a claim nobody
        // can stand behind.
        const json = JSON.parse(blocks[0]);
        const banned = ['aggregateRating', 'ratingValue', 'reviewCount', 'award', 'sameAs', 'isAccessibleForFree'];
        for (const field of banned) {
            expect(json[field], `${field} is a claim this school cannot substantiate`).toBeUndefined();
        }
    });
});

describe('unverified marketing claims', () => {
    it('no superlative or rating language appears in the page metadata', () => {
        const meta = [...html.matchAll(/<meta[^>]+content="([^"]*)"/g)].map((m) => m[1]).join(' ');
        expect(meta).not.toMatch(/\b(best|#1|number one|leading|award-winning|top-rated|most trusted)\b/i);
    });
});

describe('robots.txt and sitemap.xml', () => {
    it('THE RULE: robots.txt keeps the whole application private', () => {
        const robots = read('public/robots.txt');
        // A school system is not a public website. Everything is disallowed; the
        // entry screen is reached by the people who were given the address.
        expect(robots).toMatch(/User-agent:\s*\*/i);
        expect(robots).toMatch(/Disallow:\s*\/\s*$/m);
        expect(robots, 'robots.txt still points at a domain this school does not own').not.toMatch(/oliskey/i);
    });

    it('THE RULE: nothing is submitted to search engines', () => {
        // A sitemap is an invitation to crawl. This app does not extend one, so
        // neither the sitemap nor a link to it should exist.
        expect(html).not.toMatch(/Sitemap:/i);
        const robots = read('public/robots.txt');
        expect(robots, 'a Sitemap line invites crawlers into a private system').not.toMatch(/Sitemap:/i);
        expect(existsSync(join(root, 'public', 'sitemap.xml')), 'sitemap.xml should not exist for a private app').toBe(false);
    });
});

describe('PWA manifest', () => {
    const manifest = JSON.parse(read('public/manifest.json'));

    it('names the school, not a vendor', () => {
        expect(manifest.name).toBe(SCHOOL_NAME);
        expect(manifest.short_name).toBe('SRIK');
        expect(manifest.lang).toBe('ms-MY');
        expect(JSON.stringify(manifest)).not.toMatch(/oliskey/i);
    });

    it('starts in scope and every declared icon file exists', () => {
        expect(manifest.start_url).toBe('/');
        expect(manifest.scope).toBe('/');
        for (const icon of manifest.icons ?? []) {
            expect(existsSync(join(root, 'public', icon.src.replace(/^\//, ''))), `missing icon ${icon.src}`).toBe(true);
        }
    });
});

describe('README', () => {
    it('names the school it is for', () => {
        const readme = read('README.md');
        expect(readme).toMatch(/SRI Al-Khairiah|SRIK/);
    });
});
