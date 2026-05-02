/**
 * Public surface of the i18n module.
 *
 * Components import everything they need from `@/i18n` rather than
 * reaching into individual files — keeps the import graph small and
 * gives us a single seam for future swaps (e.g. dynamic locale loading).
 */
export { I18nProvider } from './I18nProvider';
export { useI18n, useT } from './hooks';
export {
  DEFAULT_LOCALE, LOCALES, SUPPORTED_LOCALES,
  detectDeviceLocale, normalizeLanguageTag,
  readLegacyStoredLocale, clearLegacyStoredLocale,
  type Locale, type TranslationKey, type I18nContextValue,
} from './types';
