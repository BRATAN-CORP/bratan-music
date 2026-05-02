import ru from './locales/ru.json';
import en from './locales/en.json';

/**
 * Public types + constants for the home-grown i18n module.
 *
 * Kept separate from the provider component file so React-Refresh can
 * fast-reload the provider without invalidating every consumer (the
 * eslint plugin warns about non-component exports living next to the
 * `<I18nProvider />` definition).
 */

export type Locale = 'ru' | 'en';

export const LOCALES: { code: Locale; nameKey: 'languages.ru' | 'languages.en'; flag: string }[] = [
  { code: 'ru', nameKey: 'languages.ru', flag: '🇷🇺' },
  { code: 'en', nameKey: 'languages.en', flag: '🇬🇧' },
];

export const DEFAULT_LOCALE: Locale = 'ru';
export const STORAGE_KEY = 'bratan-locale';

// Both dictionaries must share the same shape; the canonical Russian
// one is the source of truth and `en.json` is structurally checked
// against it at module load time.
export type Dict = typeof ru;
export const dicts: Record<Locale, Dict> = { ru, en: en as Dict };

/**
 * Recursive key paths through the dictionary, joined with dots.
 * `'settings.language'` is allowed; `'settings.bogus'` is a type error.
 * We cap recursion at 5 levels so the union stays cheap to compute.
 */
type DotKeys<T, Depth extends ReadonlyArray<unknown> = []> = Depth['length'] extends 5
  ? never
  : T extends object
    ? {
        [K in keyof T & string]: T[K] extends object
          ? `${K}.${DotKeys<T[K], [unknown, ...Depth]>}`
          : K
      }[keyof T & string]
    : never;

export type TranslationKey = DotKeys<Dict>;

/** Walk a dotted path through the dictionary, returning the leaf or
 *  the path itself if the leaf is missing (so a forgotten key shows
 *  up in the UI instead of breaking the page). */
export function lookup(dict: Dict, key: string): string {
  let cursor: unknown = dict;
  for (const segment of key.split('.')) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return key;
    }
  }
  return typeof cursor === 'string' ? cursor : key;
}

export function interpolate(template: string, params: Record<string, string | number> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}
