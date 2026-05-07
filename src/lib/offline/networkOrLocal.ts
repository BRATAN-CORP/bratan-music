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
  /** When true, skip the IDB snapshot read entirely and go straight
   *  to the network. Used by hooks that detect an in-flight download
   *  for the entity — during a download the IDB row only carries the
   *  partial track list (the album/playlist shell is committed
   *  upfront so the "Загруженное" tab can render the entity mid-
   *  download), so preferring it here would replace the full
   *  network track list with the partial saved one and the album
   *  page would visibly "lose" the un-downloaded tracks. Reported as
   *  "после загрузки одного трека страница альбома перерендеривается
   *  и я вижу только загруженные треки". The IDB snapshot is still
   *  consulted as a last-resort fallback when the network call
   *  fails. */
  skipLocal?: boolean;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function networkOrLocal<T>(
  fetchNetwork: () => Promise<T>,
  fetchLocal: () => Promise<T | null>,
  opts: NetworkOrLocalOptions = {},
): Promise<T> {
  const { networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS, skipLocal = false } = opts;

  // 1) Always read the IDB snapshot first. If the entity is saved
  //    offline this is instant; if it isn't we fall through with a
  //    null result. Skipped when an active download for the entity
  //    is in flight — see `NetworkOrLocalOptions.skipLocal`.
  if (!skipLocal) {
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
  }

  // 2) No local snapshot (or local intentionally skipped). We need
  //    the network — unless the device is offline.
  if (!isOnline()) {
    // We may have just been told the entity is saved (the user came
    // here via "Загруженное" → click → detail page) but a transient
    // IDB hiccup at cold-start handed us a `null` on step 1. Retry
    // a few times with growing back-off before throwing — the delay
    // covers a freshly-mounted IDB transaction queue / a save that's
    // currently mid-write / a synthesis path that needs `db.listTracks`
    // to land first. Without this retry the page falls back to
    // "альбом не найден" on the very first cold-start tap into an
    // offline-saved entity. Reported as "иногда при клике на
    // оффлайн альбом / плейлист пишется, что не найден".
    for (const ms of [100, 250, 500]) {
      await delay(ms);
      const retry = await safeFetchLocal(fetchLocal);
      if (retry) return retry;
    }
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
    // If the first attempt didn't see anything, give the IDB
    // queue another tick and try once more — `safeFetchLocal`
    // returns null for transient transaction errors and we'd
    // rather keep the user on the saved snapshot than show
    // "не найден" because of a 50 ms race.
    await delay(150);
    const retryLocal = await safeFetchLocal(fetchLocal);
    if (retryLocal) return retryLocal;
    throw err;
  }
}
