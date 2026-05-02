import { useEffect, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { applyPersistedEqGainsToGraph } from '@/hooks/useAudioPlayer';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';

interface PreferencesEnvelope {
  prefs: Record<string, unknown>;
}

/**
 * Cross-device roaming for the settings store.
 *
 * On mount (whenever the user is authenticated), pulls
 * `/user/preferences` and merges the server's snapshot over the
 * locally-persisted state — server wins because it represents what
 * the user last touched on any device, not just this one. Once
 * hydrated, subscribes to the relevant slice of the store and
 * debounce-pushes changes back to the server (1 second of quiet)
 * so a slider drag results in a single PUT, not one per frame.
 *
 * Mounted from the app shell (AppLayout) so it lives for the full
 * session and survives route changes — anything shorter would risk
 * losing in-flight changes when the user navigates mid-edit.
 */
export function useSettingsSync() {
  const isAuthed = useAuthStore((s) => Boolean(s.accessToken));
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  const markHydrated = useSettingsStore((s) => s.markHydrated);

  // Reset on auth changes — logging out and back in as another user
  // must re-pull from the server, otherwise the second user inherits
  // the first user's local cache.
  const lastAuthTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!isAuthed) {
      lastAuthTokenRef.current = null;
      return;
    }
    if (lastAuthTokenRef.current === token && hydrated) return;
    lastAuthTokenRef.current = token;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<PreferencesEnvelope>('/user/preferences');
        if (cancelled) return;
        if (res?.prefs && typeof res.prefs === 'object') {
          hydrateFromServer(res.prefs);
          // Push the just-hydrated EQ curve to the live audio graph
          // so a setting changed on another device takes effect
          // immediately on this one without waiting for the user to
          // touch a slider.
          applyPersistedEqGainsToGraph();
        } else {
          markHydrated();
        }
      } catch (err) {
        // 401 is already handled inside `api` (auto-logout). For any
        // other error just mark hydrated so writes can flow once the
        // user touches a setting — better to push local changes than
        // to silently freeze the sync layer because a single GET
        // failed (e.g. transient network blip).
        if (!(err instanceof ApiError) || err.status !== 401) markHydrated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed, hydrated, hydrateFromServer, markHydrated]);

  // Debounced push. Subscribe to the persisted slice so we don't
  // refire on `hydrated` flips or transient setters. Comparing the
  // serialised payload short-circuits the no-op write right after
  // hydration when the local + server states are already aligned.
  const lastPushedRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthed || !hydrated) return;
    const unsub = useSettingsStore.subscribe((state) => {
      const payload = {
        crossfade: state.crossfade,
        crossfadeDuration: state.crossfadeDuration,
        tidalQuality: state.tidalQuality,
        infinitePlayback: state.infinitePlayback,
        eqGains: state.eqGains,
        locale: state.locale,
      };
      // Mirror EQ updates onto the live graph immediately. The store
      // is the source of truth; the graph just reflects it. Gain
      // changes coming from the Equalizer component already nudge the
      // graph directly, but anything that touches `eqGains` outside
      // that path (server hydration of subsequent prefs updates, the
      // Reset button) goes through here.
      applyPersistedEqGainsToGraph();
      const key = JSON.stringify(payload);
      if (key === lastPushedRef.current) return;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        lastPushedRef.current = key;
        api.put('/user/preferences', { prefs: payload }).catch(() => {
          // Swallow — keeping the local store as source of truth on
          // network failure is the right tradeoff. Next change will
          // try again.
        });
      }, 1000);
    });
    return () => {
      unsub();
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [isAuthed, hydrated]);
}
