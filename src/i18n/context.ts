import { createContext } from 'react';
import type { I18nContextValue } from './types';

/**
 * Context handle is split out of the Provider component so the hooks
 * file can `useContext(I18nContext)` without pulling in the JSX
 * provider — keeps React-Refresh boundaries clean.
 */
export const I18nContext = createContext<I18nContextValue | null>(null);
