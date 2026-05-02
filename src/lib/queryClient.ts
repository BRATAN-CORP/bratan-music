import { QueryClient } from '@tanstack/react-query';

/**
 * Single QueryClient instance shared between `<QueryClientProvider />`
 * (mounted in `main.tsx`) and any non-React module that needs to talk
 * to the cache directly — most importantly the auth store, which has
 * to wipe per-user cached data the instant a user signs out (otherwise
 * the previous account's pinned playlists keep showing in the sidebar
 * until the next manual refresh).
 *
 * Lives in its own module so consumers don't pull `<App />` (and the
 * ReactDOM root) just to access the cache, and so the singleton's
 * lifecycle is decoupled from the React render tree — important for
 * tests that want to reset the cache between cases without remounting.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Five-minute fresh window matches what the network library
      // would return as `Cache-Control: max-age=300` on most user
      // endpoints. Anything mutated (likes, pins, plays) invalidates
      // the affected key explicitly via `queryClient.invalidateQueries`.
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});
