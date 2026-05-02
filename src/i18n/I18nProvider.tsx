import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext } from './context';
import {
  DEFAULT_LOCALE, STORAGE_KEY, dicts, interpolate, lookup,
  type I18nContextValue, type Locale, type TranslationKey,
} from './types';

/**
 * Tiny home-grown i18n provider. We don't pull in `react-i18next`
 * because the project's translation surface is small enough to keep
 * zero deps and full type-safety: `t('settings.language')` is statically
 * checked against the keys in `ru.json` so a typo or a missing
 * translation in `en.json` becomes a compile error instead of an
 * empty string.
 *
 * Locale lives in localStorage (`bratan-locale`) so the choice
 * survives reload, and the `<html lang>` attribute is mirrored so
 * screen-readers and browser features (translate prompts,
 * language-aware fonts) pick it up.
 *
 * Interpolation is `{name}`-style: `t('greet', { name: 'Аня' })` →
 * `Привет, Аня`. Keep it simple — the project never needs ICU
 * pluralization rules; if it does we can swap in `intl-messageformat`
 * without touching call sites.
 */

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage might be unavailable (SSR, private mode); fall back.
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort; the in-memory state still updates
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', next);
    }
  }, []);

  // Reflect the current locale on the <html> tag so screen-readers and
  // browser features (translate prompts, language-aware fonts) pick it up.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', locale);
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const dict = dicts[locale];
    const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
      const template = lookup(dict, key);
      return interpolate(template, params);
    };
    return { locale, setLocale, t };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
