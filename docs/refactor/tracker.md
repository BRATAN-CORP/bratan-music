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
| 2 | (TBD) | Mobile lyrics layout — на узких экранах прятать обложку + анимированный halo при открытом lyrics, рендерить тот же side-panel дизайн в области обложки | pending | — |
| 3 | `devin/1778363267-batch-fixes` | FullscreenPlayer volume slider, solid skip icons (initial), PWA navbar inset (½), mini-player touch hit area | merged (regression) | #427 |
| 4 | `devin/1778365680-fix-batch` | **Follow-up:** revert broken skip icons, drop PWA safe-bottom inset, robust offline toast watcher | open | (этот PR) |

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

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
