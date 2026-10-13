/**
 * The app starts in Malay, and stays there.
 *
 * WHY THIS TEST CHANGED SHAPE. It used to assert that the registry held at least
 * forty languages, with an English base. That assertion is what KEPT the defect:
 * it described the product this code came from — a school platform sold around
 * the world — and it would have failed the moment anyone narrowed the list to
 * what SRIK actually needs. A test that guards the wrong behaviour does not just
 * fail to catch the bug; it actively protects it.
 *
 * What is asserted now is the thing that was actually broken:
 *   - Malay is the default and the fallback.
 *   - a Malay bundle EXISTS (it did not, so choosing Malay changed nothing).
 *   - Malay is where the app STARTS, whatever the device is set to.
 *
 * The last line changed after the owner reported the real-world symptom: Malay on
 * a phone, English on a desktop, in the same app. The cause was the detection order
 * consulting `navigator`, so each device was answered in its own language although
 * nobody had chosen one. The device language is no longer consulted, and
 * `app-opens-in-malay.test.ts` guards that.
 */
import { describe, it, expect } from 'vitest';
import { LANGUAGES, DEFAULT_LANGUAGE, isRtlLanguage } from '../languages';
import ms from '../locales/ms.json';
import en from '../locales/en.json';

/** Every dotted key path in a bundle, so two bundles can be compared. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? keyPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );
}

describe('the app is a Malay app', () => {
  it('THE RULE: the default language is Malay', () => {
    expect(DEFAULT_LANGUAGE).toBe('ms');
  });

  it('THE RULE: a Malay bundle exists, and is the default', () => {
    // Choosing "Bahasa Melayu" used to do nothing, because no ms.json existed
    // and every key fell back to English.
    expect(LANGUAGES[0].code).toBe('ms');
    expect(LANGUAGES.some(l => l.code === 'en')).toBe(true);
  });

  it('THE RULE: the language list is the school\u2019s, not the world\u2019s', () => {
    // Yoruba, Igbo, Hausa, Korean and the rest belonged to a product sold
    // globally. This is one school in Kedah.
    const codes = LANGUAGES.map(l => l.code);
    expect(codes).toEqual(['ms', 'en']);
  });

  it('has unique language codes', () => {
    const codes = LANGUAGES.map(l => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every language has a native name', () => {
    expect(LANGUAGES.every(l => l.nativeName.trim().length > 0)).toBe(true);
  });

  it('THE RULE: the Malay bundle covers every key the app uses', () => {
    // A missing key falls back to Malay itself, so a gap would render as a
    // literal key path like "common.save" in front of a teacher. Malay is the
    // FALLBACK, so Malay must be the complete one — a key English has and Malay
    // lacks is a key that can never be translated.
    const msKeys = new Set(keyPaths(ms));
    const enKeys = keyPaths(en);
    const missing = enKeys.filter(k => !msKeys.has(k));
    expect(missing).toEqual([]);
    // The two bundles cover the same ground, in both directions.
    expect([...msKeys].filter(k => !enKeys.includes(k))).toEqual([]);
  });

  it('THE RULE: the Malay bundle is Malay, not copied English', () => {
    // A "translation" that is byte-identical to English is the failure mode that
    // looks finished until someone reads it.
    expect(ms.common.save).toBe('Simpan');
    expect(ms.auth.signIn).toBe('Log Masuk');
    expect(ms.nav.home).toBe('Utama');
    expect(ms.roles.student).toBe('Murid');
    expect(ms.roles.teacher).toBe('Guru');
    expect(ms.dashboard.welcome).toContain('{{name}}');
  });

  it('THE RULE: the English bundle no longer offers Google sign-in', () => {
    // The school asked for email-and-password only.
    expect(en).not.toHaveProperty('auth.signInWithGoogle');
  });

  it('detects RTL languages and not LTR', () => {
    // No RTL language ships here, but the detector still has to be right, because
    // Arabic is the school's subject matter and a future Arabic UI must not be
    // built on a detector that silently says LTR.
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he')).toBe(true);
    expect(isRtlLanguage('ur')).toBe(true);
    expect(isRtlLanguage('fa')).toBe(true);
    expect(isRtlLanguage('ms')).toBe(false);
    expect(isRtlLanguage('en')).toBe(false);
  });
});

describe('the language registry cannot silently regrow', () => {
  it('THE RULE: every offered language has a bundle to back it', () => {
    // A language in the switcher with no `locales/<code>.json` is a broken
    // promise: the user picks it and nothing changes, because the app is still
    // showing the fallback. That is exactly how "Bahasa Melayu" behaved.
    // `ms` and `en` are the two that exist, and this asserts a third cannot be
    // added without its file.
    const modules = import.meta.glob('../locales/*.json');
    const available = Object.keys(modules).map(p =>
      p.replace('../locales/', '').replace('.json', '')
    );
    for (const lang of LANGUAGES) {
      expect(available, `no bundle for ${lang.code}`).toContain(lang.code);
    }
  });

  it('THE RULE: Malay is listed before English', () => {
    // Order is meaning here: the switcher renders in list order, and the first
    // entry is what a reader takes as the school's own language.
    const codes = LANGUAGES.map(l => l.code);
    expect(codes.indexOf('ms')).toBeLessThan(codes.indexOf('en'));
  });
});
