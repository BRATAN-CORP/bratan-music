/**
 * "Local snapshot first, network as background refresh" wrapper for
 * detail-page queries (album / playlist / track / artist).
 *
 * Why this exists
 * ---------------
 * The previous shape ("network if quick, otherwise IDB") had three
 * symptoms that converged on the same user-visible bug — saved
 * collections refusing to open from `/album/:id` or `/playlist/:id`
 * even when the row was sitting in IndexedDB the whole time:
 *
 *   1. `navigator.onLine === false` is unreliable on iOS / Telegram
 *      WebView / Chrome PWA. The user reported the bug AFTER the
 *      previous fix that already special-cased that flag, and the
 *      browser kept reporting `true` while truly offline — so the
 *      offline branch never engaged.
 *
 *   2. Online but unhealthy paths (DNS hijacks, captive portals,
 *      worker cold-starts, expired auth where `/auth/refresh` itself
 *      hangs) made `fetch` resolve with errors or stall past the
 *      5-second timeout, then the helper would hand the timeout
 *      branch a `null` local because the IDB lookup hadn't completed
 *      yet — and the page bottomed out on "альбом не найден" even
 *      though the row existed.
 *
 *   3. The previous racing logic tried the network first by design.
 *      For an entity the user explicitly downloaded, paying any
 *      network cost before showing the saved data was always a UX
 *      regression — especially on mobile where the round-trip can
 *      easily blow the 5-second budget.
 *
 * What this helper does
 * ---------------------
 *   - Always issues the local IDB lookup FIRST. IDB reads are
 *     <10 ms even on cheap phones and never depend on the network
 *     state, so this is the fastest possible path to a paint.
 *   - If the local snapshot exists, returns it immediately. The
 *     caller (React Query) records `data`, `isError` stays false,
 *     and the page renders the saved entity. If the device is
 *     online we kick off `fetchNetwork` in the background — its
 *     result is discarded here, but React Query's automatic
 *     background refetch on next mount will pick up the fresh
 *     server copy via its own scheduling.
 *   - If the local snapshot is missing we fall through to the
 *     network. With `navigator.onLine === false`, we throw
 *     `offline-not-saved` straight away. Otherwise we await the
 *     network with a hard timeout so a hung `fetch` can't pin the
 *     loading skeleton forever.
 *   - On every network failure we re-check IDB once more (in case a
 *     parallel download just landed) before surfacing the error.
 *
 * The shape is intentionally entity-agnostic — pass it a
 * `fetchNetwork` thunk and a `fetchLocal` thunk and it does the
 * right thing for any detail-page query.
 */

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;

export interface NetworkOrLocalOptions {
  /** How long to wait for the network before failing. Set to
   *  `Infinity` to disable the timeout. */
  networkTimeoutMs?: number;
}

async function safeFetchLocal<T>(
  fetchLocal: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await fetchLocal();
  } catch {
    // IDB transactions can reject under storage pressure / private
    // mode / quota errors. Treat any failure as "no local snapshot"
    // so the helper falls through to the network path instead of
    // bubbling an internal error to React Query.
    return null;
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export async function networkOrLocal<T>(
  fetchNetwork: () => Promise<T>,
  fetchLocal: () => Promise<T | null>,
  opts: NetworkOrLocalOptions = {},
): Promise<T> {
  const { networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS } = opts;

  // 1) Always read the IDB snapshot first. If the entity is saved
  //    offline this is instant; if it isn't we fall through with a
  //    null result.
  const local = await safeFetchLocal(fetchLocal);
  if (local) {
    // We deliberately do NOT fire a background `fetchNetwork()` here.
    // For a saved entity the React-Query staleTime + the user's
    // own page navigations are enough to refresh the snapshot the
    // next time the network is healthy; firing a fire-and-forget
    // network call from inside `queryFn` would (a) trigger an
    // `/auth/refresh` rotation if the access token is expired,
    // potentially racing with other in-flight requests, and
    // (b) cost mobile data on every page open even though the
    // user already has the entity downloaded.
    return local;
  }

  // 2) No local snapshot. We need the network.
  if (!isOnline()) {
    throw new Error('offline-not-saved');
  }

  // 3) Race the network against the timeout. We do this here (and
  //    not in step 1) because step 1 already won the race for
  //    offline-saved entities — only un-saved entities reach this
  //    point, and for those a hung fetch must not pin the loading
  //    skeleton forever.
  const networkPromise = fetchNetwork();
  const timeoutPromise = new Promise<never>((_, reject) => {
    if (networkTimeoutMs === Infinity) return;
    setTimeout(
      () => reject(new Error('network-timeout')),
      networkTimeoutMs,
    );
  });

  try {
    return await Promise.race([networkPromise, timeoutPromise]);
  } catch (err) {
    // One last check: maybe a parallel download committed the row
    // to IDB while we were waiting. Cheap to re-read; saves us a
    // misleading error if a save happened to land mid-flight.
    const lateLocal = await safeFetchLocal(fetchLocal);
    if (lateLocal) return lateLocal;
    throw err;
  }
}
