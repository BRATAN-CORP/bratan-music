import { fetchWave, type WaveOptions } from '@/lib/recommendations';
import { usePlayerStore } from '@/store/player';
import { t } from '@/i18n/runtime';

/**
 * Start (or restart) the user's "Моя волна" stream. Replaces the
 * current queue with a fresh batch of recommendations and starts
 * playing from the first track. Subsequent extension is handled
 * automatically by useAudioPlayer's auto-extend hook (see
 * `useQueueExtender` inside the audio engine).
 *
 * `opts` lets the caller bias the wave by mood and/or character — see
 * `WaveOptions` in `lib/recommendations.ts`. Both nullable; default is
 * a balanced wave.
 *
 * Throws if the wave came back empty — caller decides how to surface
 * that (typically a toast pointing to the cold-start onboarding).
 */
export async function startMyWave(opts: WaveOptions = {}): Promise<number> {
  const tracks = await fetchWave(25, opts);
  if (tracks.length === 0) {
    throw new Error(t('wave.emptyHint'));
  }
  const player = usePlayerStore.getState();
  const [first, ...rest] = tracks;
  if (!first) throw new Error(t('wave.empty'));
  player.setQueue([first, ...rest]);
  player.setTrack(first);
  return tracks.length;
}
