import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePlayerStore } from '@/store/player';

interface User {
  id: string;
  username: string | null;
  name: string | null;
  isAdmin: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (data: { user: User; accessToken: string; refreshToken: string }) => void;
  setTokens: (data: { accessToken: string; refreshToken: string }) => void;
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
