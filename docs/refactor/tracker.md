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

Свежий батч (2026-05-10):

> Полноэкранный плеер: для треков без видео-обложки добавить
> анимированный фон под существующим блюром — liquid /
> watercolor / plastic эффект. Движение обложки только в центре
> (у краёв — статика, чтобы не было артефактов / швов),
> анимация бесшовная и максимально плавная, блюр последним
> слоем поверх эффекта, чтобы картинка казалась живой. PR #433
> (`feTurbulence` + animated `feOffset` через SVG) был слишком
> быстрым, лагал на iOS Safari и ломал блюр — реверт #434.

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
| 1 | `devin/1778433068-watercolor-bg` | **Watercolor background для фуллскрин-плеера (replay PR #433).** В `FullscreenPlayer.tsx` ветка с обычной обложкой (без `coverVideoUrl`) рендерит `motion.div.fullscreen-player-watercolor` с `filter: blur(64px) saturate(1.5)` — внутри статичная rim-копия обложки (`scale(1.30)`) + два дрейфующих слоя `bg-cover` (`.watercolor-drift-a` 28s / `.watercolor-drift-b` 41s, противоположные фазы, `ease-in-out`, второй на `opacity: 0.55` — слои блендятся как watercolor). Дрейфы — pure GPU `transform: translate3d` + `scale`, никаких `feDisplacementMap`/`feTurbulence` (PR #433 был реверчен из-за стоимости рендеринга на iOS). Движение по всей площади (без радиального mask): каждый слой scale ~1.28–1.33, перевод до ±5.5% не открывает фон, defence-in-depth — статичная rim-копия снизу тоже scale 1.30. Блюр + saturate применяются на обёртке как ПОСЛЕДНИЙ шаг рендера. Skipped для `coverVideoUrl` и под `prefers-reduced-motion` (рендерится только rim-копия). | merged | #435 |

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

- 2026-05-10T17:30Z — watercolor-фон для фуллскрин-плеера merged в `main`
  (PR #435 → squash `ef94be755`). Реализация: `FullscreenPlayer.tsx`
  ветка без `coverVideoUrl` рендерит `motion.div.fullscreen-player-watercolor`
  с `filter: blur(64px) saturate(1.5)` (блюр — ПОСЛЕДНИЙ шаг рендера,
  как просил юзер). Внутри: статичная rim-копия (`scale(1.30)`) +
  два слоя `.watercolor-drift-a` (28s) и `.watercolor-drift-b` (41s,
  `opacity: 0.55`) с противоположными фазами; анимация — `transform:
  translate3d` + `scale` (только GPU). Движение по всей площади
  viewport — изначально была попытка с радиальным mask «только в
  центре», но юзер отверг («ну ты бля по центру сделал нахуя»),
  переделал на overscale-стратегию: каждый слой scale 1.28–1.33,
  трансляция до ±5.5% никогда не открывает фон (всегда есть «запас»
  обложки за пределами viewport), статичная rim-копия — defence-in-depth
  второй защитный слой. Pure CSS, никаких `feDisplacementMap`/
  `feTurbulence` (PR #433 был реверчен #434 из-за стоимости рендеринга
  на iOS Safari). Skipped: `coverVideoUrl` и `prefers-reduced-motion`.

---

## Handoff log

| Когда (UTC)       | Кто (Devin session)                          | Что сделал                                                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-08 ~11:30 | (исторический)                               | Foundation + knowledge base + диалоги/safe-area/collection-pages (PR #373..#396, merged). Полный лог — в `git log`. |
| 2026-05-08 ~19:30..20:25 | `4dbcd574a1924b858d11b3b425ef8691` (предыдущий) | PR #400..#406 + tracker sync — language-switcher fix, PageHero polish, Library/Search/Rooms redesign, Admin UserCard, Boneyard archive. Все смерджены. |
| 2026-05-08 ~21:25 | `2fa86d7feed2415c825633b09851548a` (предыдущий) | Boneyard skeletons — заменил оставшиеся `<PageLoader>` (7 страниц) на скелетоны, удалил компонент `PageLoader.tsx`, добавил `PlaylistRowSkeleton` / `PlaylistRowListSkeleton` в `Skeleton.tsx`. Tracker pruned. |
| 2026-05-09 ~21:30 | `33edb7b9174a455d99183f00e71a4b4d` (предыдущий) | Offline lyrics — `OfflineTrack.lyrics`, `fetchLyricsPayload`, IDB-first `useLyrics` с back-fill сетевого ответа. Подготовил roadmap к 4-задачному батчу (lyrics offline / mobile lyrics layout / volume slider responsiveness / solid skip icons). PR #425 merged. |
| 2026-05-09 ~21:50 | (предыдущий, batch-fixes) | Volume slider responsiveness + solid skip icons + PWA bottom inset (½) + mini-player touch hit area. PR #427 merged, но `strokeWidth={0}` на skip-иконках стирал 1-D `<line>` элемент → пользователь сообщил регрессию иконок. |
| 2026-05-09 ~22:30 | `d8eeb192309c4c2d95225d362c18fa37` (предыдущий) | Follow-up батч: откатил `strokeWidth={0}` на SkipBack/SkipForward (Player / FullscreenPlayer / MobileBottomDock), убрал `var(--pwa-safe-bottom)/2` из bottom-инсета (теперь `bottom-4`/`sm:bottom-6` = боковым полям), переписал `OfflineToastWatcher` на прямые `online`/`offline` event listener'ы + `visibilitychange` re-sync для iOS PWA, `t` через ref. Верифицировал, что lyrics fix (PR #425) реально задеплоился. |
| 2026-05-10 ~17:30 | `d9cc4c860e514bdab2945780dfd40a11` (текущий) | Watercolor-фон для фуллскрин-плеера — PR #435 merged (squash `ef94be755`). Чисто CSS, без `feDisplacementMap`/`feTurbulence`. `FullscreenPlayer.tsx` для не-видео обложек рендерит `.fullscreen-player-watercolor` обёртку с `filter: blur(64px) saturate(1.5)` (блюр — последний шаг), внутри статичная rim-копия (scale 1.30) + два дрейфующих слоя `.watercolor-drift-a` (28s) и `.watercolor-drift-b` (41s, opacity 0.55) с противоположными фазами и opposite scale (1.28–1.33). Движение по всей площади viewport (изначально был radial mask, но юзер отверг → переделал на overscale-стратегию: трансляция до ±5.5% не открывает фон). Keyframes/utility-классы в `src/styles/globals.scss`. CI зелёный (Build + Lint & Typecheck). |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
