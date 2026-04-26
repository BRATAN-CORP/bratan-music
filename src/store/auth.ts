import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      isAuthenticated: () => get().accessToken !== null,
    }),
    { name: 'bratan-auth' }
  )
);
