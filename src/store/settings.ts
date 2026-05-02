import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// Import directly from `@/i18n/types` (not the package barrel) to break a
// dependency cycle — the I18nProvider re-exported from `@/i18n` reads
// this very store, so going through the barrel here would form a loop.
import {
  detectDeviceLocale,
  readLegacyStoredLocale,
  clearLegacyStoredLocale,
  type Locale,
  type TranslationKey,
} from '@/i18n/types';

/**
 * Tidal stream qualities that the proxy account can request. We expose a
 * provider-scoped switch so future sources (SoundCloud, YouTube Music, …)
 * can carry their own quality enums without leaking abstraction.
 */
export type TidalQuality = 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';

/**
 * Translation keys for the four Tidal quality labels. Components
 * resolve them via `useT()` so the dropdown copy follows the active
 * locale. The keys live under `settings.tidalQuality.*` in both
 * locale files and carry the technical specs themselves (e.g.
 * "Lossless (16-bit / 44.1 kHz FLAC)") since the audio specs are
 * universal — only the prose framing ("Max (up to ...)" /
 * "Max (до ...)") needs to flip between languages.
 */
export const TIDAL_QUALITY_LABEL_KEYS: Record<TidalQuality, TranslationKey> = {
  LOW: 'settings.tidalQuality.low',
  HIGH: 'settings.tidalQuality.high',
  LOSSLESS: 'settings.tidalQuality.lossless',
  HI_RES_LOSSLESS: 'settings.tidalQuality.hiResLossless',
};

/**
 * Number of equalizer bands. Keep in sync with `EQ_BANDS` in
 * `useAudioPlayer.ts` — the audio graph wires exactly this many
 * BiquadFilter nodes and indexes them positionally. Defining the
 * count here (instead of importing the array) breaks an otherwise
 * circular dependency between the store and the audio hook.
 */
export const EQ_BAND_COUNT = 6;

interface SettingsState {
  /** Smooth track-to-track transition. Two audio elements + gain ramps. */
  crossfade: boolean;
  /** Crossfade duration in seconds (1 — 12). */
  crossfadeDuration: number;
  /** Stream quality requested from the Tidal proxy account. */
  tidalQuality: TidalQuality;
  /**
   * Бесконечное воспроизведение: когда очередь почти пуста и `repeat='off'`,
   * автоматически добавляем рекомендации в хвост. Если выключено — плеер
   * останавливается на последнем треке.
   */
  infinitePlayback: boolean;
  /**
   * Per-band equalizer gain in dB. Length is fixed to `EQ_BAND_COUNT`.
   * Persisted so the user's curve survives reloads and roams across
   * devices via /user/preferences. Applied to the audio graph either
   * by `setEqGain` (live updates) or by `ensureAudioGraph` on first
   * graph creation (hydration path on reload).
   */
  eqGains: number[];
  /**
   * Active interface locale. Default is auto-detected from the
   * Telegram WebApp user language / `navigator.languages` chain on
   * the very first visit, then persisted locally and roamed across
   * devices via /user/preferences. The `<I18nProvider />` reads this
   * slice and renders accordingly — single source of truth so the
   * user's choice in Settings is reflected everywhere instantly.
   */
  locale: Locale;
  /**
   * Server-side hydration marker. `true` once we've successfully
   * pulled prefs from /user/preferences (or confirmed there were
   * none). Used by `useSettingsSync` to suppress an immediate echo
   * write right after hydration.
   */
  hydrated: boolean;

  setCrossfade: (on: boolean) => void;
  setCrossfadeDuration: (s: number) => void;
  setTidalQuality: (q: TidalQuality) => void;
  setInfinitePlayback: (on: boolean) => void;
  setEqGain: (index: number, value: number) => void;
  setEqGains: (gains: number[]) => void;
  setLocale: (locale: Locale) => void;
  /**
   * Merge server-returned preferences over the current state. Only
   * keys we recognise are applied; extras are ignored. Marks the
   * store as hydrated so the sync hook can resume pushing changes.
   */
  hydrateFromServer: (prefs: Record<string, unknown>) => void;
  markHydrated: () => void;
}

function clampGain(g: unknown): number {
  if (typeof g !== 'number' || !Number.isFinite(g)) return 0;
  return Math.max(-12, Math.min(12, g));
}

function defaultGains(): number[] {
  return Array.from({ length: EQ_BAND_COUNT }, () => 0);
}

function normaliseGains(input: unknown): number[] {
  if (!Array.isArray(input)) return defaultGains();
  const out = defaultGains();
  for (let i = 0; i < EQ_BAND_COUNT; i++) out[i] = clampGain(input[i]);
  return out;
}

function normaliseLocale(input: unknown): Locale | null {
  return input === 'ru' || input === 'en' ? input : null;
}

/**
 * Pick the locale a brand-new user (or a returning user from before
 * locale moved into the settings store) should land on. Order:
 *
 *   1. Legacy `bratan-locale` localStorage entry — preserves the
 *      explicit choice they made before this refactor.
 *   2. Device auto-detect (Telegram WebApp / navigator).
 *
 * Once seeded, this value participates in the regular persist + sync
 * flow so the legacy entry can be safely scrubbed.
 */
function pickInitialLocale(): Locale {
  const legacy = readLegacyStoredLocale();
  if (legacy) {
    clearLegacyStoredLocale();
    return legacy;
  }
  return detectDeviceLocale();
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      crossfade: false,
      crossfadeDuration: 6,
      tidalQuality: 'HIGH',
      // На бы дефолт — это ожидаемое поведение «музыка не кончается»,
      // и явный opt-out в настройках для тех, кому нужно чтобы очередь остановилась
      // ровно там, где положил.
      infinitePlayback: true,
      eqGains: defaultGains(),
      locale: pickInitialLocale(),
      hydrated: false,
      setCrossfade: (on) => set({ crossfade: on }),
      setCrossfadeDuration: (s) => set({ crossfadeDuration: Math.max(1, Math.min(12, s)) }),
      setTidalQuality: (q) => set({ tidalQuality: q }),
      setInfinitePlayback: (on) => set({ infinitePlayback: on }),
      setEqGain: (index, value) => {
        if (index < 0 || index >= EQ_BAND_COUNT) return;
        const prev = get().eqGains;
        const next = prev.slice();
        next[index] = clampGain(value);
        set({ eqGains: next });
      },
      setEqGains: (gains) => set({ eqGains: normaliseGains(gains) }),
      setLocale: (locale) => set({ locale }),
      hydrateFromServer: (prefs) => {
        const patch: Partial<SettingsState> = { hydrated: true };
        if (typeof prefs.crossfade === 'boolean') patch.crossfade = prefs.crossfade;
        if (typeof prefs.crossfadeDuration === 'number') {
          patch.crossfadeDuration = Math.max(1, Math.min(12, prefs.crossfadeDuration));
        }
        if (
          prefs.tidalQuality === 'LOW' ||
          prefs.tidalQuality === 'HIGH' ||
          prefs.tidalQuality === 'LOSSLESS' ||
          prefs.tidalQuality === 'HI_RES_LOSSLESS'
        ) {
          patch.tidalQuality = prefs.tidalQuality;
        }
        if (typeof prefs.infinitePlayback === 'boolean') patch.infinitePlayback = prefs.infinitePlayback;
        if (Array.isArray(prefs.eqGains)) patch.eqGains = normaliseGains(prefs.eqGains);
        const fromServer = normaliseLocale(prefs.locale);
        if (fromServer) patch.locale = fromServer;
        set(patch);
      },
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'bratan-settings',
      // `hydrated` is purely a per-session flag — the sync hook flips
      // it to true once the server fetch resolves. Persisting it
      // would skip that fetch on subsequent reloads, defeating the
      // whole point of cross-device roaming.
      partialize: (s) => ({
        crossfade: s.crossfade,
        crossfadeDuration: s.crossfadeDuration,
        tidalQuality: s.tidalQuality,
        infinitePlayback: s.infinitePlayback,
        eqGains: s.eqGains,
        locale: s.locale,
      }),
    },
  ),
);
