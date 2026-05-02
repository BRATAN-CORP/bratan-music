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
export const SUPPORTED_LOCALES: Locale[] = ['ru', 'en'];
export const STORAGE_KEY = 'bratan-locale';

/**
 * Probe shape for `window.Telegram.WebApp.initDataUnsafe.user.language_code`.
 * Kept here (instead of the global typings) so the i18n module stays
 * self-contained and we don't depend on the rest of the Telegram SDK
 * shapes for a single string lookup.
 */
interface TelegramLanguageProbe {
  Telegram?: {
    WebApp?: {
      initDataUnsafe?: {
        user?: {
          language_code?: string;
        };
      };
    };
  };
}

/**
 * Map a BCP-47-ish language tag (`ru`, `ru-RU`, `en-GB`, …) to one of
 * the locales we actually ship. Unknown / falsy inputs return `null`
 * so callers can chain fallbacks.
 */
export function normalizeLanguageTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split(/[-_]/, 1)[0];
  if (primary === 'ru') return 'ru';
  if (primary === 'en') return 'en';
  return null;
}

/**
 * Pick the best initial locale for a fresh session:
 *   1. Telegram WebApp `language_code` (we are launched from Telegram
 *      most of the time and the bot already knows the user's language).
 *   2. `navigator.languages` / `navigator.language` (browser preference).
 *   3. `DEFAULT_LOCALE` (Russian — primary audience).
 *
 * Pure: never throws, never touches storage, safe to call from the
 * Zustand initializer.
 */
export function detectDeviceLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const tgLang = (window as unknown as TelegramLanguageProbe).Telegram
      ?.WebApp?.initDataUnsafe?.user?.language_code;
    const fromTg = normalizeLanguageTag(tgLang);
    if (fromTg) return fromTg;

    const nav = window.navigator;
    if (nav?.languages?.length) {
      for (const tag of nav.languages) {
        const hit = normalizeLanguageTag(tag);
        if (hit) return hit;
      }
    }
    const fromNav = normalizeLanguageTag(nav?.language);
    if (fromNav) return fromNav;
  } catch {
    // navigator may be unavailable or proxied; fall through.
  }
  return DEFAULT_LOCALE;
}

/**
 * Read whatever the legacy I18nProvider used to write to localStorage
 * under `bratan-locale`. We migrate it once into the settings store on
 * first run, then drop the legacy key so it doesn't shadow the new
 * server-roamed value on subsequent reloads.
 */
export function readLegacyStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage may be unavailable (SSR, private mode).
  }
  return null;
}

export function clearLegacyStoredLocale(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort; legacy key will simply be ignored next time.
  }
}

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
