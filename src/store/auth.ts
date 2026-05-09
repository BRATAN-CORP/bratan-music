import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePlayerStore } from '@/store/player';
import { queryClient } from '@/lib/queryClient';
// Import directly from the storage submodule (not the `@/lib/offline`
// barrel) — the barrel transitively pulls in `streamResolver`, which
// reads `useAuthStore`, which would form a circular module graph and
// trip Vite's strict-init checks during fast refresh.
import { wipeAll as wipeOfflineCache } from '@/lib/offline/storage';

interface User {
  id: string;
  username: string | null;
  name: string | null;
  /**
   * Email-OTP login surface. Optional so legacy persisted state from
   * before the email login shipped still deserialises cleanly — the
   * settings page treats both `null` and `undefined` as "no email
   * linked".
   */
  email?: string | null;
  isAdmin: boolean;
  /**
   * Unix seconds when the user finished or skipped the spotlight
   * onboarding tour, or `null` if they have never run it. Optional in
   * the type so persisted state from before the tour shipped still
   * deserialises cleanly — `<OnboardingTour />` treats both `null` and
   * `undefined` as "tour not yet completed".
   */
  tourCompletedAt?: number | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (data: { user: User; accessToken: string; refreshToken: string }) => void;
  setTokens: (data: { accessToken: string; refreshToken: string }) => void;
  /** Patch a subset of fields on the in-memory user without touching
   *  tokens. Used after `POST /user/me/tour/complete` to mark the
   *  spotlight tour as finished without rebroadcasting the whole auth
   *  payload, and after a successful `/user/me` refetch to surface
   *  any server-side changes (admin grant, tour reset). */
  patchUser: (patch: Partial<User>) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (data) =>
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }),
      setTokens: (data) =>
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }),
      patchUser: (patch) => {
        const current = get().user;
        if (!current) return;
        set({ user: { ...current, ...patch } });
      },
      logout: () => {
        // Tear down the player so the bottom bar disappears immediately
        // and the previous user's queue/track doesn't leak across sign-ins.
        // Done before the auth state flip so any subscribers that react to
        // `user === null` see a clean player.
        usePlayerStore.getState().reset();
        // Wipe React-Query cache so per-user data (pinned playlists,
        // library, daily playlists, profile, limits, room state) doesn't
        // bleed into the next session. Without this the sidebar keeps
        // showing the previous account's pinned items until the user
        // hard-refreshes the page — exactly the symptom reported by
        // the user. `clear()` removes all queries and aborts in-flight
        // requests, which is what we want at sign-out.
        queryClient.clear();
        // Drop the on-device offline cache so a subsequent sign-in on
        // the same machine doesn't surface the previous user's saved
        // tracks. Best-effort — IndexedDB might be unavailable in
        // private mode, in which case the wipe is a no-op.
        void wipeOfflineCache().catch(() => { /* ignore */ });
        set({ user: null, accessToken: null, refreshToken: null });
      },
      isAuthenticated: () => get().accessToken !== null,
    }),
    { name: 'bratan-auth' }
  )
);
