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

Старые `merged` PR (#373..#396) вычищены из таблицы по запросу пользователя
("ты можешь полностью стереть старые задачи, которые уже выполнены"). История
по ним — в `git log`, в `docs/daily-changes/`, и частично в Handoff log ниже.

| #   | Branch                                       | Title                                                                                          | Status | PR                                                              |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| 1   | `devin/1778271260-fix-language-switcher-anim` | LanguageSwitcher — убрать "вылет снизу" thumb-индикатора при заходе в профиль                  | merged | [#400](https://github.com/BRATAN-CORP/bratan-music/pull/400)    |
| 2   | `devin/1778271340-hero-polish`               | PageHero — top-padding для не-PWA + плавный bottom blur fade gradient                          | merged | [#401](https://github.com/BRATAN-CORP/bratan-music/pull/401)    |
| 3   | `devin/1778271470-library-redesign`          | Library page — адаптивный редизайн, унификация со стилем альбомов / артистов / плейлистов      | merged | [#402](https://github.com/BRATAN-CORP/bratan-music/pull/402)    |
| 4   | `devin/1778271600-search-redesign`           | Search page (start + results) — единый стиль с остальными разделами                            | merged | [#403](https://github.com/BRATAN-CORP/bratan-music/pull/403)    |
| 5   | `devin/1778271720-rooms-list-redesign`       | `/rooms` start screen — выкинуть headphones-icon с градиентом, унифицировать hero              | merged | [#404](https://github.com/BRATAN-CORP/bratan-music/pull/404)    |
| 6   | `devin/1778271817-admin-usercard-expand`     | Admin → UserCard — расширенная карточка (только её): widened panel, refresh, copy-id, inline ban form | open   | [#405](https://github.com/BRATAN-CORP/bratan-music/pull/405)    |
| 7   | `devin/1778271817-add-boneyard`              | Add `boneyard/` archive directory + ESLint ignore + contract README                            | open   | [#406](https://github.com/BRATAN-CORP/bratan-music/pull/406)    |
| 8   | `devin/1778271971-tracker-sync`              | Tracker sync — drop merged old roadmap rows, add #400–#406, refresh Live status / Handoff log  | open   | (этот PR)                                                       |

`#1` — конкретный bug-report пользователя: thumb-индикатор `LanguageSwitcher`
`<motion.div layoutId="lang-switcher-thumb">` без `initial={false}` "вылетал
снизу" при первом монтировании страницы профиля. Фикс: пробросить
`initial={false}` через `LayoutGroup` чтобы `layoutId` не анимировал
mount-фазу — только последующие переключения языка. Аудио-движок не тронут.

`#2` — две полировки на hero страниц альбома / артиста / плейлиста:
- non-PWA top-padding выглядел "обрезанным" (был `pt-safe` even off-PWA, что
  на десктопе давало 0). Сейчас: `pt-safe` только когда есть `--pwa-safe-top`,
  иначе `pt-6` / `sm:pt-10` для нормального воздуха.
- bottom blur был резкой границей (`mask-image: linear-gradient(to bottom,
  black 70%, transparent)`) — заменён на плавный double-stop fade
  (`black 0%, black 65%, transparent 100%` с `to bottom`-направлением и
  pixel-точным fallback для Safari).

`#3` — Library page прежде стояла на одном `<table>`-варианте без адаптива.
Сейчас — двухмерный grid с `auto-fill, minmax(...)` ячейками, hover-эффекты
через `transition-transform`, `<MetaChip>` под секционные заголовки,
адаптация: 1 колонка (mobile) → 2 (tablet) → 3 (desktop) → 4 (xl).

`#4` — Search page (`/search`) — старт-экран и результаты. Старт-экран —
теперь grid с recent searches / suggestions / genre chips, всё через те же
`<MetaChip>` / `<Eyebrow>`. Результаты — табы (треки / альбомы / артисты /
плейлисты) над тем же grid'ом, с motion-driven cross-fade между табами.

`#5` — `/rooms` start screen. Убраны: hero-иконка наушников
(`<Headphones>` в gradient-квадрате) и сам gradient, заменены на текстовый
`<PageHero>` с `<MetaChip>` "live rooms" eyebrow. Единый стиль с
`/library`, `/search`, `/profile`.

`#6` — Admin → "Карточка пользователя". Только этот компонент
(`AdminUserDetailDialog.tsx`) — остальные admin-tabs не тронуты по явному
запросу. Изменения: panel расширен `min(720px,...)` → `min(960px,...)`,
добавлен refresh-кнопка с loading state, copy-id с clipboard API +
fallback, ban-flow `window.prompt()` заменён на inline motion-form
(open / submit / cancel). i18n-ключи `admin.detail.refresh` / `copyId` +
`admin.action.banPlaceholder` / `banConfirm`.

`#7` — `boneyard/` — top-level dir для "снятого с продакшена, но
сохранённого как референс" кода. Контракт в `boneyard/README.md`.
ESLint игнорирует, TypeScript уже исключает (`tsconfig include: ["src"]`),
Vite-бандл тоже не трогает. Изначально пусто.

`#8` (этот PR) — сам tracker. Убраны merged-строки старого roadmap'а
(#373..#396) из таблицы roadmap; полная история — в `git log`.

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

- 2026-05-08T19:30Z — старт текущего батча (PR #400..#406). Все семь
  тасков из user-input'а:
  - `#400` — language switcher thumb fix
  - `#401` — hero top-padding + bottom fade gradient
  - `#402` — library adaptive redesign
  - `#403` — search start + results redesign
  - `#404` — `/rooms` start hero unification
  - `#405` — admin UserCard expand (refresh, copy-id, inline ban form)
  - `#406` — boneyard archive directory
  Audio engine и security не тронуты ни в одном из них.
- 2026-05-08T19:55Z — PR #400..#404 смерджены в `main`. CI зелёный.
- 2026-05-08T20:00Z — PR #405 (admin UserCard) и #406 (boneyard) открыты.
- 2026-05-08T20:25Z — PR #8 (tracker sync, этот) — drop merged
  #373..#396 из roadmap, оставлен только текущий батч; полная история
  по старым PR — в `git log`, `docs/daily-changes/` и Handoff log ниже.

---

## Handoff log

| Когда (UTC)       | Кто (Devin session)                          | Что сделал                                                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-05-08 ~11:30 | (исторический)                               | Foundation + knowledge base + диалоги/safe-area/collection-pages (PR #373..#396, merged). Полный лог — в `git log`. |
| 2026-05-08 ~19:30 | `4dbcd574a1924b858d11b3b425ef8691` (текущий) | PR #400 (lang-switcher anim fix)                                                            |
| 2026-05-08 ~19:35 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #401 (PageHero polish — top-padding + bottom fade gradient)                              |
| 2026-05-08 ~19:40 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #402 (Library adaptive redesign)                                                         |
| 2026-05-08 ~19:45 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #403 (Search start + results redesign)                                                   |
| 2026-05-08 ~19:50 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #404 (`/rooms` start hero unification)                                                   |
| 2026-05-08 ~19:55 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #405 (Admin UserCard expand — only that component)                                       |
| 2026-05-08 ~20:00 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #406 (boneyard/ archive dir + ESLint ignore + contract README)                           |
| 2026-05-08 ~20:25 | `4dbcd574a1924b858d11b3b425ef8691`           | PR #8 (tracker sync — drop merged roadmap rows, add #400–#406)                              |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
