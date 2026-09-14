import React from 'react';
import en from '../i18n/en.js';
import si from '../i18n/si.js';
import ta from '../i18n/ta.js';

/**
 * Javora — interface language.
 *
 * This switches the CHROME (nav, labels, headings, form copy) that Javora
 * itself writes. It does not, and must not, translate the dataset: a
 * person's recorded name, an office title, or evidence text is a quote from
 * an institutional source, and only that source gets to phrase it. Rendering
 * an English-source record under a Sinhala or Tamil interface is intentional
 * — see the `Names in Sinhala / Tamil` field on a profile for the one place
 * the record itself carries other-language text, when a source publishes it.
 */
// `shortLabel` is what the nav bar's language switcher shows at phone
// width, once its own trigger (icon + full label + chevron, squeezed
// against the search/theme/menu icon-buttons) no longer fits — see
// `.lang-switch__label--short` in layout.css.
export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', shortLabel: 'En' },
  { code: 'si', label: 'Sinhala', nativeLabel: 'සිංහල', shortLabel: 'සි' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', shortLabel: 'தமி' },
];

const DICTIONARIES = { en, si, ta };
const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'javora:lang';

const isSupported = code => LANGUAGES.some(l => l.code === code);

function lookup(dict, path) {
  return path.split('.').reduce(
    (node, key) => (node && typeof node === 'object' ? node[key] : undefined),
    dict,
  );
}

/** Falls back English-ward on a missing translation, then to the key itself, so a gap in si/ta never blanks a label. */
function resolve(lang, key, vars) {
  const value = lookup(DICTIONARIES[lang], key) ?? lookup(DICTIONARIES[DEFAULT_LANG], key) ?? key;
  const text = typeof value === 'function' ? value(vars ?? {}) : value;
  if (typeof text !== 'string' || !vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * A COUNT, grouped for reading: 1397 -> "1,397".
 *
 * Deliberately a separate call rather than something `resolve` does to every
 * number it interpolates. The same `{{…}}` machinery also carries years
 * (`{{year}}`, the register's earliest office, 1931), and a blanket rule
 * would print "1,931" — a grouped year is simply wrong, and getting it wrong
 * on a page whose whole claim is that its figures come from records would be
 * a bad trade for the convenience.
 *
 * Grouping follows the interface language, not a hardcoded locale: the
 * separator is not the same character in every language this site offers.
 *
 * Why it exists at all: the register printed "1,623 people" in the directory
 * summary and "1623 records" in the filter drawer's live count, two lines
 * apart, because one call site remembered `toLocaleString` and the other did
 * not. Counts are the numbers this site is read for; they should not be
 * formatted by whoever happened to write the line.
 */
export function formatCount(value, lang = DEFAULT_LANG) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(lang)
    : String(value ?? "");
}

const I18nContext = React.createContext({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, vars) => resolve(DEFAULT_LANG, key, vars),
  n: value => formatCount(value, DEFAULT_LANG),
});

export function I18nProvider({ children }) {
  /*
   * Starts English unconditionally — including the very first client render
   * — the same reason `ThemeToggle` starts `dark=false` unconditionally (see
   * components/Chrome.jsx): the prerendered HTML was always written in
   * English, so a first render that read a stored preference could disagree
   * with it and fail hydration. The effect below corrects it from storage a
   * tick later, before the reader has had time to read anything.
   */
  const [lang, setLangState] = React.useState(DEFAULT_LANG);

  // Reads the stored preference once on mount (matching ThemeToggle's
  // pattern for the same hydration reason — see the comment above), and
  // keeps listening afterwards so a language switch in another tab is
  // reflected here too.
  React.useEffect(() => {
    const readStored = () => {
      let stored = null;
      try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { /* private mode, etc. */ }
      if (stored && isSupported(stored)) setLangState(stored);
    };
    readStored();
    const onStorage = e => { if (e.key === STORAGE_KEY) readStored(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = React.useCallback(code => {
    if (!isSupported(code)) return;
    setLangState(code);
    try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode, etc. */ }
  }, []);

  const t = React.useCallback((key, vars) => resolve(lang, key, vars), [lang]);
  /** `n(1623)` -> "1,623" in the current language. See `formatCount`. */
  const n = React.useCallback(value => formatCount(value, lang), [lang]);

  const value = React.useMemo(() => ({ lang, setLang, t, n }), [lang, setLang, t, n]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return React.useContext(I18nContext);
}
