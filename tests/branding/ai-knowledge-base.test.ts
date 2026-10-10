/**
 * The knowledge base the in-app assistant answers from.
 *
 * WHY THIS IS TESTED AND NOT JUST WRITTEN. The assistant's answers come from a
 * document, so a wrong document produces confidently wrong answers in front of
 * parents — which is worse than no assistant, because a person cannot tell the
 * difference between the school's rule and a plausible invention.
 *
 * The document it used to read described a DIFFERENT PRODUCT: eleven roles
 * (SRIK has three), school branches (SRIK has none), paying fees online through
 * a payment provider (SRIK parents pay at the office), and a company tagline.
 * A parent asking "how do I pay?" would have been told to pay through the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const root = join(__dirname, '..', '..');
const KB_PATH = join(root, 'docs', 'SRIK_AI_KNOWLEDGE_BASE.md');
const kb = () => readFileSync(KB_PATH, 'utf8');

/** Patterns that mean the document describes the product this code came from. */
const FOREIGN = [
  /\boliskey\b/i,
  /₦/,
  /\bnaira\b/i,
  /\bnigeri(a|an)\b/i,
  /\bpaystack\b/i,
  /\bflutterwave\b/i,
  /\b(waec|neco|jamb|bece|wassce)\b/i,
  /\btrcn\b/i,
  /\bndpr\b/i,
  /\blagos\b/i,
];

describe('the assistant\u2019s knowledge base describes THIS school', () => {
  it('THE RULE: the document exists where the service looks for it', () => {
    // The service reads docs/SRIK_AI_KNOWLEDGE_BASE.md from two possible roots.
    // A renamed file it cannot find means the assistant silently loses all
    // product knowledge and admits it knows nothing — a quiet failure.
    expect(existsSync(KB_PATH), `missing ${KB_PATH}`).toBe(true);
  });

  it('THE RULE: the old document is gone, so it cannot be read by accident', () => {
    expect(existsSync(join(root, 'docs', 'OLISKEY_AI_KNOWLEDGE_BASE.md'))).toBe(false);
  });

  it('THE RULE: no section describes another company or country', () => {
    const hits: string[] = [];
    kb().split('\n').forEach((line, i) => {
      for (const pattern of FOREIGN) {
        if (pattern.test(line)) hits.push(`line ${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
    expect(hits, `foreign content in the knowledge base:\n${hits.join('\n')}`).toEqual([]);
  });

  it('THE RULE: the service\u2019s always-include headings exist', () => {
    // These two are named in aiKnowledge.service.ts. If a heading is renamed
    // without the service, retrieval silently stops including it.
    const text = kb();
    expect(text).toContain('## What this app is');
    expect(text).toContain("## The assistant's limits");
  });

  it('THE RULE: every heading the service asks for exists in the document', () => {
    const service = readFileSync(
      join(root, 'backend', 'src', 'services', 'aiKnowledge.service.ts'), 'utf8'
    );
    const headings = [...kb().matchAll(/^## (.+)$/gm)].map(m => m[1].trim());

    // ONLY the section-name lists are inspected: ALWAYS_INCLUDE and ROLE_HINTS.
    // A blanket scan of every quoted string in the file matched unrelated
    // literals such as 'USER ROLE' and 'SCHOOL: ...' and reported them as
    // missing sections, which is a test bug rather than a document bug.
    const arrays = [
      ...service.matchAll(/ALWAYS_INCLUDE\s*=\s*\[([^\]]*)\]/g),
      ...service.matchAll(/ROLE_HINTS[\s\S]*?=\s*\{([\s\S]*?)\n\};/g),
    ].map(m => m[1]).join('\n');

    // Normalise the typographic apostrophe to a plain one first, then split on
    // quotes. A `'([^']+)'` pattern cut `The assistant's limits` into
    // `The assistant` and `s limits` — the same class of bug this guard exists
    // to catch, committed by the guard itself.
    // `arrays` holds the ROLE_HINTS body and the ALWAYS_INCLUDE list, joined.
    // The typographic apostrophe is normalised first so that the real heading
    // `The assistant's limits` is read as one name.
    const NORMALISED = arrays.replace(/\u2019/g, "'");

    // Take the contents of each `[...]` list, then split it on commas. Splitting
    // on commas rather than quotes means an apostrophe inside a name cannot
    // break the parse.
    const names = [...NORMALISED.matchAll(/\[([^\[\]]*)\]/g)]
      .flatMap(m => m[1].split(','))
      .map(part => part.replace(/["']/g, '').trim())
      .filter(n => n.length > 0 && n.includes(' ') && /^[A-Z]/.test(n) && !n.includes('.'));

    expect(names.length, 'found no section names to check — the guard is blind').toBeGreaterThan(3);
    const missing = names.filter(n => !headings.includes(n));
    expect(missing, `section names the service asks for but the document lacks: ${missing.join(', ')}`).toEqual([]);
  });

  it('THE RULE: the school\u2019s own facts are stated', () => {
    const text = kb();
    // These are the facts the owner supplied; the assistant must be able to
    // state them without inventing.
    expect(text).toContain('Sekolah Rendah Islam Al-Khairiah');
    expect(text).toContain('Kuala Nerang');
    expect(text).toContain('Bahasa Melayu');
    expect(text).toMatch(/\bRM\b/);
  });

  it('THE RULE: the roles are the three the school has', () => {
    const text = kb();
    expect(text).toContain('ADMIN');
    expect(text).toContain('TEACHER');
    expect(text).toContain('GUARDIAN');
    // Roles from the original product must not appear as roles of this school.
    for (const role of ['PROPRIETOR', 'BURSAR', 'SUPER_ADMIN', 'INSPECTOR', 'COUNSELOR']) {
      expect(text, `${role} is not a role at this school`).not.toContain(role);
    }
  });

  it('THE RULE: the school week and terms are right', () => {
    const text = kb();
    expect(text).toMatch(/Sunday to Thursday|Ahad hingga Khamis|Sunday–Thursday/);
    expect(text).toContain('Penggal 1');
    expect(text).toContain('Penggal 2');
    expect(text).toContain('Penggal 3');
  });

  it('THE RULE: the assistant is told parents do not pay online', () => {
    // This is the single most costly thing it could get wrong: a parent told to
    // "pay now" waits for a payment screen that does not exist.
    const text = kb().toLowerCase();
    expect(text).toMatch(/parents do not pay|do not pay in this app|pay at the office/);
  });

  it('THE RULE: the assistant knows a blank mark is not zero', () => {
    expect(kb().toLowerCase()).toMatch(/blank mark is not zero|blank means nothing/);
  });

  it('THE RULE: no branch or tenant vocabulary survives', () => {
    // SRIK is one school with no branches. The original document described a
    // branch structure in detail, which is exactly the model this app removed.
    const text = kb().toLowerCase();
    expect(text).not.toMatch(/\bsubscription\b/);
    expect(text).not.toContain('main branch');
    expect(text).not.toMatch(/\bbranch(es)?\b/);
    expect(text).not.toMatch(/\btenant\b/);
  });
});
