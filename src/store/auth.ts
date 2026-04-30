import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePlayerStore } from '@/store/player';

interface User {
  id: string;
  username: string | null;
  name: string | null;
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
        set({ user: null, accessToken: null, refreshToken: null });
      },
      isAuthenticated: () => get().accessToken !== null,
    }),
    { name: 'bratan-auth' }
  )
);
