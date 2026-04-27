import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  /** When true, render the global subscription paywall dialog. Triggered
   *  by 402 responses from the stream endpoint or by explicit calls from
   *  the profile page. */
  subscriptionPromptOpen: boolean;
  /** Optional reason shown above the paywall headline (e.g. "Дневной
   *  лимит исчерпан"). Lets the dialog explain why it appeared without
   *  forcing every caller to render its own copy. */
  subscriptionPromptReason: string | null;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openSubscriptionPrompt: (reason?: string) => void;
  closeSubscriptionPrompt: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarOpen: true,
      subscriptionPromptOpen: false,
      subscriptionPromptReason: null,
      toggleTheme: () =>
        set((state) => {
          const next = state.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          return { theme: next };
        }),
      setTheme: (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        set({ theme });
      },
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      openSubscriptionPrompt: (reason) =>
        set({ subscriptionPromptOpen: true, subscriptionPromptReason: reason ?? null }),
      closeSubscriptionPrompt: () =>
        set({ subscriptionPromptOpen: false, subscriptionPromptReason: null }),
    }),
    {
      name: 'bratan-ui',
      // Don't persist transient UI flags — only theme and sidebar layout.
      // Otherwise the paywall could re-open on every page reload.
      partialize: (state) => ({ theme: state.theme, sidebarOpen: state.sidebarOpen }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.setAttribute('data-theme', state.theme);
        }
      },
    }
  )
);
