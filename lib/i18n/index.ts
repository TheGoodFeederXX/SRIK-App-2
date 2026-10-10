/**
 * App-wide internationalization (i18next + react-i18next).
 *
 * MALAY IS THE STARTING LANGUAGE, AND IT SHIPS IN THE FIRST BUNDLE. That inverts
 * what was here before: English was the fallback and the only eagerly bundled
 * locale, so a Malay user saw English until a translation round-trip happened to
 * succeed — and if it failed, English stayed. A school whose first language is
 * Malay should never open in another language and wait.
 *
 * Language is detected from (1) an explicit choice in localStorage, (2) the
 * device's language, and applied app-wide. A device set to English still gets
 * English, because a relief teacher or an inspector may not read Malay — but a
 * device set to anything else gets Malay rather than a silent fall-through to
 * English, and a device set to Malay finally gets Malay.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { DEFAULT_LANGUAGE, isRtlLanguage, LANGUAGES } from './languages';

// The school's own language is the fallback for every other, so it is the one
// locale that is always needed and ships in the initial bundle. English is loaded
// on demand: most of this school never needs it, and bundling it eagerly would
// make every visitor download strings they will not read.
const baseModules = import.meta.glob('./locales/ms.json', { eager: true }) as Record<string, any>;
const localeLoaders = import.meta.glob('./locales/*.json') as Record<string, () => Promise<any>>;

const resources: Record<string, { translation: any }> = {};
for (const path in baseModules) {
  resources[DEFAULT_LANGUAGE] = { translation: baseModules[path].default || baseModules[path] };
}

const loaderFor = (code: string) => localeLoaders[`./locales/${code}.json`];

/**
 * Loads one locale's strings into i18next if a file exists for it (exact code
 * first, then the base language: 'fr-CA' -> 'fr'). Resolves either way —
 * languages without a file simply keep falling back to English, as before.
 */
export async function ensureLanguageLoaded(code: string): Promise<void> {
  const candidates = [code, code.split('-')[0]];
  for (const c of candidates) {
    if (i18n.hasResourceBundle(c, 'translation')) return;
    const load = loaderFor(c);
    if (!load) continue;
    const mod = await load();
    i18n.addResourceBundle(c, 'translation', mod.default || mod, true, true);
    return;
  }
}

export const STORAGE_KEY = 'app_language';

/** Apply text direction + lang attribute for the active language. */
export function applyDirection(lng: string) {
  if (typeof document === 'undefined') return;
  const rtl = isRtlLanguage(lng);
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    // A device set to 'ms-MY' resolves to 'ms', and 'en-GB' to 'en'. Without this
    // a region-suffixed tag matches nothing and everything falls to the fallback,
    // which is how a Malay phone ended up reading English.
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // An explicit choice wins, then the device's own language, then the page's
      // `lang` attribute. `htmlTag` is last because `index.html` declares `ms` for
      // the document, which would otherwise override a device set to English.
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

applyDirection(i18n.language || DEFAULT_LANGUAGE);
i18n.on('languageChanged', applyDirection);

/**
 * Resolves once the detected language's strings are available. Malay — the
 * fallback, and the language most of this school reads — is already bundled and
 * resolves immediately; an English user waits for exactly one small locale file.
 * `index.tsx` awaits this before the first render, so nobody sees one language
 * swap out beneath them for another. Text direction is applied above, from the
 * code alone, so even the waiting period is laid out correctly.
 */
export const i18nReady: Promise<void> = ensureLanguageLoaded(i18n.language || DEFAULT_LANGUAGE)
  .catch((err) => { console.warn('[i18n] Locale load failed, falling back to Malay:', err); });

/** Change language everywhere, persist locally, and flip direction. */
export async function setAppLanguage(code: string) {
  await ensureLanguageLoaded(code).catch(() => { /* falls back to English */ });
  await i18n.changeLanguage(code);
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  applyDirection(code);
}

export default i18n;
