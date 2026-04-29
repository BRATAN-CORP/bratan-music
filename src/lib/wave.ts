import { fetchWave } from '@/lib/recommendations';
import { usePlayerStore } from '@/store/player';

/**
 * Start (or restart) the user's "Моя волна" stream. Replaces the
 * current queue with a fresh batch of recommendations and starts
 * playing from the first track. Subsequent extension is handled
 * automatically by useAudioPlayer's auto-extend hook (see
 * `useQueueExtender` inside the audio engine).
 *
 * Throws if the wave came back empty — caller decides how to surface
 * that (typically a toast pointing to the cold-start onboarding).
 */
export async function startMyWave(): Promise<number> {
  const tracks = await fetchWave(25);
  if (tracks.length === 0) {
    throw new Error('Волна пока пустая — выбери жанры в онбординге');
  }
  const player = usePlayerStore.getState();
  const [first, ...rest] = tracks;
  if (!first) throw new Error('Волна пока пустая');
  player.setQueue([first, ...rest]);
  player.setTrack(first);
  return tracks.length;
}
