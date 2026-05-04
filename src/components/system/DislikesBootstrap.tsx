import { useDislikesBootstrap } from '@/hooks/useDislikes';

/**
 * Headless component. Mounted once near the layout root; pulls the
 * user's dislike list from the API into the synchronous Zustand
 * mirror so non-React callers (player store, audio engine) can do
 * O(1) lookups against an in-memory Set.
 *
 * Renders nothing.
 */
export function DislikesBootstrap() {
  useDislikesBootstrap();
  return null;
}
