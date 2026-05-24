# Frontend Refactor — Live Tracker

> Этот файл живёт в репо и обновляется в каждом PR. Любой агент (Devin / Claude),
> который перехватит работу, начинает с этого файла. История перехватов — внизу.
>
> Дополняет (но не заменяет) [`/REFACTOR_PROGRESS.md`](../../REFACTOR_PROGRESS.md) —
> там лежит изначальный план предыдущего агента (помечен historical после PR #396),
> здесь — живой статус и уточнения по ходу работы.

---

## Inputs от пользователя (verbatim, RU)

> Твоя задача — рефакторинг кода … обновить фронтенд: вынести цвета/отступы/прочее
> в глобальные переменные; везде использовать одинаковые компоненты; меньше
> хардкода и повтора кода модалок; интерфейс к единому стилю; акцентные цвета —
> везде одинаковые; везде `i18n`, без хардкода языка; точечные исправления багов;
> унифицировать код, сделать гибче и масштабируемее.
>
> **Не сломать плеер** (анимации/EQ/fullscreen/lyrics — оставить как есть).
> Страницы playlists / authors / albums привести к плеер-стилю с адаптивом
> на маленьких экранах. Единые safe-zones для PWA на iOS / Android.
>
> Каждая задача — отдельный PR. После каждого PR — апдейт этого файла.

Свежий батч (2026-05-09):

> 1. Офлайн lyrics: при загрузке трека прогружать его lyrics, чтобы
>    они работали и в офлайн режиме (PWA точно).
> 2. Мобильная адаптация lyrics: при включённом lyrics прятать обложку
>    и анимированный блюр от неё, на их месте показывать lyrics
>    (бекграунд блюр обложки оставлять). Дизайн lyrics — как на
>    широком экране (десктоп side-panel).
> 3. Полноэкранный плеер: пофиксить отзывчивость ползунка громкости
>    (привести к поведению mini-плеера, без отстающей CSS-анимации).
> 4. Иконки next/prev в плеере (везде где встречаются) — solid.

## Hard constraints (не нарушаем)

- Не трогаем audio engine: `useAudioPlayer`, `Player.tsx`, `FullscreenPlayer.tsx`,
  визуализатор / EQ / lyrics.
- Не ослабляем безопасность: HMAC Telegram WebApp, JWT auth, CORS allowlist,
  RLS, parameterized SQL.
- Не модифицируем уже применённые D1-миграции.
- Не делаем force-push в main.
- Каждый PR держим скоупанным — лучше шесть маленьких чем один большой.

---

## Roadmap (текущая серия)

История по ранее завершённым PR-роадмапам — в `git log` и
`docs/daily-changes/`. В таблице — только активные задачи текущего батча.

| # | Branch | Title | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | `devin/1778362098-offline-lyrics` | Offline lyrics — fetch + persist `OfflineTrack.lyrics` при загрузке трека, IDB-fallback в `useLyrics` | merged | #425 |
| 2 | `devin/1778409485-fix-queue-lyrics` | **Mobile lyrics layout + queue centering + queue touch-vs-mouse drag.** Lyrics на <md рендерится в слоте обложки (`flex-1 min-h-0` — позже заменён, см. строку 5); кебаб «…» в шапке → крестик; old `mode="overlay"` overlay убран. Queue: Sheet → Modal align="center"; drag split touch=grip / mouse=всюду. | merged | #429 |
| 5 | `devin/1778410247-lyrics-no-shift` | **Follow-up под фидбэк:** (a) лирика занимает РОВНО тот же слот что и обложка (`aspect-square w-full max-w-md` + maxWidth-clamp) — title/progress/transport/volume не двигаются; (b) кнопка «Прокручивать вместе с песней» центрирована и стилизована `liquid-glass` как navbar; (c) скроллбар в лирике скрыт (`.no-scrollbar` utility); (d) swipe-to-dismiss fullscreen работает в свободной зоне даже когда лирика открыта. | merged | #430 |
| 6 | `devin/1778412962-lyrics-pwa-followup` | **Lyrics polish + PWA hardening:** (a) loader/error/empty состояния LyricsContent получают `w-full` → spinner + label по центру cover-slot а не по левому краю; (b) blur(0.5px) на неактивных строках убран — на DPR≥2 он мерцал при смене строк; (c) lyrics-cover-slot сохраняет фиксированный bounding box (`aspect-square w-full max-w-md`) НО внутренний wrapper `absolute inset-x-0 bottom-0` с `top:-5rem` визуально расширяет лирику вверх в breathing-зону — title/progress/transport/volume не двигаются; (d) ArtistLinks получает `onNavigate` callback, FullscreenPlayer multi-credit передаёт `closeFullscreen` → клик по артисту в фуллскрине плавно сворачивает и переходит на artist page; (e) PWA: `navigateFallback: 'index.html'` (deep links работают офлайн), runtimeCaching для cover-art, `globPatterns` явно включает woff2/png/svg, `navigator.storage.persist()` на boot — устойчивость к eviction. | merged | #431 |
| 8 | `devin/1778793519-fix-background-crossfade-trigger` | **Wall-clock auto-crossfade trigger.** `timeupdate` в backgrounded tab / iOS locked screen throttles до 1 Гц / молчит десятками секунд → trigger gate (`dur - currentTime <= crossfadeDuration`) можно проскочить целиком, трек hard-cut'ает на `onEnded`. Добавил `scheduleAutoCrossfade()` — wall-clock `setTimeout` параллельно legacy timeupdate-trigger'у; arm'ится на load metadata / durationchange / seek / visibility recovery / каждом изменении `currentTrack`/`isPlaying`/`crossfade`/`crossfadeDuration`. Внутри коллбека все preconditions re-checked (track id, isPlaying, seek guard, crossfade-in-flight). | merged | #440 |
| 9 | `devin/1778793980-daily-playlists-anti-overlap` | **Daily playlists 1/3 (Знакомое/Под настроение) — same tracks.** Раньше familiar и mood вызывали `rec.wave()` без `character` → один и тот же taste-aligned пул → большой overlap. Fix: (а) familiar теперь вызывает wave с `character: 'familiar'` (W_FAMILIAR_BONUS × FAMILIAR_BIAS), discover — `character: 'discover'` (familiar_bonus flips negative), mood-filler-wave получает `mood` enum смапленный из `moodSlug`; (б) сквозной cross-variant `claimed: Set<trackKey>` пробрасывается через все три варианта и фильтрует backfill-пулы; (в) familiar и discover теперь оверсамплят wave (×2 и ×3 соответственно) чтобы compensate за strip. | merged | #441 |
| 10 | `devin/1778794183-recs-country-genre-vector` | **Recs: country/language signal + genre vector + dial weights.** `TasteProfile.scriptMix` (cyrillic/latin/cjk/other из `play_history.artist_name`, нормализуется и обнуляется на reset), `TasteProfile.genreWeights` (нормализованные веса из `genre_seeds`), `version: 2` (старые v1-профили считаются stale и пересчитываются). В `rerank()` добавлены `W_GENRE_MATCH=0.20`, `W_LANG_MISMATCH=-0.40` (gate: ≥50 плеев, доля скрипта < `LANG_MIN_SHARE=0.10`); `W_TASTE` поднят с 0.55 → 0.85, `W_NOVELTY` опущен 0.20 → 0.10 чтобы taste-сигнал доминировал. `genreProvenance: Map<trackKey, slug>` теперь tracks, через какой explore-slug пришёл кандидат, и rerank умножает на `profile.genreWeights[slug]`. | merged | #442 |
| 11 | `devin/1778795500-session-management` | **Session management + global logout.** Migration `0028_session_management.sql` — ALTER `sessions` (+ `last_used_at`, `user_agent`, `ip_hash`, `client_label`, индекс `(user_id, last_used_at DESC)`), ALTER `users` (+ `min_token_iat`), one-off `UPDATE users SET min_token_iat = now(); DELETE FROM sessions` (вышибает всех — пользователь явно попросил). `AuthService.generateTokens(userId, isAdmin, metadata)` пишет UA/IP-hash/label в row + `sid` claim в JWT pair; refresh бампит `last_used_at`. Middleware `jwtAuth` дополнительно проверяет `payload.iat >= users.min_token_iat` и кладёт `sessionId` в context. Новый `SessionService` + endpoints `GET /user/sessions`, `DELETE /user/sessions/:id`, `POST /user/sessions/logout-all`. Фронт: `SessionsPanel` (в стиле `LinkedAccountsPanel`) — список устройств с label/last-used, "Текущая" badge, per-row revoke и bulk "Выйти со всех других устройств". | merged | #443 |
| 12 | `devin/1778839666-session-revoke-enforce` | **Session revoke fix — per-session JWT gate.** Previously DELETE на чужой сессии не вырубал её access-token (он stateless, JWT TTL 1h, `min_token_iat` bump делался ТОЛЬКО при self-revoke). Фикс: middleware `jwtAuth` теперь после ban/min_iat-check делает `SELECT 1 FROM sessions WHERE id = payload.sid AND user_id = sub LIMIT 1` — нет строки → 401. Чтобы `sid` оставался стабильным через refresh-rotation, ввёл `AuthService.rotateSession(sessionId, ...)`: UPDATE существующего row (token_hash, expires_at, last_used_at, metadata) вместо DELETE+INSERT с новым UUID. `/auth/refresh` переключён на rotateSession. `verifyRefreshToken` back-fills `payload.sid` из matched row (legacy tokens compat). Из `SessionService.revokeAllExcept` и `DELETE /user/sessions/:id` убран `min_token_iat`-бамп (был лишним и в logout-all мог убить keep-сессию). `SessionsPanel` обновил `LogoutAllResponse.revoked`. | merged | #445 |
| 7 | `devin/1778415081-artist-picker-mini-bar` | **Multi-credit «Перейти к артисту» picker + mini-player rail geometry restore.** (a) Новый компонент `ArtistGoToMenuItems` с двумя view (`'main'` + `'artist-go-picker'`) зеркалит `ArtistDislikeMenuItems`; общий `ArtistMenuPickerView` — back-row + caption + список артистов — переиспользуется обоими (dislike-picker отрефакторен на него тоже). На multi-credit треке «Перейти к артисту» открывает picker внутри того же popover, single-credit — направляет напрямую как раньше. Подключено в miniplayer kebab (Player.tsx), TrackKebabMenu, FullscreenPlayer (там же `beforeNavigate={closeFullscreen}` чтобы overlay свернулся до перехода). i18n: добавлены `track.goToArtistPickerTitle` / `track.goToArtistPickerBack`. (b) MobileBottomDock: верстка прогресс-бара переписана так, что видимая 3px полоска снова прижата к верху дока, а 14px тач-зона рендерится как `absolute inset-x-0 top-0 h-3.5` overlay поверх рейла; overlay перекрывает только 11px верхнего padding'а cover-row (где нет интерактивных элементов) — тап-сик работает на мобиле, бар не сдвинулся. | open | (этот PR) |
| 13 | `devin/1779010460-daily-playlists-backfill` | **Daily playlists — aggressive multi-phase backfill.** Users with many dislikes + narrow taste got 1/36/43 tracks instead of 50 because the single-pass genre backfill couldn't compensate for cascading claim+dislike filtering. Fix: (a) 3-phase backfill in `generateVariants` — Phase 1: variant fallback + user genre seeds + core genres; Phase 2: broad `rec.wave()` (no character/mood) for track-radio-sourced candidates; Phase 3: extended pool of 17 genre/mood/popular slugs. (b) Oversample multipliers bumped: familiar 2×→3×, discover 3×→5×, mood filler 2×→4×. (c) Discover now pads with ALL genre seeds + fallback genres instead of just the first slug. (d) Mood tries all 5 mood slugs before falling back to wave filler. | merged | #447 |
| 14 | `devin/1779011024-admin-reset-daily-playlists` | **Admin: daily playlists reset button.** New endpoint `POST /admin/daily-playlists/reset` (jwtAuth + adminOnly) — accepts optional `userId`; if present, recomputes taste + regenerates that single user's playlists; if absent, iterates all active users (same set as nightly cron, ≤500). Frontend: `AdminDailyPlaylistsResetPanel` card on profile admin section — one-click "Regenerate now" button with loading/success/error states. i18n: RU + EN keys under `admin_panels.dailyReset`. | merged | #448 |
| 15 | `devin/1779011963-daily-playlists-dislike-aware-build` | **Daily playlists — dislike-aware build.** Root cause of persisting <50 tracks (discover 46, mood 24): `buildVariantTracks` didn't know about dislikes, returned 50 tracks that included disliked artists/tracks, then `generateVariants` stripped them post-hoc. The outer 3-phase backfill re-fetched the same slugs already tried inside `buildVariantTracks`, getting zero new unique tracks. Fix: pass `dislikes` into `buildVariantTracks`, introduce `isClean()` predicate that checks claimed + disliked (track + artist + multi-credit artist), apply it at every pool-fetch step (wave, genre pages, mood pages, padding loops). Now internal oversampling/padding sees the real deficit after dislikes, so padding loops actually compensate. Outer backfill in `generateVariants` remains as belt-and-braces safety net. | merged | #449 |
| 16 | `devin/1779013355-daily-playlists-quality-backfill` | **Daily playlists + wave — taste-seeded backfill, kill generic genre garbage.** Two issues after PR #449: (a) mood variant dropped to 20 tracks (cross-variant claim overlap with mood's wave candidates from shared track-radio seeds); (b) Phase 3 backfill pulled irrelevant genres (jazz, classical, latin, country etc.) the user never listened to. Fix (DailyPlaylistService): remove `EXTENDED_BACKFILL_SLUGS` entirely; replace Phase 3 with `tasteSeedRadio()` — track-radio from completed tracks at positions 15+ (which wave() never samples) plus user's genre-seed pages; mood `buildVariantTracks` gets 8× wave oversample + genre seeds + deep-seed radio fallback layers. Fix (RecommendationService): always include genre-seed explore pages in wave candidate pool (was cold-start-only) so users with history get genre-aligned candidates scored by `W_GENRE_MATCH`. | merged | #450 |
| 17 | `devin/1779014169-recs-overhaul` | **Recs overhaul — liked tracks as primary taste signal.** Complete redesign: (a) `TasteProfile` v2→v3: new `likedTrackIds[]` (up to 100 tracks from is_liked playlist, filtered for disliked tracks/artists); (b) `RecommendationService.wave()`: unified seed list merges liked+completed (liked first so `sampleN` biases toward them), `SEED_FAN_OUT` 5→8, multi-credit artist dislike check added to `rerank()`; (c) `DailyPlaylistService`: all three variants seed from liked tracks via `radioFromSeeds()` (full 50-track radio per seed, replaces old `tracksFromIds` that only took first result), `tasteSeedRadio()` merges liked+completed seeds, generic genre fallback (`genre_pop`/`genre_rap`/`genre_electronic`) removed, familiar oversample 3×→4×, discover 5×→6×, discover/mood pad from liked-track radio before genre seeds. | merged | #451 |
| 18 | `devin/1779032563-tidal-explicit-uncensored` (merged → squash `9ae0506`) | **Tidal: uncensored audio+lyrics + Explicit "E" badge across UI.** Root cause: per-account "Explicit Content" filter в Tidal's user-profile transparently swaps explicit search hits for clean variants и сервит cenzured lyrics. У pool-аккаунтов он был включён по дефолту → весь сервис получал клин-версии. (a) Worker: новый `TidalExplicitFilter.ts` — best-effort пытается выключить фильтр через 4 endpoint-варианта (`/users/:id/profile`, `/settings/me`, legacy `/subscription/explicit-content`, v2 `me/explicit-content`), 4-секундный AbortController-timeout per attempt, KV-memo per userId (30-day TTL) чтоб не бить API каждый рефреш, comprehensive warn-логи. Hook'нут из `TidalAuth.refreshWithClient()` через `.catch(() => null)` — fail open, никогда не блокирует auth flow. Audio engine не трогали. (b) Frontend: `Track.explicit?: boolean` сквозной (Track, player Track, RoomTrackSnapshot, BannedTrackDetail, `toPlayerTrack`, `snapshotFromTrack`, RoomService.sanitiseTrack, `/dislikes/details`). Новый `<ExplicitBadge>` — neutral muted bg (`--color-bg-muted`/`--color-text-muted`), `inline-flex shrink-0`, renders ничего если `!== true`, scaled font-size с floor=8px, `aria-label`+`title` через i18n (`common.explicitBadge` RU «Ненормативная лексика» / EN «Explicit»). Интегрирован в: TrackItem, PlaylistTrackItem, QueueDialog, BannedListDialog, mini-Player, MobileBottomDock, FullscreenPlayer, Track page hero, Rooms now-playing, Home preview strip — flex wrapping предотвращает Marquee-overflow. | merged | #452 |
| 19 | `devin/1779098469-tidal-explicit-ui-fixes` | **Tidal Explicit follow-up: badge на альбомах/плейлистах + lyrics fallback + расширенные endpoint-варианты фильтра.** После PR #452 пользователь сообщил, что (а) бэйдж E кривой/большой отступ + не везде показывается; (б) треки всё ещё с цензурой (в проде все 4 endpoint-варианта из #452 возвращали 404, фильтр на пул-аккаунте никогда не выключался). Фиксы: (1) **ExplicitBadge**: `font-bold` (был semibold), `transform: translateY(-0.5px)` (optical baseline correction — caps-aligned текст сидел чуть выше геом. центра em-box), новый `tone='light'` variant для FullscreenPlayer (белый bg / чёрный fg вне зависимости от темы). (2) **Album/Playlist explicit**: `Album.explicit?` и `ExplorePlaylist.explicit?` теперь сквозные (worker `music.ts`, frontend `types/index.ts`); `TidalService.mapAlbum()` извлекает поле из Tidal API + fallback «explicit если хоть один трек explicit» когда родительская запись забыла флаг; `mapExplorePlaylist` тоже. Бэйдж рендерится на: `AlbumCard`, `AlbumPage` hero, `ExplorePlaylistCard` (hero + grid). (3) **TidalExplicitFilter**: с 4-х до 13-ти endpoint-вариантов (`/v1/users/{uid}/profile/explicitContent` form+JSON, `/v1/users/{uid}/settings/explicit-content/enabled`, `PUT/PATCH /v1/users/{uid}/settings` с batched payload, host-варианты на `desktop.tidal.com` и `listen.tidal.com/api`), новые `Origin: https://listen.tidal.com`+Web `User-Agent`+`Accept-Language`. (4) **Lyrics fallback в `TidalApi.getTrackLyrics`**: цепочка `v1?includeExplicit=true&explicitContent=true&useEditedLyrics=false` → `v2?includeExplicit=true` → legacy v1, первый ответ с непустыми `lyrics`/`subtitles` побеждает — даёт шанс на uncensored-текст даже когда account-toggle упал. | merged | #454 |
| 20 | `(reverted)` | **PR #456 — реверт.** Пользователь явно попросил откатить #456: реализация в #456 не решала корневую проблему цензуры (search/artist top-tracks всё равно отдавали clean), плюс ввела регрессии в UI бэйджа. Возвращаемся к состоянию после #455 как baseline. Реверт сделан как обратный патч в первом коммите этой же ветки. | reverted | (этот PR) |
| 21 | `devin/tidal-explicit-revert-and-refix` | **Tidal Explicit — реальный фикс цензуры (active twin lookup) + бэйдж переделан.** Двухчастный фикс. (A) Worker — три слоя защиты против clean-substitution: (1) `TidalApi.commonParams()` пробрасывает `includeExplicit=true&explicitContent=true` через каждый search/album/artist endpoint + UA/headers поза `listen.tidal.com` Web client (`Origin: https://listen.tidal.com`, Chrome UA, Accept-Language en) — Tidal honor'ит request-level explicit overrides только когда запрос выглядит как Web client, mobile UA даёт ignore-overrides+fallback на per-account фильтр; (2) `preferExplicitAlbums` / `preferExplicitTracks` — same-response dedupe в `TidalService.search` / `getArtistTopTracks` / `getArtistAlbumsAndSingles` / `getArtistReleases` / `getArtistAlbums` / `getPlaylistTracks`, группирует по `(artistId, normaliseAlbumTitle(title))` для альбомов и `(artistId, title, durationBucket=round(d/2))` для треков, drop'ает clean twin когда explicit twin есть в том же ответе; (3) **NEW — `swapInExplicitTwins()`**: ключевой missing piece — для каждого clean трека в результате search / artistTopTracks / playlistTracks делает active per-track Tidal-search lookup чтобы найти explicit twin id, hydrate'ит через `getTrack`, substitute'ит на тот же индекс, concurrency=4, KV-memo `tidal-explicit-twin:<cleanId>` → `<explicitId>` или `__none__` 30 days. Это решает кейс «в самом search Tidal вернул только clean variant» — раньше PR #456 deduplicate'ил в пределах одного response, что не помогало когда Tidal вообще не возвращал explicit вариант. Audio engine не тронут (нет вмешательства в `TidalWeb.resolveStream` / `playbackinfopostpaywall`). `getAlbum()` НЕ swap'ит — albumId = контракт пользователя, только warn breadcrumb на clean-suffix titles. `normaliseAlbumTitle` strip'ает `clean|explicit|edited` через `\b(?:...)\b` чтобы false-positive'ы (`Cleaning Up Mix`, `Editions`) не collapse'ились. (B) D1 миграция 0029 + history endpoint: `play_history.explicit INTEGER NOT NULL DEFAULT 0` → `POST /history/play` пишет, `GET /history/recent` отдаёт `MAX(explicit)`, frontend `usePlayHistoryLogger` + `PlayLogPayload` + `home.toTrack(r)` пробрасывают флаг через — recent-strip badge теперь зажигается. (C) **ExplicitBadge переделан**: убран хардкод `translateY(-0.5px)` на внешнем span (он desync'ил бэйдж с baseline'ом текста — был bug), новая геометрия — outer box `padding:0`/`lineHeight:1`/`overflow:hidden` без translate, inner span `display:block`+`translateY(-Xpx)` где X scales 0.5/0.5/0.75/1.0/1.0/1.25 px по бакетам ≤12/≤14/≤16/≤18/≤22/>22, E теперь точно по центру при любом размере. (D) `gap-1.5` → `gap-1` в compact contexts: home `PreviewStripRow`, `AlbumCard`, `BannedListDialog`, `ExploreModules` playlist row, `PlaylistTrackItem`, `QueueDialog`, `TrackItem`, mini-Player, `MobileBottomDock`. Hero контексты сохранили `gap-2`. (E) `src/app/explore/playlist.tsx`: hero h1 теперь `flex flex-wrap items-center gap-2` + `<ExplicitBadge size={20}>`. | merged | #457 |
| 22 | `kiro/tidal-explicit-album-twin-and-badge-svg` | **Tidal Explicit — album twin lookup, getAlbum redirect, SVG бэйдж, MediaSession like.** После PR #457 пользователь сообщил: (а) "сама e расположена не по центру квадратика, фикс ваще не сработал, всё равно внутри альбома выдаёт зацензуренные версии" — root cause: PR #457 swap'ил только треки, но search возвращает clean album_id → юзер кликает → `getAlbum(cleanId)` верно отдаёт clean tracklist (по-id retrieval = контракт). Аудитировав путь от search до album page, я добавил album-level twin lookup + transparent redirect. (б) "не везде значок e показывается (как минимум в истории не показывается)" — root cause: 4+ setTrack call sites собирали Track объекты вручную и теряли поле `explicit`, поэтому currentTrack.explicit становился undefined, лоджер плеев писал 0, история отрисовывалась без бэйджа, mini/full player тоже. Что сделано: (1) **Worker — `swapInExplicitAlbumTwins()` + `resolveExplicitAlbumTwin()` + `resolveExplicitAlbumIdRedirect()`**: для каждого clean album'а активный поиск twin'а по `(artistId, normaliseAlbumTitle)` + `explicit===true` matching, KV-memo `tidal-explicit-album-twin:<cleanId>` 30d. Применено в `search()`, `getArtistAlbums()`, `getArtistAlbumsAndSingles()`, `getArtistReleases()`, `getArtistReleasesPage()`, `getExploreList(albums)`, `getExplorePage()`. **`getAlbum()` теперь делает transparent redirect**: если KV-memo говорит "у этого clean'а есть explicit twin" — фетчит albumId twin'а вместо запрошенного. Snapshot этого решения отличается от PR #457: там был breadcrumb, здесь — реальный swap (юзер явно попросил). Audio engine и `playbackinfopostpaywall` не тронуты. (2) **getExplorePage — параллельный swap по модулям**: tracks/albums получают `swapInExplicitTwins`/`swapInExplicitAlbumTwins` поверх preferExplicit dedupe. Concurrency-cap внутри каждого resolver'а уже стоит. (3) **Frontend — фикс пропадания E на player surfaces**: `src/lib/playerTrack.ts :: toPlayerTrack()` уже включал `explicit`; добавил `source` (в логгер). `src/hooks/usePlaybackSync.ts :: toPlayable()` теперь несёт `explicit` + `artists` + `source` (раньше дропались — корневая причина "в плеере E не показывается, в строке трека показывается"). 4 inline setTrack'а перепаяны на `toPlayerTrack`: `ExploreModules.tsx` (×2), `app/explore/list.tsx`, `app/explore/playlist.tsx`. (4) **ExplicitBadge переделан как SVG**: 10×10 viewBox, прямоугольная подложка `rx=1.6`, буква "E" — единый closed path с горизонтальными перекладинами и спайном; геометрически центрируется в `(5, 5)` независимо от шрифта/размера. Убраны все `translateY` хаки (PR #454/#457 их пытались починить — оба раза юзер жаловался что криво). Размеры 12/14/16/18/20/24 px рендерятся одинаково ровно. tone='light' → белая подложка / чёрный текст для FullscreenPlayer. (5) **MediaSession like (bonus)**: `Player.tsx` регистрирует `togglelike` / `like` / `favorite` / `favourite` / `star` action handlers (W3C спек не определяет like, но Chromium / разные платформы пробуют разные имена); каждый wrapped в try/catch — браузер либо подхватывает один из вариантов и показывает звёздочку в lock screen / Now-Playing widget, либо silently no-op. Handler читает live state из `usePlayerStore` и делает `useToggleLike().toggle(...)` — точно тот же путь что и кнопка-сердечко в плеере. iOS Safari Web App / Android Chrome PWA — best-effort. | open | (этот PR) |
| 3 | `devin/1778363267-batch-fixes` | FullscreenPlayer volume slider, solid skip icons (initial), PWA navbar inset (½), mini-player touch hit area | merged (regression) | #427 |
| 4 | `devin/1778365680-fix-batch` | revert broken skip icons, drop PWA safe-bottom inset, robust offline toast watcher | merged | #428 |

---

## Resolved decisions

(Default-ы; пользователь может переопределить комментарием на PR / в чате.)

1. **Accent color.** Везде `--color-accent: #5E6AD2`. Малиновый
   `#c2185b` остаётся **только** в плеере как `--color-accent-secondary`
   (фирменный gradient прогресс-бара). На остальных страницах — лиловый.
2. **Hero motion.** Album/Artist/Playlist hero получают лёгкий fade-up
   при входе, через `motion` (тайминг согласован с плеером).
3. **Desktop PWA top-inset.** Без изменений (десктоп не имеет чёлки,
   медиазапрос `pointer: coarse` сохраняем).
4. **OnboardingTour.** Не трогаем в этой серии PR'ов.
5. **Brandmark в Sidebar.** `Bratan Music` остаётся как константа в коде
   (бренд не локализуется).
6. **Шрифты.** `Inter` + `Instrument Serif` — без изменений.
7. **`liquid-glass` примитив.** Параметры (blur, tint, border) уже
   унифицированы (PR #383 → `--shadow-cover` token).
8. **Magenta accent.** Единый `--color-accent-magenta` (light `#d946ef`,
   dark `#e879f9`) — НЕ путать с `--color-sub-accent` (player-only).
9. **Boneyard.** Read-only архив; сюда переезжают de-prod'нутые модули,
   которые могут пригодиться как референс. Контракт — `boneyard/README.md`.

---

## Live status

- 2026-05-18T23:30Z — **Tidal Explicit follow-up — album twin
  lookup, getAlbum redirect, SVG бэйдж, MediaSession like.**
  PR `kiro/tidal-explicit-album-twin-and-badge-svg`. После PR #457
  пользователь сообщил три регрессии: (а) "сама e расположена не
  по центру квадратика, фикс ваще не сработал"; (б) "всё равно
  внутри альбома выдаёт зацензуренные версии"; (в) "не везде
  значок e показывается (как минимум в истории не показывается).
  на каких-то треках в плеере есть, на каких-то нет, хотя в
  строке трека есть". Плюс bonus-задача — кнопка лайка в системном
  Now-Playing widget (PWA/Android/iOS).

  Root causes найдены тремя путями:
  (1) PR #457 swap'ил clean→explicit ТОЛЬКО для треков; альбомы
  получали лишь same-response prefer-explicit dedupe. Search
  возвращал clean album_id, юзер кликал, `getAlbum(cleanId)`
  верно отдавал clean tracklist (контракт by-id retrieval).
  (2) Поле `explicit` дропалось в 4+ setTrack call-сайтах
  (`hooks/usePlaybackSync.ts :: toPlayable()`, inline объекты в
  `ExploreModules.tsx` ×2, `app/explore/list.tsx`, `app/explore/
  playlist.tsx`) → currentTrack.explicit становился undefined →
  лоджер плеев (`usePlayHistoryLogger`) писал 0 → recent strip
  отрисовывался без бэйджа, mini/full player тоже.
  (3) Бэйдж рендерился HTML-текстом ("E" глифом) с
  `translateY(-Xpx)` хаком для optical centering — зависело
  от шрифта, шрифт-фоллбеков и DPR; на разных размерах сидел
  криво.

  Что сделано:

  **(A) Worker — album-level twin lookup + getAlbum redirect.**
  Новые методы в `TidalService`: `swapInExplicitAlbumTwins()`
  (concurrency=4, KV-memo `tidal-explicit-album-twin:<cleanId>`
  30d), `resolveExplicitAlbumTwin()` (search-based lookup по
  `(artistId, normaliseAlbumTitle, explicit===true)` + hydrate
  через `getAlbum`+`getAlbumTracks`), `resolveExplicitAlbumIdRedirect()`
  (быстрый KV path для hot deeplink-навигации). Применено в:
  `search()`, `getArtistAlbums()`, `getArtistAlbumsAndSingles()`,
  `getArtistReleases()`, `getArtistReleasesPage()`,
  `getExploreList(albums)`, `getExplorePage()`. **Главное
  изменение**: `getAlbum()` теперь делает transparent redirect —
  если KV/lookup находит explicit twin для запрошенного clean id,
  фетч идёт по explicit id, и юзер получает uncensored
  tracklist даже по deep-link сохранённого clean'а. Это
  отличается от поведения PR #457 (там был только warn
  breadcrumb), но юзер явно попросил такое поведение
  ("если беру id explicit-альбома напрямую — uncensored;
  айдишники различные, вариации с цензурой и без"). Audio engine,
  `TidalWeb.resolveStream`, `playbackinfopostpaywall` не тронуты.

  **(B) Worker — getExplorePage применяет swap по модулям.**
  После `mapPageModule` цикла каждый module type='tracks' /
  'albums' получает `swapInExplicitTwins`/`swapInExplicitAlbumTwins`
  поверх preferExplicit dedupe. Параллельно через
  `Promise.all(modules.map(...))`. Per-row resolver уже имеет
  свой KV-memo, поэтому повторные визиты страницы — в основном
  cache hits.

  **(C) Frontend — фикс пропадания E на player surfaces.**
  - `src/lib/playerTrack.ts :: toPlayerTrack()`: добавлен
    `source` (для логгера плеев — чтоб history-recent
    группировался корректно).
  - `src/hooks/usePlaybackSync.ts :: toPlayable()`: расширен
    `PlayableTrack` тип (был
    `Pick<Track, 'id'|'title'|'artist'|'duration'> & Partial<…>`
    без `explicit`/`artists`/`source`), теперь несёт
    `explicit` + `artists` + `source` через `useTrackPlayback` и
    `useCollectionPlayback`. Это закрывает основную дыру: эти
    хуки используются в большинстве TrackItem-кнопок (album,
    artist, library, downloaded, search, daily, explore) — без
    фикса все они теряли `explicit` при setTrack.
  - 4 inline `setTrack({ id, title, artist, … })` объекта в
    `ExploreModules.tsx` (×2: row-level handlePlay + playlist
    cover button), `app/explore/list.tsx :: ListView` и
    `app/explore/playlist.tsx :: handlePlayTrack` перепаяны на
    канонический `toPlayerTrack(track)` — все player-relevant
    поля идут разом.

  **(D) ExplicitBadge — SVG-rewrite.** 10×10 viewBox,
  прямоугольная подложка `rx=1.6` `ry=1.6`, буква "E" — единый
  closed path с горизонтальными перекладинами (top y=2→3.4,
  middle y=4.5→5.5, bottom y=6.6→8) + спайн (x=2.4→3.4).
  Геометрически центрируется в `(5, 5)`: top+bottom-перекладины
  равноудалены от центральной линии, middle — точно на ней,
  спайн равен по толщине перекладинам. Никаких translateY
  хаков, никакой font-метрики, никакой DPR-зависимости. Размеры
  12 / 14 / 16 / 18 / 20 / 24 px рендерятся одинаково ровно.
  `tone='light'` сохранён (белая `rgba(255,255,255,0.92)` подложка
  + чёрный `rgba(0,0,0,0.85)` foreground для FullscreenPlayer).
  CSS-custom-properties (`var(--color-text-muted)`,
  `var(--color-bg)`) применяются через inline `style.fill` (не
  через SVG presentation attribute) — кросс-браузерная
  стабильность.

  **(E) MediaSession like (bonus).** В `Player.tsx` новый
  `useEffect` регистрирует action handlers под кандидатными
  именами `togglelike`/`like`/`favorite`/`favourite`/`star`
  (W3C MediaSession-спека `like` не определяет, но Chromium и
  разные платформы пробуют разные имена; на iOS PWA Safari/Web
  App это best-effort). Каждый `setActionHandler` обёрнут в
  try/catch — браузер либо подхватывает один из вариантов и
  показывает звёздочку в lock screen / Now-Playing widget /
  Android Auto / CarPlay (где интеграция доступна), либо
  silently no-op. Handler читает live state из
  `usePlayerStore.getState()` и вызывает `useToggleLike().toggle(...)`
  — точно тот же путь что и кнопка-сердечко в мини-плеере, так
  что состояние "лайкнуто/не лайкнуто" остаётся в синхроне с
  библиотекой пользователя. Audio engine не тронут (новый
  effect живёт в `Player.tsx`, не в `useAudioPlayer`).

  Не тронуто (по hard constraints): audio engine, security
  layer, JWT/HMAC проверки, CORS, RLS, существующие D1
  миграции, fullscreen-плеер дизайн.

- 2026-05-18T21:00Z — **Tidal Explicit реальный фикс** (PR
  `devin/tidal-explicit-revert-and-refix`). По прямому запросу
  пользователя: (а) сначала revert PR #456 одним коммитом
  (реализация в #456 не решала корневую проблему цензуры —
  search/artist top-tracks всё равно отдавали clean — плюс
  ввела регрессии в UI бэйджа); (б) baseline = состояние после
  #455, на нём ре-имплементация. Корневая причина уточнена
  пользователем: «сам поиск и то, что выдаётся в карточке
  артиста уже сразу с цензурой; если беру id explicit-альбома
  напрямую из tidal — uncensored. айдишники различные →
  существуют clean/explicit вариации, выбирается clean». То
  есть Tidal на pool-аккаунте применяет per-account фильтр
  до отдачи search/toptracks, но GET /albums/{id} с конкретным
  id возвращает то, что просили. Что сделано:
  (1) **Worker — три слоя защиты против clean-substitution**.
  `TidalApi.commonParams()` пробрасывает
  `includeExplicit=true&explicitContent=true` через каждый
  search/album/artist/page endpoint + UA/headers поза
  `listen.tidal.com` Web client (`Origin: https://listen.tidal.com`,
  Chrome UA, Accept-Language en) — критично: Tidal honor'ит
  request-level explicit overrides только когда запрос
  выглядит как Web client; mobile UA (раньше) даёт
  ignore-overrides+fallback на per-account фильтр.
  `preferExplicitAlbums` / `preferExplicitTracks` —
  same-response dedupe в search / artistTopTracks /
  artistAlbumsAndSingles / artistReleases / artistAlbums /
  playlistTracks: группирует по
  `(artistId, normaliseAlbumTitle(title))` для альбомов и
  `(artistId, title, durationBucket=round(d/2))` для треков
  с sentinel keys для треков без artistId/duration; drop'ает
  clean twin когда explicit twin есть в том же ответе.
  **NEW — `swapInExplicitTwins()`**: ключевой missing piece —
  для каждого clean трека в результате search /
  artistTopTracks / playlistTracks делает active per-track
  Tidal-search lookup чтобы найти explicit twin id, hydrate'ит
  через `getTrack`, substitute'ит на тот же индекс,
  concurrency=4, KV-memo `tidal-explicit-twin:<cleanId>` →
  `<explicitId>` или `__none__` 30 days. Это решает кейс «в
  самом search Tidal вернул только clean variant» — раньше
  PR #456 deduplicate'ил в пределах одного response, что не
  помогало когда Tidal вообще не возвращал explicit вариант.
  Audio engine не тронут (нет вмешательства в
  `TidalWeb.resolveStream` / `playbackinfopostpaywall`).
  `getAlbum()` НЕ swap'ит — albumId = контракт пользователя,
  только warn breadcrumb на clean-suffix titles.
  `normaliseAlbumTitle` strip'ает `clean|explicit|edited`
  через `\b(?:...)\b` чтобы false-positive'ы
  (`Cleaning Up Mix`, `Editions`, `Cleaner Cut`) не
  collapse'ились.
  (2) **D1 миграция 0029 + history endpoint**:
  `play_history.explicit INTEGER NOT NULL DEFAULT 0` →
  `POST /history/play` пишет, `GET /history/recent` отдаёт
  `MAX(explicit)`, frontend `usePlayHistoryLogger` +
  `PlayLogPayload` + `home.toTrack(r)` пробрасывают флаг
  через — recent-strip badge теперь зажигается.
  (3) **ExplicitBadge переделан**: убран хардкод
  `translateY(-0.5px)` на ВНЕШНЕМ span (он desync'ил
  бэйдж с baseline'ом текста — был bug пользователь жаловался
  «E расположен криво и имеет слишком большой отступ»). Новая
  геометрия — outer box `padding:0`/`lineHeight:1`/`overflow:hidden`
  без translate, inner span `display:block`+`translateY(-Xpx)`
  где X scales 0.5/0.5/0.75/1.0/1.0/1.25 px по бакетам
  ≤12/≤14/≤16/≤18/≤22/>22 — E теперь точно по геометрическому
  центру при любом размере (12 / 14 / 18 / 20 / 24 px).
  (4) `gap-1.5` → `gap-1` в compact contexts: home
  `PreviewStripRow`, `AlbumCard`, `BannedListDialog`,
  `ExploreModules` playlist row, `PlaylistTrackItem`,
  `QueueDialog`, `TrackItem`, mini-Player, `MobileBottomDock`.
  Hero контексты сохранили `gap-2` (AlbumPage, FullscreenPlayer
  h1, Track page hero, Rooms now-playing).
  (5) `src/app/explore/playlist.tsx`: hero h1 теперь
  `flex flex-wrap items-center gap-2` + `<ExplicitBadge size={20}>`.

- 2026-05-09T22:30Z — батч follow-up фиксов (PR
  `devin/1778365680-fix-batch`). После PR #427 пользователь
  сообщил три регрессии: (а) prev/next иконки в плеерах
  «получились совершенно другие» — оказалось, lucide-react
  `SkipBack`/`SkipForward` собраны из `<polygon>` + `<line>`,
  и `strokeWidth={0}` уничтожал 1-D полосу. Откатил `strokeWidth=0`,
  оставил `fill="currentColor"` — треугольник solid, вертикальная
  полоса с дефолтной обводкой; (б) bottom navbar в PWA нужно ниже
  — убрал `var(--pwa-safe-bottom)/2` инсет полностью, теперь
  `bottom-4`/`sm:bottom-6` симметрично боковым полям; (в) тосты
  «вы офлайн / вы онлайн» перестали показываться в PWA — переписал
  `OfflineToastWatcher` на прямые `online`/`offline` event
  listener'ы, добавил `visibilitychange` re-sync (известный
  iOS PWA edge case с пропущенными событиями), `t` через ref —
  смена локали больше не пересубскрайбит слушатели. Дополнительно
  верифицировал что фикс lyrics из PR #425 задеплоился (поля
  `fetchedAt`, `isRightToLeft` в актуальном бандле); если у юзера
  не работает — нужен один cold-open PWA, чтобы workbox с
  `skipWaiting`+`clientsClaim` подхватил новый SW.

- 2026-05-09T21:30Z — старт офлайн-lyrics батча (PR
  `devin/1778362098-offline-lyrics`, merged как #425). Расширил
  `OfflineTrack` новым опциональным полем `lyrics: OfflineLyrics`,
  добавил `fetchLyricsPayload` рядом с `fetchCoverBlob` в
  `streamResolver.ts`, в `downloads.ts :: runTrack` запускаем
  лирику параллельно с аудио (нулевая прибавка к wall-clock),
  записываем в IDB при создании / обновлении строки трека.
  `useLyrics` теперь сначала смотрит в IDB, потом сеть, и при
  успешной сетевой загрузке backfill-ит старые офлайн-строки без
  лирики. Audio engine не тронут (изменения только в путях
  загрузки и в lyrics-хуке).

---

## Handoff log

| Когда (UTC)       | Кто (Devin session)                          | Что сделал                                                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-08 ~11:30 | (исторический)                               | Foundation + knowledge base + диалоги/safe-area/collection-pages (PR #373..#396, merged). Полный лог — в `git log`. |
| 2026-05-08 ~19:30..20:25 | `4dbcd574a1924b858d11b3b425ef8691` (предыдущий) | PR #400..#406 + tracker sync — language-switcher fix, PageHero polish, Library/Search/Rooms redesign, Admin UserCard, Boneyard archive. Все смерджены. |
| 2026-05-08 ~21:25 | `2fa86d7feed2415c825633b09851548a` (предыдущий) | Boneyard skeletons — заменил оставшиеся `<PageLoader>` (7 страниц) на скелетоны, удалил компонент `PageLoader.tsx`, добавил `PlaylistRowSkeleton` / `PlaylistRowListSkeleton` в `Skeleton.tsx`. Tracker pruned. |
| 2026-05-09 ~21:30 | `33edb7b9174a455d99183f00e71a4b4d` (предыдущий) | Offline lyrics — `OfflineTrack.lyrics`, `fetchLyricsPayload`, IDB-first `useLyrics` с back-fill сетевого ответа. Подготовил roadmap к 4-задачному батчу (lyrics offline / mobile lyrics layout / volume slider responsiveness / solid skip icons). PR #425 merged. |
| 2026-05-09 ~21:50 | (предыдущий, batch-fixes) | Volume slider responsiveness + solid skip icons + PWA bottom inset (½) + mini-player touch hit area. PR #427 merged, но `strokeWidth={0}` на skip-иконках стирал 1-D `<line>` элемент → пользователь сообщил регрессию иконок. |
| 2026-05-09 ~22:30 | `d8eeb192309c4c2d95225d362c18fa37` (текущий) | Follow-up батч: откатил `strokeWidth={0}` на SkipBack/SkipForward (Player / FullscreenPlayer / MobileBottomDock), убрал `var(--pwa-safe-bottom)/2` из bottom-инсета (теперь `bottom-4`/`sm:bottom-6` = боковым полям), переписал `OfflineToastWatcher` на прямые `online`/`offline` event listener'ы + `visibilitychange` re-sync для iOS PWA, `t` через ref. Верифицировал, что lyrics fix (PR #425) реально задеплоился. |

| 2026-05-17 ~09:30 | `4ddbc0d8c87e42228ab0e4620df9fd91` (текущий) | Daily playlists backfill fix — 3-phase backfill pipeline, bumped oversample multipliers, multi-slug discover padding, multi-mood-page mood fallback. Причина бага: cascading shrinkage — dislikes + cross-variant claimed set + artist cap в rerank выжимали пулы до <50, а single-pass genre backfill (5 слагов) не мог скомпенсировать. |
| 2026-05-17 ~10:40 | `4ddbc0d8c87e42228ab0e4620df9fd91` (текущий) | Recs overhaul — liked tracks as primary taste signal. TasteProfile v3 (likedTrackIds), wave() seeds from liked+completed, SEED_FAN_OUT 5→8, multi-credit artist dislike in rerank, all daily playlist variants seed from liked-track radio, removed generic genre fallback. PRs #447-#451 merged. |
| 2026-05-18 ~21:00 | (текущий) | **Revert PR #456 + Tidal Explicit реальный фикс цензуры** — реверт #456 одним коммитом (baseline = post-#455), затем три слоя защиты против clean-substitution: `commonParams` через все catalogue endpoints + Web-client UA/Origin/Referer, response-side `preferExplicitTracks/Albums` dedupe, **active per-track twin lookup `swapInExplicitTwins()` с KV-memo `tidal-explicit-twin:`** — это ключевой missing piece. D1 миграция 0029 (`play_history.explicit`) + history endpoint INSERT/SELECT, frontend `home.toTrack`/`PlayLogPayload`/`usePlayHistoryLogger` пробрасывают флаг — recent-strip badge зажигается. ExplicitBadge переделан: убран buggy outer translate, inner span lift размер-зависимый (0.5/0.5/0.75/1/1/1.25 px). gap-1.5→gap-1 в compact rows. Hero на `explore/playlist.tsx` получил badge. Audio engine не тронут. |

| 2026-05-24 ~13:00 | Viktor (autonomous) | **Backend rewrite TS → Go — старт.** Ветка `feat/go-backend-rewrite`, новая директория `api-go/` рядом с `worker/`. Первый коммит: полный scaffold (config / db pool / Redis / MinIO / migrations) + middleware (CORS / rate-limit / JWT auth) + auth-примитивы (HS256 JWT, Telegram WebApp HMAC, AES-GCM session crypto — каждый покрыт юнит-тестами) + готовые роуты `/health`, `/auth/whoami`, `/user/*`, `/history/*`, `/playlists/*`, `/library/*`. Все остальные 19 префиксов смонтированы и отвечают `501 Not Implemented` — TS `worker/` остаётся live fallback (deploy workflow строит **обе** Docker-имаджа, `api-go` сидит на :3001 рядом с `api:3000` для верификации). Решения, зафиксированные с владельцем: JWT_SECRET ротируется при cut-over (все юзеры релогинятся), Tidal session-пул переливаем заново через admin device-flow, WS rooms — in-memory hub + Redis pub/sub. Следующие коммиты в тот же PR: Tidal (auth/api/web/pool/explicit-twins) → search/tracks/albums/artists → rooms WS → recs/daily/taste/ai → admin/bot/cron. Cut-over план — в `api-go/STATUS.md`. |

| 2026-05-24 ~17:00 | Viktor (autonomous) | **api-go: Tidal catalogue + stream + device-flow.** `internal/tidal/` пакет: `auth.go` (single-account + `tidal_session` row id=1, refresh-token candidate-client walk over known TV clients, AES-GCM session crypto через `authz.EncryptSession`/`DecryptSession`), `api.go` (Bearer + Web-client UA/Origin/Referer, 401→force-refresh-retry, `commonParams`: countryCode/locale/deviceType=BROWSER/includeExplicit=true; methods: Search/GetTrack/GetAlbum/GetAlbumTracks/GetArtist/GetArtistTopTracks/GetArtistAlbums/GetSimilarArtists/GetTrackRadio/GetArtistRadio/GetPlaylistTracks/GetTrackLyrics), `stream.go` (playbackinfopostpaywall @ LOSSLESS + one-rung-down soft retry, bts manifest decode, DASH → explicit-TODO error), `device.go` (StartDeviceAuth + PollDeviceAuth с `tidal_device_codes` mapping), `normalize.go` (CoverURL/VideoCoverURL/ArtistImageURL builders, MapTrack/MapAlbum/MapArtist + dedupeArtistRefs + UnwrapBucket). `TidalService` wired (Auth+API на App). Real routes в `routes/tidal_routes.go`: `/search/{,/tracks,/albums,/artists}`, `/tracks/:id`, `/tracks/:id/stream` (302 → playable URL, `?json=1` для raw payload), `/tracks/:id/lyrics`, `/albums/:id` + `/tracks`, `/artists/:id` + top-tracks/albums/singles/releases (concat), `/admin/tidal/accounts|start|poll`. Out of scope first-pass (TODO): explicit-twin lookup, KV-style track-quality memo, openapi.tidal.com quality discovery, DASH/HI_RES manifest decoding, multi-account pool с LRU. `go build` + `go test` green. |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
