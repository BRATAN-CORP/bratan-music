# Frontend Refactor — Live Tracker

> Этот файл живёт в репо и обновляется в каждом PR. Любой агент (Devin / Claude),
> который перехватит работу, начинает с этого файла. История перехватов — внизу.
>
> Дополняет (но не заменяет) [`/REFACTOR_PROGRESS.md`](../../REFACTOR_PROGRESS.md) —
> там лежит изначальный план предыдущего агента, здесь — живой статус и
> уточнения по ходу работы.

---

## Inputs от пользователя (verbatim, RU)

> Твоя задача — рефакторинг кода. В коде после действий множества агентов
> сохранилось куча мусорного кода (возможно), а также огромное количество
> многострочных комментариев, которые мешают воспринимать информацию,
> т.к. некоторые уже могли устареть. Их можно стирать или сокращать.
>
> Обновить фронтенд: вынести цвета/отступы/прочее в глобальные переменные;
> везде использовать одинаковые компоненты; меньше хардкода и повтора кода
> модалок; интерфейс к единому стилю; акцентные цвета — везде одинаковые;
> везде `i18n`, без хардкода языка; точечные исправления багов
> (только если уверен, что не сломает); унифицировать код, сделать
> гибче и масштабируемее.
>
> **Не сломать плеер** (анимации/EQ/fullscreen/lyrics — оставить как есть).
> Страницы playlists / authors / albums привести к плеер-стилю с адаптивом
> на маленьких экранах. Единые safe-zones для PWA на iOS / Android.
>
> Каждая задача — отдельный PR. После каждого PR — апдейт этого файла.

## Hard constraints (не нарушаем)

- Не трогаем audio engine: `useAudioPlayer`, `Player.tsx`, `FullscreenPlayer.tsx`,
  визуализатор / EQ / lyrics.
- Не ослабляем безопасность: HMAC Telegram WebApp, JWT auth, CORS allowlist,
  RLS, parameterized SQL.
- Не модифицируем уже применённые D1-миграции.
- Не делаем force-push в main.
- Каждый PR держим скоупанным — лучше шесть маленьких чем один большой.

---

## Roadmap

| #   | Branch                                       | Title                                                | Status   | PR                                                              |
| --- | -------------------------------------------- | ---------------------------------------------------- | -------- | --------------------------------------------------------------- |
| 1   | `devin/1778237470-refactor-foundation`       | Foundation: tokens + Modal/Sheet/PageHero/IconButton | merged   | [#373](https://github.com/BRATAN-CORP/bratan-music/pull/373)    |
| 0.5 | `devin/1778241532-knowledge-base`            | Obsidian-style knowledge base (AGENTS.md + docs/)    | merged   | [#378](https://github.com/BRATAN-CORP/bratan-music/pull/378)    |
| 2   | `devin/1778242810-refactor-dialogs`          | Migrate dialogs to `<Modal>`/`<Sheet>`               | merged   | [#379](https://github.com/BRATAN-CORP/bratan-music/pull/379)    |
| 3   | `devin/1778243660-refactor-safe-area`        | Unified PWA safe-area handling                       | merged   | [#380](https://github.com/BRATAN-CORP/bratan-music/pull/380)    |
| 4   | `devin/1778244500-refactor-collection-pages` | Album/Artist/Playlist → `<PageHero>` + IconButton    | merged   | [#381](https://github.com/BRATAN-CORP/bratan-music/pull/381)    |
| 5   | `devin/1778244750-refactor-i18n-audit`       | Eliminate residual hardcoded language strings        | merged   | [#382](https://github.com/BRATAN-CORP/bratan-music/pull/382)    |
| 6   | `devin/1778244723-refactor-polish`           | --shadow-cover token, hero shadows                   | merged   | [#383](https://github.com/BRATAN-CORP/bratan-music/pull/383)    |
| 7   | `devin/1778244958-refactor-cleanup`          | Trim historical PR# references from inline comments  | merged   | [#384](https://github.com/BRATAN-CORP/bratan-music/pull/384)    |
| 8   | `devin/1778246144-refactor-daily-variant`    | DRY daily-playlist variant theme + plural helper     | merged   | [#385](https://github.com/BRATAN-CORP/bratan-music/pull/385)    |
| 9   | `devin/1778247026-refactor-shadow-accent-token` | Tokenize accent-glow elevation pair (`--shadow-accent`)  | merged   | [#386](https://github.com/BRATAN-CORP/bratan-music/pull/386)    |
| 10  | `devin/1778247302-refactor-accent-magenta-token` | Unify accent→magenta gradient via `--color-accent-magenta` | merged | [#387](https://github.com/BRATAN-CORP/bratan-music/pull/387) |
| 11  | `devin/1778247755-refactor-stale-token-refs` | Align stale `--color-on-accent` / `--color-warning` refs and `rgba(99,102,241,…)` accent-glow fallbacks with `_tokens.scss` | merged | [#388](https://github.com/BRATAN-CORP/bratan-music/pull/388) |
| 12  | `devin/1778248978-kv-write-budget`           | KV write-budget fix: dedup genre-tracks helper + 7d TTLs                                                                  | merged | [#389](https://github.com/BRATAN-CORP/bratan-music/pull/389) |
| 13  | `devin/1778249618-meta-chip-component`       | Extract `<MetaChip>` for the 9 "info pill" duplicates (eyebrows above section H2s)                                        | merged | [#390](https://github.com/BRATAN-CORP/bratan-music/pull/390) |
| 14  | `devin/1778250082-eyebrow-dedup`             | Migrate 9 inline `Eyebrow`-pattern spans to existing `<Eyebrow>` (text-xs uppercase tracking-[0.25em])                    | merged | [#391](https://github.com/BRATAN-CORP/bratan-music/pull/391) |
| 15  | `devin/1778250754-eyebrow-polymorphic`       | Polymorphic `<Eyebrow as=...>` + dedup 3 link-eyebrows on `releases`/`explore-list`/`explore-slug`                         | merged | [#393](https://github.com/BRATAN-CORP/bratan-music/pull/393) |
| 16  | `devin/1778252146-ios-pwa-mediasession-sync` | iOS PWA Control Center play/pause sync — listen to native `<audio>` `play`/`pause`, reflect onto `mediaSession.playbackState` + store     | merged | [#394](https://github.com/BRATAN-CORP/bratan-music/pull/394) |
| 17  | `devin/1778252772-comment-cleanup-pass`      | Comment cleanup pass — collapse multi-paragraph narrative docstrings in 10 non-audio-engine files (preserve rationale / quirk / edge-case docs) | open | [#395](https://github.com/BRATAN-CORP/bratan-music/pull/395) |

`#7` — отдельный pass под явный запрос пользователя ("куча мусорного кода и
многострочных комментариев"). Делаем после полировки, чтобы не удалять то,
что ещё используется в активных рефакторингах.

`#8` — продолжение запроса "меньше хардкода и повтора кода": один и тот же
25-строчный `VARIANT_THEME` и почти идентичный `dailyTrackUnitKey` жили в
`app/home/page.tsx` и `app/daily/page.tsx`. Вынесены в `src/lib/dailyVariant.ts`.

`#9` — продолжение того же запроса + "акцентные цвета везде одинаковые":
пара inline-теней `shadow-[0_2px_8px_-2px_var(--color-accent-glow)]` /
`shadow-[0_4px_16px_-4px_var(--color-accent-glow)]` дублировалась в
`Button` (primary), `MobileBottomDock` (play) и `ArtistPicker`
(selected badge). Вынесена в `--shadow-accent` / `--shadow-accent-strong`.

`#10` — продолжение того же запроса + "акцентные цвета — везде одинаковые":
три разных оттенка магенты в "accent → magenta" градиенте — `fuchsia-500`
(#d946ef) в `rooms/list` и `ai/page`, плюс CSS-named `fuchsia` (#ff00ff)
в `QuickPrefsBar`. Сведено к единому токену `--color-accent-magenta`
(light: `#d946ef`, dark: `#e879f9`). Принципиальное решение: НЕ
переиспользуем `--color-sub-accent` (#c2185b) — он зарезервирован за
плеером по AGENTS.md decision #1.

`#11` — в коде жили ссылки на токены, которых НЕТ в `_tokens.scss`,
всегда резолвившиеся в хардкодный fallback:
- `--color-on-accent` (5 сайтов) — правильное имя `--color-text-on-accent`.
  Сейчас рендерится `white` (fallback). После — реальный токен
  (тоже `#ffffff`, но в единой схеме с остальными 8 сайтами
  кода, которые уже используют `--color-text-on-accent`).
- `--color-warning` (`AdminHealthPanel`) — правильное имя `--color-warn`.
  Раньше panel рендерился в fallback `#d97706` (Tailwind
  amber-600). Сейчас — `#b45309` light / `#fbbf24` dark, то что
  было задумано в design-системе.
- Fallback на `--color-accent-glow` (`rgba(99,102,241,0.45)` — это
  indigo-500 от бывшего бренда, до перехода на текущий #5E6AD2)
  жил в 3 местах (`home`, `QuickPrefsBar`, `LanguageSwitcher`).
  Fallback никогда не срабатывал (токен всегда определён), но
  вводил в заблуждение при grep по цветам. Убран — браузер
  сам остановится на transparent если token исчезнет (в быту
  это невозможно — `_tokens.scss` импортится в `globals.scss`).

`#12` — реакция на Cloudflare-алерт "90% of daily KV operations limit"
(981 / 1000 writes за день). Воркер пишет в `SESSIONS` namespace —
кеши Tidal-сидов и radio-pool'ов на каждый "холодный" слаг. Аудит
показал двух виновников:
1. **Дублирование** `genre_seed_tracks:<slug>` — один и тот же
   ключ писали независимо `RecommendationService.candidatesFromGenres`
   и `DailyPlaylistService.tracksFromGenre`, оба с TTL 12h. На
   cron-перегенерации daily-плейлистов + любом `wave()` это давало
   2× записей за каждый запрос.
2. **Слишком короткие TTLs** на медленно меняющихся сидах:
   - `genre_seed_tracks:` — 12h
   - `track_radio:` — 24h
   - `artist_seed_tracks:` — 12h
   - `rec_suggested_artists:v1` — 24h
   - `tidal-track-formats:` (negative cache) — 1h
   Tidal-стороны меняют эти страницы редко, а 1000 writes/day — это
   жёсткий cap на free tier. Подняли все долгожители до **7 дней**
   (`CACHE_TTL_S` в новом `worker/src/services/seedCache.ts`); negative
   cache discovery — до 24h. Эффект: -5–7× на write-rate в стационаре.
   Чувствительный к свежести `discovery_breaker` (1h) и `track_quality`
   (30d) не трогаем.
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
7. **`liquid-glass` примитив.** Унифицируем параметры (blur, tint,
   border) в PR 6 (polish).

---

## Live status

- 2026-05-08T11:55Z — knowledge base + tracker созданы (PR #378). CI зелёный.
- 2026-05-08T12:33Z — PR #2 (dialogs, #379) открыт. 11 диалогов мигрированы
  на `<Modal>`/`<Sheet>`. CI зелёный.
- 2026-05-08T12:36Z — PR #3 (safe-area, #380) открыт. Все `env(safe-area-*)`
  переведены на `var(--pwa-safe-*)`; добавлены `mt-/mb-/top-/bottom-/left-/
  right-safe` утилиты. База на PR #2 — GitHub перетаргетит на main после
  мерджа.
- 2026-05-08T12:43Z — PR #4 (collection pages, #381) открыт. Album / Artist
  / Playlist hero мигрированы на `<PageHero>` + `<IconButton>`; playlist
  получил ambience-слой; cover sizing адаптивен. База на PR #3.
- 2026-05-08T12:51Z — PR #5 (i18n audit, #382) открыт. Локализованы 4
  оставшихся хардкодных aria-label (`Notifications`, `online`, `Saved
  offline`, `Загрузка`). Добавлены ключи `common.notifications/online/
  savedOffline` и `offline.downloading{Percent}`. База на PR #4.
- 2026-05-08T12:55Z — PR #6 (polish, #383) открыт. Введён
  `--shadow-cover` токен (light + dark), 6 дублирующихся
  `shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55)]` строк заменены на
  `shadow-[var(--shadow-cover)]` (album/artist/playlist hero +
  downloaded library swatch). База на PR #5.
- 2026-05-08T12:58Z — PR #7 (cleanup, #384) открыт. Удалены
  устаревшие ссылки на номера PR (#120, #287, #131) из
  многострочных комментариев в `Marquee`, `TiltCard`,
  `app/rooms/list.tsx`, `app/explore/playlist.tsx` — фиксы давно
  смерджены, нарратив "первая попытка / надёжный фикс" заменён на
  чистое описание текущего поведения. База на PR #6.
- 2026-05-08T13:0?Z — PR #2..#7 смерджены в `main`
  (#379 → #380 → #381 → #382 → #383 → #384). База #8 — `main`.
- 2026-05-08T13:15Z — PR #8 (daily-variant DRY) подготовлен.
  Дублирующиеся `VARIANT_THEME` (25 строк) и `dailyTrackUnitKey`
  (8 строк) из `app/home/page.tsx` и `app/daily/page.tsx`
  вынесены в новый `src/lib/dailyVariant.ts`. Из `home/page.tsx`
  убран осиротевший импорт `Heart` из lucide-react.
- 2026-05-08T13:25Z — PR #8 (#385) смерджен в `main`. CI зелёный.
- 2026-05-08T13:30Z — PR #9 (shadow-accent token, #386) смерджен.
  Добавлены `--shadow-accent` / `--shadow-accent-strong` в
  `_tokens.scss`. `Button` (primary), `MobileBottomDock` (play)
  и `ArtistPicker` (selected badge) переехали с inline-строк
  `shadow-[0_2px_8px_-2px_var(--color-accent-glow)]` /
  `shadow-[0_4px_16px_-4px_var(--color-accent-glow)]` на токены.
  Уникальный `0 4px 20px -4px` в `app/rooms/list.tsx` — намеренно
  оставлен (другая геометрия, hero-иконка).
- 2026-05-08T13:36Z — PR #10 (accent-magenta token, #387) смерджен.
  Добавлен `--color-accent-magenta` (`#d946ef` light, `#e879f9`
  dark) в `_tokens.scss`. `app/rooms/list.tsx`, `app/ai/page.tsx`
  и `components/layout/QuickPrefsBar.tsx` теперь все используют
  один и тот же оттенок магенты в accent-градиенте. Раньше было
  два разных значения (`fuchsia-500` против CSS-named `fuchsia`).
  Не перепутать с PR #9 (`--shadow-accent`) — это другой токен,
  про elevation; PR #10 — про цветовую палитру.
- 2026-05-08T13:43Z — PR #11 (stale token refs, #388) смерджен.
  `--color-on-accent` (несуществующее) → `--color-text-on-accent` в
  5 местах (`app/home/page.tsx` ×3, `QuickPrefsBar` ×1,
  `LanguageSwitcher` ×1). `--color-warning` (несуществующее) →
  `--color-warn` в `AdminHealthPanel` (было: рендерило fallback
  `#d97706`; сейчас: design-токен `#b45309` / `#fbbf24`).
  Stale fallback `rgba(99,102,241,0.45)` (indigo-500, бывший
  бренд) на `--color-accent-glow` убран из 3 мест (`home`,
  `QuickPrefsBar`, `LanguageSwitcher`).
- 2026-05-08T14:05Z — PR #12 (KV write-budget) подготовлен.
  Cloudflare прислал "90% of daily KV ops limit" (981/1000 writes).
  Создан `worker/src/services/seedCache.ts` (`CACHE_TTL_S = 7d`,
  `getCachedGenreTracks(env, tidal, slug)`); `RecommendationService`
  и `DailyPlaylistService` теперь читают/пишут `genre_seed_tracks:*`
  через одну точку (раньше — два независимых писателя с TTL 12h).
  TTLs: `track_radio:` 24h → 7d, `artist_seed_tracks:` 12h → 7d,
  `rec_suggested_artists:v1` 24h → 7d, negative discovery (`tidal-track-formats:`
  для пустых) 1h → 24h. Ожидаемый стационарный write-rate: 140–200/day.
- 2026-05-08T14:12Z — PR #12 (#389) смерджен в `main`. CI зелёный.
- 2026-05-08T14:15Z — PR #13 (`<MetaChip>` extract) подготовлен.
  Один и тот же inline-pill (`inline-flex w-fit items-center gap-2
  rounded-full border border-border bg-[var(--color-surface-elevated)]
  px-... py-... text-xs font-medium text-muted-foreground backdrop-blur`)
  жил **9 раз** в коде — `<icon> <label>` eyebrow над H2-заголовками
  (`/home` ×4, `/daily`, `/ai`, `/landing`, `/profile`, `ArtistPicker`).
  Вынесен в `src/components/ui/MetaChip.tsx` с двумя плотностями:
  `size="md"` (px-3 py-1.5, hero-уровень) и `size="sm"` (px-2.5 py-1,
  раздел-уровень — default). Никаких визуальных изменений, разница
  per-сайт (`gap-1.5` в `/daily`, отсутствие `w-fit` у DOM-обёрток
  внутри flex-row) пробрасывается через `className`. Продолжение
  запроса "везде использовать одинаковые компоненты, меньше хардкода".
- 2026-05-08T14:20Z — PR #13 (#390) смерджен в `main`. CI зелёный.
- 2026-05-08T14:23Z — PR #14 (`<Eyebrow>` dedup) подготовлен.
  Класс-string `text-xs font-medium uppercase tracking-[0.25em]
  text-muted-foreground` уже жил в `Eyebrow` (`SectionHeading.tsx`),
  но дублировался **9 раз** на сайтах, которые при этом им не пользовались
  (page-hero eyebrows / search / library / uploads / track / profile /
  shared / explore-playlist / authguard). Замена inline-`<span>` на
  `<Eyebrow>` без визуальных изменений; компонент уже рендерит `<span>`.
  Не тронуты 3 сайта-якоря с hover-стилем
  (`artist/releases.tsx`, `explore/list.tsx`, `explore/slug.tsx` —
  `<a>`/`<Link>`, не `<span>`) и `FullscreenPlayer.tsx:509`
  (player-поверхность, hard constraint).
- 2026-05-08T14:25Z — PR #14 (#391) смерджен в `main`. CI зелёный.
- 2026-05-08T14:32Z — PR #15 (`<Eyebrow>` polymorphic) подготовлен.
  Достроен `<Eyebrow>` до полиморфного `as` prop:
  `<Eyebrow as={Link} to=...>` / `<Eyebrow as="a" href=...>`.
  Оставшиеся **3** сайта с тем же class-string
  (`releases.tsx`, `explore/list.tsx`, `explore/slug.tsx` —
  back-link якоря с `transition-colors hover:text-foreground`)
  переехали на `<Eyebrow as={Link}>` без визуальных изменений.
  Не тронут `FullscreenPlayer.tsx:509` (player-поверхность, hard
  constraint).
- 2026-05-08T14:55Z — PR #15 (#393) смерджен в `main`. CI зелёный.
- 2026-05-08T14:55Z — PR #16 (iOS PWA mediaSession sync, под явный
  bug-report пользователя) подготовлен.
  **Симптом:** на iOS PWA при долгом фоновом прослушивании с
  включённым crossfade кнопка play/pause в Control Center
  десинхронизируется с реальным состоянием — музыка либо
  останавливается сама, либо нажатие play в трее не запускает
  воспроизведение.
  **Root cause:** `navigator.mediaSession.playbackState` ставится
  только из стора (`isPlaying`). Но на iOS `<audio>` элемент может
  быть поставлен на паузу самой системой — interruption (звонок,
  будильник, отключение AirPods, маршрутизация AVAudioSession) или
  WebKit-suspend при долгом backgrounding-е PWA. Стор об этом не
  узнаёт, `playbackState` остаётся `'playing'`. Apple-spec: iOS
  диспетчерует **противоположное** действие тому, что показано в
  Control Center — то есть кнопка показывает ⏸, юзер тапает её, а
  iOS шлёт `pause` в наш handler, и playback окончательно встаёт.
  **Фикс (минимальный, точечно по spec, не трогает audio engine):**
  в `wireSlot` подключены нативные слушатели `play` / `pause` на
  обе слот-`<audio>` элемента. На `play` → выставляется
  `mediaSession.playbackState = 'playing'`. На `pause` (только
  если pause НЕ инициирован движком — не `crossfadingRef`,
  не `loadingRef`, не `fallbackInProgressRef`, не natural
  `audio.ended`) → `mediaSession.playbackState = 'paused'` и
  стор-флаг `isPlaying` сбрасывается, чтобы (а) UI-кнопка плеера
  не врала, (б) следующий tap "Play" в Control Center корректно
  ушёл в наш `play` action handler. Crossfade-логика и сам
  крос-fade ramp нетронуты — гасим только Media Session-десинк.
- 2026-05-08T17:56Z — PR #16 (#394) смерджен в `main`. CI зелёный.
- 2026-05-08T15:25Z — PR #17 (comment cleanup pass) подготовлен.
  Под явный запрос пользователя ("огромное количество многострочных
  комментариев … можно стирать или сокращать") — широкий проход по
  10 самым "тяжёлым по комментам" non-audio-engine файлам:
  `ExploreModules.tsx`, `store/player.ts`, `usePlayHistoryLogger.ts`,
  `app/home/page.tsx`, `useRoomChat.ts`, `useOfflineCoverUrl.ts`,
  `OnboardingTour.tsx`, `lib/offline/downloads.ts`,
  `useRoomBridge.ts`, `lib/offline/streamResolver.ts`. Сжаты только
  устаревшие нарративы и многословные docstrings; всё, что
  документирует iOS Safari quirks, race conditions, security
  trade-offs и behavioral edge cases — сохранено. Логика, типы,
  тесты не тронуты. Audio engine (`useAudioPlayer.ts`,
  `Player.tsx`, `FullscreenPlayer.tsx`, `Equalizer.tsx`,
  `LyricsPanel.tsx`) — hard constraint, не тронут. Diff: 10 файлов,
  +632/−1472 (нетто −840 строк).

---

## Handoff log

| Когда (UTC)             | Кто (Devin session)                                 | Что сделал                                          |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------- |
| 2026-05-08 ~11:30       | `dcf6f7fd-063d-4797-bbfd-49edc769aa7a`              | PR #373 (foundation), `REFACTOR_PROGRESS.md`        |
| 2026-05-08 ~11:50       | `9363824c-19ed-41b2-9915-dac317a5a082`              | knowledge base (AGENTS.md + docs/), tracker.md      |
| 2026-05-08 ~13:15       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | sync tracker (PR #2..#7 merged) + PR #8             |
| 2026-05-08 ~13:30       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #9 (--shadow-accent token, 3 sites, #386)        |
| 2026-05-08 ~13:36       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #10 (--color-accent-magenta token, 3 sites, #387) |
| 2026-05-08 ~13:43       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #11 (align stale token refs / fallbacks, #388)   |
| 2026-05-08 ~14:05       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #12 (KV write-budget — seedCache + 7d TTLs, #389) |
| 2026-05-08 ~14:15       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #13 (`<MetaChip>` — DRY 9 inline eyebrow pills, #390) |
| 2026-05-08 ~14:23       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #14 (`<Eyebrow>` — DRY 9 inline tracking-[0.25em] spans, #391) |
| 2026-05-08 ~14:32       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2`              | PR #15 (`<Eyebrow>` polymorphic — `as` prop + dedup 3 link-eyebrows) |
| 2026-05-08 ~14:55       | `1a56046f-8dc5-4e06-b779-25be387e9447` (текущий)    | PR #16 (iOS PWA mediaSession sync — fix Control Center play/pause desync во время crossfade) |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
