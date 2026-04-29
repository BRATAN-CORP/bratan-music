import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tidal stream qualities that the proxy account can request. We expose a
 * provider-scoped switch so future sources (SoundCloud, YouTube Music, …)
 * can carry their own quality enums without leaking abstraction.
 */
export type TidalQuality = 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';

export const TIDAL_QUALITY_LABELS: Record<TidalQuality, string> = {
  LOW: 'Low (~320 kbps AAC)',
  HIGH: 'High (16-bit / 44.1 kHz)',
  LOSSLESS: 'Lossless (16-bit / 44.1 kHz FLAC)',
  HI_RES_LOSSLESS: 'Max (до 24-bit / 192 kHz)',
};

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

  setCrossfade: (on: boolean) => void;
  setCrossfadeDuration: (s: number) => void;
  setTidalQuality: (q: TidalQuality) => void;
  setInfinitePlayback: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      crossfade: false,
      crossfadeDuration: 6,
      tidalQuality: 'HIGH',
      // На бы дефолт — это ожидаемое поведение «музыка не кончается»,
      // и явный opt-out в настройках для тех, кому нужно чтобы очередь остановилась
      // ровно там, где положил.
      infinitePlayback: true,
      setCrossfade: (on) => set({ crossfade: on }),
      setCrossfadeDuration: (s) => set({ crossfadeDuration: Math.max(1, Math.min(12, s)) }),
      setTidalQuality: (q) => set({ tidalQuality: q }),
      setInfinitePlayback: (on) => set({ infinitePlayback: on }),
    }),
    { name: 'bratan-settings' },
  ),
);
