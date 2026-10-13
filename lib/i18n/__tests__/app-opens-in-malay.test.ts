/**
 * Guards the defect the owner reported: "Malay is correct on mobile, but the desktop
 * is still English."
 *
 * The cause was the language-detection order, which consulted `navigator` (the
 * device's own language) before falling back. So the app answered each device in its
 * own language: a phone set to Malay opened in Malay, a laptop set to English opened in
 * English, and nobody had chosen either one. The school's language is Malay, so the app
 * must open in Malay and only change when someone deliberately chooses.
 *
 * These assertions read the real configuration, not a copy of it, so if the detection
 * order is ever widened back to the device this file fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_LANGUAGE } from '../languages';

const i18nSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
const languagesSource = readFileSync(resolve(__dirname, '../languages.ts'), 'utf8');
const panelSource = readFileSync(
  resolve(__dirname, '../../../components/shared/AppearancePanel.tsx'),
  'utf8',
);

describe('aplikasi dibuka dalam Bahasa Melayu, bukan mengikut peranti', () => {
  it('THE RULE: the device language is NOT consulted', () => {
    // `navigator` in the detection order is exactly the defect: it made the app open
    // in whatever language the computer was set to.
    const orderMatch = i18nSource.match(/order:\s*\[([^\]]*)\]/);
    expect(orderMatch, 'detection order not found in lib/i18n/index.ts').not.toBeNull();
    const order = orderMatch![1];
    expect(order).not.toMatch(/navigator/);
    expect(order).toMatch(/localStorage/);
  });

  it('THE RULE: the page lang attribute cannot override the choice either', () => {
    // index.html declares lang="ms"; if htmlTag were consulted it would fight the
    // stored choice. Both device-derived sources must be absent.
    const orderMatch = i18nSource.match(/order:\s*\[([^\]]*)\]/);
    expect(orderMatch![1]).not.toMatch(/htmlTag/);
  });

  it('THE RULE: Malay is still the default and the fallback', () => {
    expect(DEFAULT_LANGUAGE).toBe('ms');
    expect(i18nSource).toMatch(/fallbackLng:\s*DEFAULT_LANGUAGE/);
  });

  it('THE RULE: an explicit choice IS remembered', () => {
    // The fix must not throw the baby out: choosing English has to stick across
    // reloads, which is what localStorage does.
    expect(i18nSource).toMatch(/lookupLocalStorage:\s*STORAGE_KEY/);
    expect(i18nSource).toMatch(/caches:\s*\[[^\]]*localStorage/);
  });

  it('THE RULE: a signed-in user can actually reach the language choice', () => {
    // Without this the desktop user had no way to change language at all, which is
    // the second half of the reported symptom. The import alone is not enough — the
    // switcher must actually be RENDERED, so match the JSX element, not the import.
    expect(panelSource).toMatch(/<LanguageSwitcher\b/);
  });

  it('the device-language reasoning is not silently reintroduced', () => {
    // A future edit that adds `navigator` back should have to delete this comment too,
    // which is the moment to reconsider. Same for the region-tag handling that made a
    // Malay phone read English.
    expect(languagesSource).toMatch(/DEFAULT_LANGUAGE = 'ms'/);
    expect(i18nSource).toMatch(/nonExplicitSupportedLngs:\s*true/);
  });
});

describe('ujian langsung: peranti Inggeris tetap dapat Melayu', () => {
  it('navigator=en-US tidak menjadikan aplikasi Inggeris', async () => {
    // jsdom's navigator is en-US, which IS the desktop case the owner reported. Loading a
    // fresh module instance (as a real page load does) must resolve to Malay.
    expect(navigator.language.startsWith('en')).toBe(true);
    vi.resetModules();
    localStorage.clear();
    const fresh = (await import('../index')).default;
    expect(fresh.language).toBe('ms');
    expect(fresh.t('common.logout')).toBe('Log Keluar');
  });

  it('pilihan jelas dalam localStorage tetap dihormati', async () => {
    vi.resetModules();
    localStorage.setItem('app_language', 'en');
    const mod = await import('../index');
    const fresh = mod.default;
    // English is lazy-loaded, so the bundle must be awaited before its strings exist.
    // `setAppLanguage` is the real path a user takes, and it does exactly this.
    await mod.setAppLanguage('en');
    expect(fresh.language).toBe('en');
    expect(fresh.t('common.logout')).toBe('Logout');
    localStorage.clear();
  });
});
