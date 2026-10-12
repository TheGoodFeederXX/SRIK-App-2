/**
 * Both locale files must hold the SAME keys.
 *
 * WHY. A key present in Malay but missing in English falls back to Malay, so an English
 * reader sees a Malay sentence with no warning to anyone. A key present in English but
 * missing in Malay falls back to... Malay, which is not there either, so the reader sees the
 * raw key — `attendanceRegister.present` — on the screen. Both are silent: nothing fails, no
 * test goes red, and the defect only appears in front of a teacher.
 *
 * This is cheapest to catch HERE, at the file, rather than by changing language on every
 * screen. It runs on every change, so adding a string to one language and forgetting the
 * other fails immediately instead of at the moment a parent reads it.
 */
import { describe, it, expect } from 'vitest';
import ms from '../locales/ms.json';
import en from '../locales/en.json';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../languages';

type AnyRecord = Record<string, unknown>;

/** Every leaf key path, so `a.b.c` is compared as a path rather than per top-level group. */
const flatten = (obj: AnyRecord, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
            ? flatten(v as AnyRecord, `${prefix}${k}.`)
            : [`${prefix}${k}`],
    );

describe('locale parity', () => {
    it('Malay and English define exactly the same keys', () => {
        const msKeys = flatten(ms as AnyRecord).sort();
        const enKeys = flatten(en as AnyRecord).sort();

        const missingInEn = msKeys.filter((k) => !enKeys.includes(k));
        const missingInMs = enKeys.filter((k) => !msKeys.includes(k));

        // Reported together, because seeing both lists at once says whether a whole group
        // was forgotten or a single string slipped through.
        expect({ missingInEn, missingInMs }).toEqual({ missingInEn: [], missingInMs: [] });
    });

    it('neither locale is empty', () => {
        // A file that failed to parse into an object would make the parity check above
        // vacuous — both sides empty and equal.
        expect(flatten(ms as AnyRecord).length).toBeGreaterThan(50);
        expect(flatten(en as AnyRecord).length).toBeGreaterThan(50);
    });

    it('no translated value is an empty string', () => {
        // An empty string renders as nothing at all — worse than a visible key, because
        // there is no clue that a label used to be there.
        const empties: string[] = [];
        for (const [name, bundle] of [['ms', ms], ['en', en]] as const) {
            const walk = (o: AnyRecord, p = '') => {
                for (const [k, v] of Object.entries(o)) {
                    if (v !== null && typeof v === 'object' && !Array.isArray(v)) walk(v as AnyRecord, `${p}${k}.`);
                    else if (typeof v === 'string' && v.trim() === '') empties.push(`${name}:${p}${k}`);
                }
            };
            walk(bundle as AnyRecord);
        }
        expect(empties).toEqual([]);
    });

    it('the school default is Malay, not English', () => {
        // The school's rule: Malay is primary and default; English is chosen from settings.
        // If this ever flips, an English-first app silently serves a Malay school.
        expect(DEFAULT_LANGUAGE).toBe('ms');
        expect(LANGUAGES[0].code).toBe('ms');
    });
});
