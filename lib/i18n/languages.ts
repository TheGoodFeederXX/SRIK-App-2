/**
 * The languages this app offers.
 *
 * MALAY IS FIRST, AND THAT IS THE POINT. This was a registry of 44 languages —
 * Spanish, Korean, Yoruba, Igbo, Hausa and thirty-nine more — inherited from the
 * product this code came from, which sold to schools around the world. SRIK is
 * ONE school in Kedah whose staff, parents and children read Malay. A 44-item
 * dropdown is not a feature here; it is a leftover that made "which language am I
 * in?" a question nobody could answer.
 *
 * English stays as the second option, and the fallback, because a relief teacher
 * or a visiting officer may not read Malay — but a Malay user is never asked to
 * choose it.
 *
 * `nativeName` is what the switcher shows: a language named in its own language,
 * so someone who cannot read the current one can still find their own.
 *
 * To add a language: add an entry here and a `locales/<code>.json` file. Missing
 * keys fall back to Malay.
 */
export interface AppLanguage {
  code: string;       // BCP-47 code used by i18next
  name: string;       // English name
  nativeName: string; // endonym shown in the picker
  rtl?: boolean;
}

export const LANGUAGES: AppLanguage[] = [
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  // English is kept as a SECOND language, not the first. The school's business is
  // conducted in Malay, but a relief teacher or a visiting inspector may not read
  // it, and a parent's phone may be set to English. Offering English lets them
  // work without changing anything about how the school itself is served.
  { code: 'en', name: 'English', nativeName: 'English' },
];


/**
 * Languages written right to left.
 *
 * THIS LIST IS INDEPENDENT OF `LANGUAGES` ON PURPOSE. It used to be derived from
 * the shipped list — `LANGUAGES.filter(l => l.rtl)` — which meant narrowing the
 * list to Malay and English silently emptied it, and `isRtlLanguage('ar')` began
 * returning false. Nothing visibly broke, because no RTL language ships today;
 * the trap was that the detector quietly stopped working, and the next person to
 * add an Arabic interface would have found the layout never flipped.
 *
 * Writing direction is a property of a SCRIPT, not of which languages an app
 * happens to ship. Arabic and Hebrew are right-to-left whether or not this school
 * offers them — and this school teaches Arabic, so its own subject matter is the
 * reason to keep the answer correct.
 */
export const RTL_CODES = ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps', 'sd', 'ug', 'ku', 'ckb'];

export const isRtlLanguage = (code: string): boolean => {
  const base = (code || '').toLowerCase().split('-')[0];
  return RTL_CODES.includes(base);
};

/**
 * The language the app starts in, and the one every missing key falls back to.
 *
 * This was `'en'`. Combined with a detection order that consulted the DEVICE, it
 * meant a teacher holding a Malay phone opened a Malay school's app and read
 * English — and because no `ms.json` existed, choosing "Bahasa Melayu" from the
 * switcher changed nothing either. Both halves are fixed: this is `'ms'`, and the
 * Malay bundle now exists.
 */
export const DEFAULT_LANGUAGE = 'ms';
