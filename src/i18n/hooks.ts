import { useContext } from 'react';
import { I18nContext } from './context';
import {
  DEFAULT_LOCALE, dicts, interpolate, lookup,
  type I18nContextValue, type TranslationKey,
} from './types';

/**
 * Primary translation hook. Returns the active locale, a setter, and a
 * type-safe `t(key, params?)` function.
 *
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   <h1>{t('settings.title')}</h1>
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive fallback so a component that's accidentally rendered
    // outside the provider still gets the Russian dictionary instead
    // of crashing the page. The rest of the tree is type-safe enough
    // that this branch is effectively unreachable in production.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key: TranslationKey, params?: Record<string, string | number>) =>
        interpolate(lookup(dicts[DEFAULT_LOCALE], key), params),
    };
  }
  return ctx;
}

/**
 * Sugar for components that only need `t`. Equivalent to
 * `useI18n().t` but easier on the eye in JSX-heavy files.
 */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
