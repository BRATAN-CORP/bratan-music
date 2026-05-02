import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useSettingsStore } from '@/store/settings';
import { I18nContext } from './context';
import {
  dicts, interpolate, lookup,
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
 * The active locale is owned by `useSettingsStore` (alongside crossfade,
 * EQ gains, etc.) so it gets the same persistence + cross-device
 * roaming for free: zustand's `persist` middleware caches it in
 * localStorage, and `useSettingsSync` round-trips it through
 * `/user/preferences`. On a brand-new visit the store auto-detects
 * the device language (Telegram WebApp → `navigator.languages` →
 * `navigator.language`) so the user lands on something sensible
 * before they ever touch the switcher.
 *
 * The `<html lang>` attribute is mirrored so screen-readers and
 * browser features (translate prompts, language-aware fonts) pick
 * up the choice. Interpolation is `{name}`-style:
 * `t('greet', { name: 'Аня' })` → `Привет, Аня`. Keep it simple —
 * the project never needs ICU pluralization rules; if it does we
 * can swap in `intl-messageformat` without touching call sites.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSettingsStore((s) => s.locale);
  const setLocaleInStore = useSettingsStore((s) => s.setLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleInStore(next);
      // Mirror onto <html lang> immediately so assistive tech doesn't
      // wait for the next render tick to pick up the change.
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', next);
      }
    },
    [setLocaleInStore],
  );

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
