import { useSettingsStore } from '@/store/settings';
import { dicts, interpolate, lookup, type TranslationKey } from './types';

/**
 * Non-React translation helper for code paths that can't call the
 * `useT()` hook — `lib/*` modules, plain async functions, throw
 * sites in non-component utilities, etc.
 *
 * It reads the active locale from the persisted settings store on
 * each invocation, so the message reflects whatever the user has
 * picked in the settings card. Use it sparingly: anywhere a
 * component or hook is doing the work, prefer `useT()` so React
 * re-renders pick up the latest translation automatically.
 *
 * Example:
 *
 *   throw new ApiError(401, t('errors.api.reLoginRequired'));
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = useSettingsStore.getState().locale;
  return interpolate(lookup(dicts[locale], key), params);
}
