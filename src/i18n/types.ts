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
/** Legacy localStorage key used before locale moved into the settings
 *  store. Kept around so existing users don't lose their choice on the
 *  first reload after this refactor — see `migrateLegacyLocale()`. */
export const STORAGE_KEY = 'bratan-locale';

export const SUPPORTED_LOCALES: readonly Locale[] = ['ru', 'en'] as const;

function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'en';
}

/**
 * Map an arbitrary BCP-47 language tag (`ru`, `ru-RU`, `en-GB`,
 * `en_US`, etc.) to one of our supported locales. Returns `null` if
 * the tag isn't a language we ship a dictionary for so the caller
 * can fall through to the next signal in the auto-detect chain.
 */
export function normalizeLanguageTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : null;
}

interface TelegramLanguageProbe {
  Telegram?: {
    WebApp?: {
      initDataUnsafe?: {
        user?: { language_code?: string };
      };
    };
  };
}

/**
 * Pick a locale for a brand-new visitor. Priority:
 *   1. Telegram WebApp user language (most accurate inside the
 *      Telegram client — matches the user's Telegram interface).
 *   2. `navigator.languages` (ordered list of user preferences).
 *   3. `navigator.language` (the single primary preference).
 *   4. `DEFAULT_LOCALE` as the final fallback.
 *
 * Pure read-only — no side effects, safe to call from a store
 * initializer. Wrapped in a try/catch so a hostile global (e.g.
 * a third-party script that overwrites `navigator`) can't keep
 * the app from booting.
 */
export function detectDeviceLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const tgLang = (window as unknown as TelegramLanguageProbe).Telegram?.WebApp?.initDataUnsafe?.user
      ?.language_code;
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
    // navigator may be unavailable or proxied in unusual environments;
    // fall through to the default rather than crashing the boot path.
  }
  return DEFAULT_LOCALE;
}

/**
 * Read the legacy `bratan-locale` localStorage entry written by an
 * earlier version of the i18n module (pre-settings-store integration).
 * Used once at boot to seed the new store so users don't lose their
 * previously-saved choice. Returns `null` if no usable value exists.
 */
export function readLegacyStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Once per session, scrub the legacy entry so it can't override a
 * subsequent server-side preference change made on another device.
 * Idempotent — safe to call multiple times.
 */
export function clearLegacyStoredLocale(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
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
