/**
 * "Network if quick, otherwise the IndexedDB snapshot" wrapper for
 * detail-page queries (album / playlist / track / artist).
 *
 * Why this exists
 * ---------------
 * The previous `useAlbum` / `usePlaylist` shape only reached for the
 * offline IDB snapshot in two cases:
 *
 *   1. `navigator.onLine === false`. Reliable on desktop, but on
 *      mobile / WebView (and especially in Telegram's in-app
 *      browser, our primary platform) it routinely reports `true`
 *      even when the device has zero connectivity.
 *   2. After `await api.get(...)` finally rejected. Without an
 *      explicit timeout the underlying `fetch` waits for the browser
 *      default (~60s) before failing, so an offline user sat on a
 *      blank loading screen for a full minute before the page
 *      hydrated from the IndexedDB cache. Reported as
 *      "офлайн: скачанные плейлисты/альбомы не открываются".
 *
 * What this helper does
 * ---------------------
 *   - When `navigator.onLine` is explicitly `false` and the entity
 *     exists in IDB, return the IDB snapshot synchronously without
 *     touching the network.
 *   - Otherwise, race the network call against a short timeout
 *     (`networkTimeoutMs`, default 5000). If the network responds in
 *     time we use it. If the timeout fires first AND the entity is
 *     in IDB, render the IDB snapshot immediately and let the
 *     network call complete in the background — its result is
 *     written into the React-Query cache via the next `refetch`,
 *     not awaited here, so the user always sees content within a
 *     few seconds.
 *   - If neither network nor IDB has anything we re-throw the
 *     network error (or `offline-not-saved`) so the page can show
 *     its "не найден" copy.
 *
 * The shape is intentionally entity-agnostic — pass it a
 * `fetchNetwork` thunk and a `fetchLocal` thunk and it does the
 * right thing for any detail-page query.
 */

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;

export interface NetworkOrLocalOptions {
  /** How long to wait for the network before falling back to IDB.
   *  Set to `Infinity` to disable the timeout. */
  networkTimeoutMs?: number;
}

export async function networkOrLocal<T>(
  fetchNetwork: () => Promise<T>,
  fetchLocal: () => Promise<T | null>,
  opts: NetworkOrLocalOptions = {},
): Promise<T> {
  const { networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS } = opts;

  // 1) Hard-offline path. `navigator.onLine === false` is a strong
  //    "no network" signal — every browser sets it on airplane-mode
  //    / disabled-NIC. Skip the network request entirely so the
  //    page paints from IDB instantly.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const local = await fetchLocal();
    if (local) return local;
    throw new Error('offline-not-saved');
  }

  // 2) Online path. Race the network against the timeout. Issue the
  //    local lookup eagerly so it's ready to short-circuit when the
  //    timeout fires.
  const networkPromise = fetchNetwork();
  // Settle the local lookup unconditionally — it's a cheap IDB read
  // and we'll need the result whether the network wins or times out.
  const localPromise = fetchLocal().catch(() => null);

  // Sentinel that resolves with `'timeout'` after the budget. Use
  // `Promise.race` over a real `AbortController` because we still
  // want the network call to complete in the background so the next
  // `refetch` in React Query gets the fresh value. Aborting here
  // would discard that work.
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    if (networkTimeoutMs === Infinity) return; // never resolve
    setTimeout(() => resolve({ kind: 'timeout' }), networkTimeoutMs);
  });

  const winner = await Promise.race([
    networkPromise.then(
      (data) => ({ kind: 'network' as const, data }),
      (err) => ({ kind: 'network-error' as const, err: err as unknown }),
    ),
    timeoutPromise,
  ]);

  if (winner.kind === 'network') return winner.data;

  if (winner.kind === 'network-error') {
    // Hard network failure — try IDB. If we have a snapshot, use it.
    // Otherwise re-throw the original error so React Query surfaces
    // it to the caller's `isError` branch.
    const local = await localPromise;
    if (local) return local;
    throw winner.err;
  }

  // winner.kind === 'timeout' — we hit the budget without a network
  // response. Show the IDB snapshot if we have one.
  const local = await localPromise;
  if (local) return local;
  // No snapshot to fall back to. Wait the rest of the budget out on
  // the network promise. If it resolves, surface that; if it rejects,
  // let React Query show the error state.
  return networkPromise;
}
