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
| 20 | `(этот PR)` | **Tidal Explicit double-fix: prefer-explicit search variant + history badge propagation + glyph optical centering.** Двухчастный fix после PR #452/#454. (a) Worker — defence-in-depth: новый `commonParams` helper в `TidalApi` пробрасывает `includeExplicit=true&explicitContent=true&useEditedLyrics=false` через каждый search/album/artist endpoint (был только на lyrics fallback). (b) Worker — response-side prefer-explicit dedupe в `TidalService.search` / `getArtistAlbumsAndSingles` / `getArtistReleases`: группирует по `normalisedTitle × artistId`, выбирает `explicit:true` вариант если Tidal вернул оба. `releaseDate` из ключа выкинут (v2 fixup, Tidal back-fill'ит clean editions с другой датой → date-tied equivalence silently bypassed dedupe). `normaliseAlbumTitle` теперь strip'ает `clean|explicit|edited` токены (v2 fixup). (c) D1 миграции на `play_history` НЕ заведены — поэтому в этом PR home recent-strip badge **остаётся пустым**: `toTrack(r)` пробрасывает `r.explicit` как forward-looking plumbing, но `/history/recent` payload поле не несёт. Чтобы badge появился — нужна 0029-миграция `ALTER TABLE play_history ADD COLUMN explicit` + проводка через PlayBody / SELECT / response, ИЛИ JOIN на `tracks`. (d) Frontend — `ExplicitBadge` оптическое центрирование: вместо одного хардкоженного `translateY(-0.5px)` (дрейфил при 18/24 px) теперь size-scaled inner-`<span>` с `translateY(-0.25/-0.5/-0.75/-1px)` для size ≤12 / ≤16 / ≤18 / >18 (v2 fixup сплит'нул 18 px в свой bucket чтобы FullscreenPlayer не читался высоко). (e) Mini-player + track-row title gap затянут с `gap-1.5` → `gap-1` (Player.tsx, MobileBottomDock, TrackItem, PlaylistTrackItem, QueueDialog, BannedListDialog) — hero контексты сохранили `gap-2`. (f) Бэйдж добавлен на hero `src/app/explore/playlist.tsx` (Tidal editorial playlist). (g) `useEditedLyrics=false` сознательно оставлен в `commonParams` (Tidal задокументирован как ignore-unknown-params; без staging нельзя прогнать smoke-test против всех endpoint-валидаторов). (h) `key` field в bucket-entries `preferExplicitTracks` удалён как dead (Array.find walks `titleKey / artistId / duration` напрямую). | open | (этот PR) |
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

- 2026-05-18T19:14Z — Tidal Explicit double-fix батч (commits на
  ветке локально, выйдет одним PR). Корень проблемы из юзер-фидбэка
  после PR #454: (1) поиск и top-tracks артиста всё ещё иногда
  возвращали clean-вариант альбома потому что filter-toggle на
  pool-аккаунте может молча упасть; (2) бэйдж E не появлялся в home
  recent-strip (worker `play_history` не хранит explicit, а
  фронтовый `toTrack` мапер дропал поле даже если payload его нёс);
  (3) бэйдж оптически плыл вниз при 18/24 px — старый хардкод
  `translateY(-0.5px)` калибровался только под 14 px. Что сделано:
  (а) **defence-in-depth в worker**: новый `commonParams` helper в
  `TidalApi.ts` подмешивает
  `includeExplicit=true&explicitContent=true&useEditedLyrics=false`
  на каждый search/album/artist call (раньше эти параметры стояли
  ТОЛЬКО на lyrics fallback chain); (б) **response-side
  prefer-explicit dedupe** в `TidalService.search` /
  `getArtistAlbumsAndSingles` / `getArtistReleases` — группирую по
  `normaliseTitle(title) × artistId`, выбираю `explicit:true`
  вариант если Tidal вернул оба (v2 fixup: `releaseDate` из ключа
  выкинут — Tidal back-fill'ит clean editions с другой датой);
  (в) **D1 миграции на `play_history` НЕ заведены**, поэтому
  в этом PR home recent-strip badge **остаётся пустым** —
  `/history/recent` payload не несёт `explicit`. Фронтовый
  `toTrack(r)` пробрасывает `r.explicit` как forward-looking
  plumbing (no-op до 0029-миграции или JOIN'a на `tracks`).
  Комментарий в `worker/src/routes/history.ts` переписан, чтобы
  явно признать этот пробел; (г) **`ExplicitBadge`**: убрал
  хардкод `translateY(-0.5px)` на внешнем span, обернул литерал
  «E» во внутренний `<span style="display:block;
  transform: translateY(-Xpx)">` где X масштабируется
  (0.25/0.5/0.75/1 px для size ≤12 / ≤16 / ≤18 / >18; v2 fixup
  сплит'нул 18 px в свой bucket); (д) **gap затянут с
  `gap-1.5` → `gap-1`** на title row в Player.tsx (mini-player),
  MobileBottomDock, TrackItem, PlaylistTrackItem, QueueDialog,
  BannedListDialog; hero-контексты (AlbumPage / FullscreenPlayer /
  Track page / Rooms / AlbumCard / ExploreModules playlist tile)
  сохранили `gap-2`; (е) **бэйдж на hero `src/app/explore/playlist.tsx`**
  (Tidal editorial playlist) добавлен по паттерну AlbumPage —
  `flex flex-wrap items-center gap-2` + `<ExplicitBadge size={20}>`.
  v2 review-fixup (2026-05-18 ~19:30 UTC): семантик-ревьюер
  выявил 6 issue. Исправлено 5: (i1) misleading recent-strip
  claim снят из этого Live status / daily-changes / `history.ts`
  comment; `toTrack` оставлен как forward-looking; (i2)
  `releaseDate` выкинут из ключа `preferExplicitAlbums`;
  (i3) `normaliseAlbumTitle` теперь strip'ает
  `clean|explicit|edited` чтобы `(Clean)` / `[Explicit]` /
  `(Edited Version)` коллапсировали в общий bucket; (i5) badge
  18 px lift сплит'нут в свой bucket (0.75 px) чтобы
  FullscreenPlayer не читался высоко; (i6) dead `key` field
  в `preferExplicitTracks` buckets удалён. Не исправлен (i4):
  `useEditedLyrics=false` оставлен в `commonParams` без
  изменений — Tidal задокументирован как ignore-unknown-params,
  staging-канала для smoke-test против всех endpoint-валидаторов
  нет, консервативно оставляем. Audit:
  AdminUserDetailDialog рендерит recent-plays через кастомный inline
  template, но `AdminUserStatsRecentPlay` тип не несёт `explicit` —
  surface low-priority, отложил.

  v3 review-fixup (2026-05-18 ~20:00 UTC): семантик-ревьюер
  вернул 3 follow-on issue, все обработаны в одном fix-up
  commit'е. (v2-i1) Residual misleading copy в handoff
  bullet'е daily-changes переписан — recent-strip badge не
  зажигается в этом PR, нужна 0029-миграция (`ALTER TABLE
  play_history ADD COLUMN explicit`) или JOIN на `tracks`
  в `GET /recent`. (v2-i2) `preferExplicitAlbums`
  over-collapse на `search` / `getArtistAlbumsAndSingles`
  (где `dedupeAlbums` не бежит) — выбрана опция (a):
  JSDoc на `preferExplicitAlbums` дополнен «Behavioural
  note» абзацем, документирующим что helper сам
  работает как Tier-2 коллапсер на этих путях, при
  равных explicit-флагах побеждает first-seen
  (порядок-зависимо от Tidal). Опция (b) с secondary
  disambiguator (`releaseType` / `numberOfTracks`) отложена
  до конкретной жалобы на missing deluxe в search.
  (v2-i3) `\bclean` / `\bexplicit` regex word-prefix gap —
  обернул всю alternation в `\b(?:...)\b` сразу
  (deluxe|expanded|remastered|anniversary|extended|special|
  edition|version|bonus|reissue|clean|explicit|edited),
  не только новые три токена. `(Cleaning Up Mix)` /
  `(Cleaner Cut)` / `(Explicitly Mine)` / `(Versioning
  Mishap)` / `(Editions)` теперь не collapse'ятся;
  legitimate `(Clean)` / `(Deluxe)` / `(Remastered 2021)` /
  `(Edited Version)` продолжают работать. Hazard
  `(Clean Bandit Remix)` (collab с space-after-`clean`)
  остался — не fix'абельно на regex-уровне без
  context-sensitive логики, откладываем.

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
| 2026-05-18 19:14 | `(текущий)` | Tidal Explicit double-fix (наследует PR #452 / #454). Worker: `commonParams` в `TidalApi` (defence-in-depth, includeExplicit/explicitContent/useEditedLyrics на каждый search/album/artist call) + response-side prefer-explicit dedupe в `TidalService.search` / `getArtistAlbumsAndSingles` / `getArtistReleases` (groups by `normaliseTitle(title) × artistId × releaseDate`); `play_history` без миграции — explicit на recent-strip из cached track-snapshot. Frontend: `ExplicitBadge` оптическое центрирование заменено на size-scaled `translateY` (был один хардкоженный -0.5px который дрейфил на 18/24 px), title-row gap затянут с `gap-1.5`→`gap-1` в Player.tsx mini-player / MobileBottomDock / TrackItem / PlaylistTrackItem / QueueDialog / BannedListDialog (hero контексты сохранили `gap-2`), бэйдж добавлен на `src/app/explore/playlist.tsx` hero, `home/page.tsx :: toTrack(r)` пробрасывает `explicit: r.explicit`. Один PR на всё. |
| 2026-05-18 19:30 | `(текущий, v2 review-fixup)` | Семантик-ревью вернул 6 issue. Fix-up commit на тот же working tree. (i1) Misleading recent-strip claim удалён — `history.ts` comment, tracker Live status, daily-changes явно говорят, что recent rows пока НЕ несут `explicit` (фронт-проводок `toTrack(r)` оставлен как forward-looking plumbing до 0029-миграции или JOIN'a). (i2) В `preferExplicitAlbums` ключ группы упрощён с `(normalisedTitle, artistId, releaseDate)` до `(normalisedTitle, artistId)` — Tidal back-fill'ит clean editions с другой датой. (i3) `normaliseAlbumTitle` regex дополнен токенами `clean\|explicit\|edited`, чтобы `(Clean)` / `[Explicit]` / `(Edited Version)` коллапсировали в общий bucket. (i4) `useEditedLyrics=false` сознательно оставлен в `commonParams` (Tidal ignore-unknown-params, staging-канала для smoke-test нет, консервативно оставляем). (i5) `ExplicitBadge` lift сплит'нут: `≤16 → 0.5 px`, `≤18 → 0.75 px`, `>18 → 1 px` — FullscreenPlayer (size=18) больше не lift'ится на 1 px. (i6) Dead `key` field в `preferExplicitTracks` bucket entries удалён. Validation green: root + worker `lint` + `typecheck` + `build` все exit 0. |
| 2026-05-18 20:00 | `(текущий, v3 review-fixup)` | Семантик-ревью прогнан ещё раз; вернул 3 follow-on issue. Все обработаны в одном fix-up commit. (v2-i1) Misleading copy в «Что важно знать следующему агенту» tail-bullet'е daily-changes (всё ещё писал «читается из cached snapshot») переписан в стиле v2 caveat: recent-strip badge не зажигается в этом PR, нужна 0029-миграция или JOIN на `tracks`. (v2-i2) `preferExplicitAlbums` over-collapse на `search` / `getArtistAlbumsAndSingles` — выбрана опция (a) из двух предложенных ревьюером: JSDoc на helper'е дополнен абзацем, документирующим что без `dedupeAlbums` рядом он сам работает Tier-2 коллапсером (paired standard + deluxe схлопываются, при равных explicit-флагах побеждает first-seen). Опция (b) с secondary disambiguator отложена до конкретной жалобы. (v2-i3) `\bclean` / `\bexplicit` regex word-prefix gap — `\b` cap прикручен ко всей alternation сразу (`\b(?:deluxe\|expanded\|...\|clean\|explicit\|edited)\b`), не только к новым трём токенам, потому что `version` / `edition` тоже имели тот же gap pre-PR. `(Cleaning Up Mix)` / `(Cleaner Cut)` / `(Explicitly Mine)` / `(Versioning Mishap)` / `(Editions)` больше не collapse'ятся. Hazard `(Clean Bandit Remix)` (collab) остался — не fix'абельно на regex-уровне. Validation green: root + worker `lint` + `typecheck` + `build` все exit 0. |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
