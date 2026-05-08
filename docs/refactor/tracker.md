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

Свежий батч (2026-05-08):

> Переделать вид библиотеки в разных вариантах адаптива; переделать
> дизайн страниц авторов / плейлистов / альбомов (что-то с отступом
> сверху не в pwa-mobile, нижний блюр сделать плавным градиентом);
> расширить карточку пользователя в админ-панели (только её, остальные
> компоненты не трогать); убрать баг с появлением ползунка смены языка
> снизу при заходе в профиль; переделать дизайн страницы поиска
> (стартовой и с запросами); переделать дизайн `/rooms` (стартовый
> экран, убрать иконку наушников и градиент на квадрате с иконкой);
> добавить в проект boneyard.

Уточнения по ходу батча:

- "boneyard" → **skeleton screens** (заменить крутящиеся лоадеры на
  shimmer-каркасы), не code-archive (изначальная интерпретация — PR
  #406 — отозвана revert'ом #410, а реальная фича приехала в #411).
- top-padding должен быть **только** на PWA (Android / iOS), на
  десктопе / мобильном вебе — флушится с верхом viewport. При этом
  ambience-слои (radial glow, cover blur, artist crossfade) НЕ должны
  обрезаться — они должны свободно тянуться до верха.
- В полноэкранном плеере (PWA iOS) иконки header'а и подпись "Сейчас
  играет" должны быть на одной строке.
- Плеер не должен раздуваться от длинного списка артистов через
  запятую — нужна та же fixed-width + marquee-scroll схема, как у
  title, с edge-fade только во время движения и кликабельностью
  каждого артиста.
- На /library и /search свет/блюр тоже надо тянуть к верху (не
  обрезать) — отдельный PR #412.
- LanguageSwitcher всё ещё глючил (pill летел из неоткуда при заходе
  в профиль) + при смене языка появлялся ложный тост "Снова в сети" —
  оба фикса в PR #413.

## Hard constraints (не нарушаем)

- Не трогаем audio engine: `useAudioPlayer`, playback-логику
  `Player.tsx` / `FullscreenPlayer.tsx`, визуализатор / EQ / lyrics.
  Visual-only фиксы header'а и marquee для имён артистов в плеере —
  с явного override'а пользователя в чате.
- Не ослабляем безопасность: HMAC Telegram WebApp, JWT auth, CORS
  allowlist, RLS, parameterized SQL.
- Не модифицируем уже применённые D1-миграции.
- Не делаем force-push в main.
- Каждый PR держим скоупанным — лучше шесть маленьких чем один большой.

---

## Roadmap (текущая серия)

Старые `merged` PR (#373..#396) вычищены из таблицы по запросу
пользователя. История по ним — в `git log`, `docs/daily-changes/`,
частично в Handoff log ниже.

| #    | Title                                                                                                            | Status | PR                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| #400 | LanguageSwitcher — попытка №1 фикса "вылета снизу" thumb-индикатора (`initial={false}` на `LayoutGroup`)         | merged → reopened by #413 | [#400](https://github.com/BRATAN-CORP/bratan-music/pull/400) |
| #401 | PageHero — top-padding для не-PWA + плавный bottom blur fade gradient                                            | merged | [#401](https://github.com/BRATAN-CORP/bratan-music/pull/401)    |
| #402 | Library — адаптивный редизайн, унификация со стилем альбомов / артистов / плейлистов                             | merged | [#402](https://github.com/BRATAN-CORP/bratan-music/pull/402)    |
| #403 | Search (start + results) — единый стиль с остальными разделами                                                   | merged | [#403](https://github.com/BRATAN-CORP/bratan-music/pull/403)    |
| #404 | `/rooms` start — выкинуть headphones-icon с градиентом, унифицировать hero                                       | merged | [#404](https://github.com/BRATAN-CORP/bratan-music/pull/404)    |
| #405 | Admin → AdminUserDetailDialog — расширенная карточка (только её)                                                 | merged | [#405](https://github.com/BRATAN-CORP/bratan-music/pull/405)    |
| #406 | Boneyard как code-archive (`boneyard/` dir + ESLint ignore + README)                                             | reverted by #410 | [#406](https://github.com/BRATAN-CORP/bratan-music/pull/406) |
| #407 | Tracker sync                                                                                                     | merged | [#407](https://github.com/BRATAN-CORP/bratan-music/pull/407)    |
| #408 | PageHero — флушим hero к верху viewport (`-mt-N` к `-mx-N`), убираем "полоску" на не-PWA                         | merged | [#408](https://github.com/BRATAN-CORP/bratan-music/pull/408)    |
| #409 | Player UX batch — fullscreen header alignment + artist-list marquee (mini + fullscreen) + сохранена кликабельность | merged | [#409](https://github.com/BRATAN-CORP/bratan-music/pull/409)  |
| #410 | Revert #406 — boneyard как code-archive (пользователь имел в виду skeleton screens)                              | merged | [#410](https://github.com/BRATAN-CORP/bratan-music/pull/410)    |
| #411 | Skeleton screens — page-level лоадеры → shimmer skeletons (admin / library / explore / search)                   | merged | [#411](https://github.com/BRATAN-CORP/bratan-music/pull/411)    |
| #412 | Library + Search hero ambience — extend to top edge (`-mt-N` mirror of `-mx-N` bleed)                            | merged | [#412](https://github.com/BRATAN-CORP/bratan-music/pull/412)    |
| #413 | LanguageSwitcher — фикс №2 (drop layoutId, single measured-position highlight) + OfflineToastWatcher gate        | open   | [#413](https://github.com/BRATAN-CORP/bratan-music/pull/413)    |

### Notes per PR

`#400` (merged → reopened by #413) — попытка фикса "вылета снизу"
indicator'а через `initial={false}` на `LayoutGroup`. Не сработала, потому
что баг вызван не первым монтированием, а сменой активной кнопки после
двухпроходной hydration `useSettingsStore`. PR #413 решает корректно.

`#406` (reverted) — изначально интерпретировал "boneyard" как top-level
dir для снятых с прода модулей. Пользователь уточнил — имелся в виду
**skeleton-экран**. PR #410 откатил `boneyard/` директорию; PR #411
реализовал skeleton screens.

`#408` — пара `-mx-N -mt-N` в `<PageHero>` чтобы hero флушился по всем
четырём viewport-граням. PWA `pt-safe` не задет — он живёт в app-shell
`<main>` слоем выше, отдельно от consumer wrapper'а.

`#409` — три visual-only фикса в плеере одним PR'ом (с явного
override'а пользователя):
1. Header alignment в `<FullscreenPlayer>`: "Сейчас играет" / "Now
   Playing" больше не уезжает выше иконок на PWA iOS.
2. Mini-player — артисты через запятую больше не раздувают контейнер;
   вынесен новый `<ArtistLinks>` + reusable `<Marquee>` с edge-fade
   только во время движения, fixed-width контейнер, кликабельность
   каждого артиста сохранена.
3. Fullscreen player — то же `<ArtistLinks>` + `<Marquee>` под title.

`#411` — добавил `.skeleton-shimmer` keyframes в `globals.scss` +
варианты в `Skeleton.tsx` (`UserRowSkeleton`, `*GridSkeleton`,
`ExploreModuleSkeleton`, `ExploreFeedSkeleton`, `TrackListSkeleton`,
`PlaylistSkeleton`). Заменены page-level крутящиеся `<Loader2>`: admin
user list, admin detail dialog, library/uploads, `/explore/page/:slug/list/:i`
(type-aware), search empty state. Inline / button-level Loader2 (Save /
Ban / Delete) ОСТАЛИСЬ — это корректные busy-индикаторы для in-flight
мутаций.

`#412` — на `/library` и `/search` радиальный glow обрезался сверху
паддингом `<div className="… p-4 sm:p-6 lg:p-10">` обёртки. Применён тот
же recipe что и в `<PageHero>` (PR #408): добавили `-mt-4 sm:-mt-6
lg:-mt-10`, бамп `pt-4 → pt-8 sm:pt-10 lg:pt-14` чтобы заголовок остался
на том же визуальном offset.

`#413` — два связанных бага профиля:
1. **Language pill flies in from below**. `<motion.span layoutId="lang-highlight">`
   сидел внутри `{active && …}`, при флипе активной кнопки (двухпроходная
   hydration настроек: localStorage→server) `layoutId` морфил pill через
   позицию. `initial={false}` не помогало — его роль подавить ПЕРВОЕ
   монтирование, а не cross-mount морф. Фикс: одна always-mounted
   `<motion.span>`, `{x, width, height}` замеряется `useLayoutEffect` +
   `ResizeObserver` от активной кнопки, animate'ятся как обычные пропсы.
   `initial={false}` теперь работает как ожидалось — первый paint
   статичный, последующие смены локали — spring slide.
2. **Phantom "Back online" toast**. У `OfflineToastWatcher` зависимости
   были `[online, t]`, при смене локали `t` меняла identity → effect
   ре-запускался → `isFirstMount` уже `false` → попадало в
   `toast.success(toastOnline)` хотя `online` не менялся. Фикс:
   `lastOnline` ref, `if (lastOnline.current === online) return;`.

---

## Resolved decisions

(Default-ы; пользователь может переопределить комментарием на PR / в чате.)

1. **Accent color.** Везде `--color-accent: #5E6AD2`. Малиновый
   `#c2185b` остаётся **только** в плеере как `--color-accent-secondary`
   (фирменный gradient прогресс-бара).
2. **Hero motion.** Album / Artist / Playlist hero получают лёгкий
   fade-up при входе, через `motion` (тайминг согласован с плеером).
3. **Top-inset.** PWA Android / iOS получают `pt-safe`
   (`env(safe-area-inset-top)`). Десктоп / мобильный веб — `0`. Hero /
   cards внутри page-wrapper'а флушатся к viewport-верху через `-mt-N`
   парой к существующему `-mx-N`. Ambience-слои тянутся до границы.
4. **OnboardingTour.** Не трогаем в этой серии PR'ов.
5. **Brandmark в Sidebar.** `Bratan Music` остаётся как константа
   (бренд не локализуется).
6. **Шрифты.** `Inter` + `Instrument Serif`.
7. **Boneyard.** `boneyard/` директория **не используется** —
   изначальная интерпретация термина (PR #406) откачена в #410. Termin
   "boneyard" в этом репо означает **skeleton screens** (`bones` =
   каркас) — реализованы в #411.
8. **Loader-policy.** Page-level "blank surface + spinner" boundaries
   рендерят shimmer-skeleton (см. варианты в `<Skeleton>`).
   Button-level / inline-mutation `<Loader2>` остаются — это
   корректные busy-сигналы для in-flight мутаций.
9. **`<LanguageSwitcher>` highlight.** Single always-mounted
   `<motion.span>` с измеренной `{x, width}` от активной кнопки,
   `initial={false}`. **Не использовать** `LayoutGroup` + `layoutId`
   для cross-button морфа — двухпроходная hydration setting'ов рвёт
   эту схему (см. PR #413).

---

## Live status

- 2026-05-08 ~19:30 — старт текущего батча. PR #400..#406 открыты.
- 2026-05-08 ~20:00 — PR #400..#404 + #407 merged.
- 2026-05-08 ~20:15 — пользователь уточнил: top-padding только на PWA,
  ambience не обрезать, "boneyard" = skeleton screens.
- 2026-05-08 ~20:30 — PR #408 (PageHero flush к верху), #409 (player UX
  batch), #410 (revert boneyard как code-archive) merged.
- 2026-05-08 ~21:00 — PR #411 (skeleton screens) и #412 (library/search
  hero ambience) merged.
- 2026-05-08 ~21:14 — PR #413 (LanguageSwitcher v2 + OfflineToastWatcher
  gate) — CI green (Build success, Lint & Typecheck success), ждём
  user-review / merge.

---

## Handoff log

| Когда (UTC)       | Кто (Devin session)                          | Что сделал                                                                                |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-05-08 ~11:30 | (исторический)                               | Foundation + knowledge base + диалоги/safe-area/collection-pages (PR #373..#396, merged). |
| 2026-05-08 ~19:30 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #400..#407 (lang switch v1, hero polish, library, search, /rooms, admin user, boneyard-as-archive, tracker sync). |
| 2026-05-08 ~20:30 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #408 (PageHero flush top), #409 (player UX batch — header + artist marquee), #410 (revert boneyard archive). |
| 2026-05-08 ~21:00 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #411 (skeleton screens — proper "boneyard" interpretation), #412 (library/search hero ambience top). |
| 2026-05-08 ~21:14 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #413 (LanguageSwitcher v2 — measured-position highlight; OfflineToastWatcher — gate on actual online change). |

> При следующем перехвате — добавь свою строку в этот лог и обнови
> `Live status`.
