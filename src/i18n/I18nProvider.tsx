import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { I18nContext } from './context';
import { dicts, interpolate, lookup, type I18nContextValue, type Locale, type TranslationKey } from './types';
import { useSettingsStore } from '@/store/settings';

/**
 * Tiny home-grown i18n provider. We don't pull in `react-i18next`
 * because the project's translation surface is small enough to keep
 * zero deps and full type-safety: `t('settings.language')` is statically
 * checked against the keys in `ru.json` so a typo or a missing
 * translation in `en.json` becomes a compile error instead of an
 * empty string.
 *
 * Locale ownership lives in `useSettingsStore.locale`:
 *   - The store's initialiser runs auto-detection (Telegram WebApp →
 *     navigator → DEFAULT_LOCALE), with a one-shot migration from the
 *     legacy `bratan-locale` localStorage key.
 *   - `persist()` middleware keeps the choice across reloads.
 *   - `useSettingsSync` includes `locale` in the cross-device sync
 *     payload, so changing the language on one device propagates to
 *     others on next hydration.
 *
 * The provider is a thin reactive bridge: it subscribes to the store,
 * mirrors `<html lang>`, and exposes `t()` to consumers. Setting the
 * locale just writes to the store, and every component re-renders
 * automatically.
 *
 * Interpolation is `{name}`-style: `t('greet', { name: 'Аня' })` →
 * `Привет, Аня`. Keep it simple — the project never needs ICU
 * pluralization rules; if it does we can swap in `intl-messageformat`
 * without touching call sites.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSettingsStore((s) => s.locale);
  const setLocaleInStore = useSettingsStore((s) => s.setLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleInStore(next);
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
