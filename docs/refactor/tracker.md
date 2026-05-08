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

Свежий батч (2026-05-08, вечер):

> Переделать вид библиотеки в разных вариантах адаптива; переделать дизайн
> страниц авторов / плейлистов / альбомов (что-то с отступом сверху не в
> pwa-mobile, нижний блюр сделать плавным градиентом); расширить карточку
> пользователя в админ-панели (только её, остальные компоненты не трогать);
> убрать баг с появлением ползунка смены языка снизу при заходе в профиль;
> переделать дизайн страницы поиска (стартовой и с запросами); переделать
> дизайн `/rooms` (стартовый экран, убрать иконку наушников и градиент на
> квадрате с иконкой); добавить в проект boneyard.

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

Старые завершённые PR-роадмапы (#373..#406, #413) вычищены из таблицы
по запросу пользователя — поддерживаем чистоту трекера. История по ним —
в `git log` и в `docs/daily-changes/`. В таблице остаются только активные
задачи текущего батча.

| #   | Branch                                  | Title                                                                                                      | Status | PR        |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ | --------- |
| 1   | `devin/1778275445-boneyard-skeletons`   | Boneyard skeletons — заменить все оставшиеся `<PageLoader>` на скелетоны страниц (album / track / artist / artist-releases / explore-slug / rooms-detail / library-playlists), удалить компонент `PageLoader` | open   | (этот PR) |
| 2   | (TBD)                                   | Dependabot security alerts — починить все открытые алерты (babel / fast-uri / hono) одним PR-мерджом       | pending | —         |

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

- 2026-05-08T21:25Z — старт скелетон-батча (PR `devin/1778275445-…`).
  Найдено семь оставшихся `<PageLoader>` на страницах: `/album`,
  `/track`, `/artist`, `/artist/releases`, `/explore/:slug`,
  `/rooms/:id`, `/library` (вкладка плейлистов). Все заменены на
  скелетон-варианты: `AlbumSkeleton + TrackListSkeleton`, `TrackSkeleton`,
  кастомный `ArtistPageSkeleton`, `AlbumGridSkeleton`,
  `ExploreFeedSkeleton`, кастомный `RoomPageSkeleton`,
  `PlaylistRowListSkeleton`. Сам компонент `<PageLoader>` удалён —
  больше не используется в UI. Audio engine и security не тронуты.
- 2026-05-08T21:25Z — Следующая задача (после мерджа этого PR) —
  Dependabot security alerts: пройтись по
  https://github.com/BRATAN-CORP/bratan-music/security/dependabot,
  поднять алерты, починить всё одним PR-мерджом.

---

## Handoff log

| Когда (UTC)       | Кто (Devin session)                          | Что сделал                                                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-08 ~11:30 | (исторический)                               | Foundation + knowledge base + диалоги/safe-area/collection-pages (PR #373..#396, merged). Полный лог — в `git log`. |
| 2026-05-08 ~19:30..20:25 | `4dbcd574a1924b858d11b3b425ef8691` (предыдущий) | PR #400..#406 + tracker sync — language-switcher fix, PageHero polish, Library/Search/Rooms redesign, Admin UserCard, Boneyard archive. Все смерджены. |
| 2026-05-08 ~21:25 | `2fa86d7feed2415c825633b09851548a` (текущий) | Boneyard skeletons — заменил оставшиеся `<PageLoader>` (7 страниц) на скелетоны, удалил компонент `PageLoader.tsx`, добавил `PlaylistRowSkeleton` / `PlaylistRowListSkeleton` в `Skeleton.tsx`. Tracker pruned. |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
