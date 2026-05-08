# BRATAN MUSIC — Frontend Refactor Plan & Progress

> **STATUS — Historical / superseded (since PR #378, 2026-05-08).**
> Этот файл — оригинальный план refactor sprint'а. Все 6 PR-ов из
> "PR breakdown" ниже уже смерджены, плюс 11 follow-up'ов сверху плана.
> **Для актуального статуса смотри [`docs/refactor/tracker.md`](docs/refactor/tracker.md).**
> Этот файл больше не обновляется live; держим его как
> исторический контекст изначального плана.

---

## Goal (verbatim from user, RU)

> Рефакторинг фронтенда. Вынести цвета/отступы/прочее в глобальные
> переменные. Использовать одни и те же компоненты, меньше хардкода и
> повторов модалок. Привести интерфейс к единому стилю, акцентные
> цвета — везде одинаковые. Везде использовать `i18n`, без хардкода
> языка. Код унифицировать, сделать гибче и масштабируемее. **Не
> сломать плеер, не испаганить дизайн — только отполировать.**
> Страницы playlists / authors / albums переделать в стиле плеера,
> адаптивные на маленьких экранах. Проработать единые safe-zones для
> PWA на iOS / Android.

## Hard constraints

- **Не ломаем плеер** — все анимации/тайминги/жесты сохраняются.
- **Не ломаем дизайн** — никаких визуальных регрессий.
- **Не трогаем архитектуру** (zustand stores, react-query layer,
  router) кроме точечных фиксов.
- **Не удаляем релевантные комментарии** — только устаревшие/повторы.
- Каждая задача → отдельный PR. После каждого PR ждём CI.

## Discovery

- Stack: React 18, Vite 6, TS 5.7, Tailwind 3.4 + SCSS, Zustand,
  TanStack Query, motion (framer-motion 12), shadcn-style primitives.
- Дизайн-токены уже централизованы в `src/styles/_tokens.scss`
  (colors / shadows / radii / spacing / fonts / easings) → база есть,
  расширим её и подключим в `tailwind.config`.
- PWA safe-area уже есть (`--pwa-safe-*` + `pt-safe` / `pb-safe` /
  `pl-safe` / `pr-safe` утилиты в `globals.scss`) — но применяется
  непоследовательно. Нужно унифицировать.
- i18n развит хорошо — `useT()` с типизированными ключами,
  `ru.json` + `en.json`. Большинство строк уже переведено. Останется
  пара точечных хардкодов (`OfflineProgressIcon` aria-label и т.п.).
- Дубль логики модалок: `CreatePlaylistDialog`,
  `RenamePlaylistDialog`, `AddToPlaylistDialog`, `SubscriptionDialog`,
  `SharePlaylistDialog`, `UnsaveConfirmDialog`, `EditUploadDialog`,
  `BannedListDialog`, `TrackOverrideModal`, `AdminUserDetailDialog`,
  `QueueDialog` — все собирают свой scrim + motion + portal руками.
- Hero на album/artist/playlist собран копипастой; стили действий
  (like/dislike/follow/share IconButton) тоже почти идентичны.

---

## PR breakdown

| #   | PR title                                                        | Status | Branch                                     | PR link |
| --- | --------------------------------------------------------------- | ------ | ------------------------------------------ | ------- |
| 1   | Foundation: design tokens + shared UI primitives                | merged | `devin/1778237470-refactor-foundation`     | [#373](https://github.com/BRATAN-CORP/bratan-music/pull/373) |
| 2   | Migrate all dialogs to shared `Modal`/`Sheet` primitive         | merged | `devin/<ts>-refactor-dialogs`              | [#379](https://github.com/BRATAN-CORP/bratan-music/pull/379) |
| 3   | Unified PWA safe-area handling                                  | merged | `devin/<ts>-refactor-safe-area`            | [#380](https://github.com/BRATAN-CORP/bratan-music/pull/380) |
| 4   | Redesign album/artist/playlist pages — mobile-adaptive hero     | merged | `devin/<ts>-refactor-collection-pages`     | [#381](https://github.com/BRATAN-CORP/bratan-music/pull/381) |
| 5   | i18n audit — remove residual hardcoded language                 | merged | `devin/<ts>-refactor-i18n-audit`           | [#382](https://github.com/BRATAN-CORP/bratan-music/pull/382) |
| 6   | Polish: stale comments, dead style strings, accent unification  | merged | `devin/<ts>-refactor-polish`               | [#384](https://github.com/BRATAN-CORP/bratan-music/pull/384) |

> 6 follow-up PR-ов (PR #7..#17 — token-pass, KV write-budget,
> MetaChip / Eyebrow dedup, iOS PWA mediaSession, comment cleanup) —
> вне рамок исходного плана. Полный список с #-ссылками и handoff log:
> [`docs/refactor/tracker.md`](docs/refactor/tracker.md).

---

## PR 1 — Foundation (additive, zero visual change expected)

**Идея:** ничего не рефакторим в существующих компонентах. Только
добавляем недостающие токены и общие примитивы. Все существующие
страницы/диалоги работают как раньше — просто появляются ингредиенты,
которые соберём в PR 2-4.

### Subtasks

- [x] **Tokens** — добавить недостающие переменные в `_tokens.scss`:
      - [x] `--color-warn` / `--color-warn-muted` (light + dark)
      - [x] `--color-glass-tint` / `--color-glass-tint-strong` /
            `--color-glass-border`
      - [x] `--motion-instant` / `--motion-fast` / `--motion-base` /
            `--motion-slow`
      - [x] `--z-dock` / `--z-fullscreen` / `--z-modal` /
            `--z-modal-elevated` / `--z-toast` / `--z-confirm`
- [ ] **Tailwind theme** (deferred to PR 6) — пробросить токены через
      `tailwind.config.js` так, чтобы можно было писать `bg-accent` etc.
      В PR 1 решил не трогать: текущий синтаксис `bg-[var(--color-accent)]`
      работает и не блокирует ни одного следующего PR. PR 6 сделает
      это вместе с финальной унификацией.
- [x] **`<Modal>` primitive** (`src/components/ui/Modal.tsx`) — портал,
      motion-aware scrim, bottom-sheet (`align="sheet"`) /centered
      (`align="center"`) layouts, Esc-to-close, backdrop click,
      body scroll lock, `busy` gate, ARIA-modal defaults. Helpers
      `<ModalHeader>` и `<ModalCloseButton>` для типового layout.
- [x] **`<Sheet>` wrapper** — тонкая обёртка над `<Modal>` с
      `align="sheet"` по умолчанию.
- [x] **`<IconButton>` primitive** — круглая кнопка-действие
      (3 размера: sm/md/lg, 3 тона: neutral/accent/danger,
      3 варианта: outline/ghost/filled, `active` state для
      like/follow/pin toggles).
- [x] **`<PageHero>` primitive** — общий hero с custom ambience-слотом,
      vignette + accent radial layers, slots `cover` / `eyebrow` /
      `title` / `subtitle` / `meta` / `actions`. Mobile-first stack,
      row на `sm:`+.
- [x] **`<SectionHeading>` + `<Eyebrow>`** — мелкие текстовые
      примитивы.
- [x] **Hooks** — `useEscapeClose`, `useBodyScrollLock` (process-wide
      counter, чтобы стэкнутые модалки не разлочивали body раньше
      времени).
- [x] Lint + typecheck pass.
- [x] PR opened — link в таблице выше.

**Risk:** низкий. Только добавление файлов, ничего не удаляем.

---

## PR 2 — Migrate dialogs to shared `Modal`/`Sheet`

После PR 1 у нас есть `<Modal>`. Поочерёдно переводим существующие
диалоги на него, не меняя их UX:

- [ ] `CreatePlaylistDialog` → `Modal`
- [ ] `RenamePlaylistDialog` → `Modal`
- [ ] `AddToPlaylistDialog` → `Sheet` (мобил.) / `Modal` (deskt.)
- [ ] `SubscriptionDialog` → `Modal` (с halo-deco)
- [ ] `SharePlaylistDialog` → `Modal`
- [ ] `UnsaveConfirmDialog` → `Modal` (destructive variant)
- [ ] `EditUploadDialog` → `Modal`
- [ ] `BannedListDialog` → `Modal`
- [ ] `TrackOverrideModal` → `Modal`
- [ ] `AdminUserDetailDialog` → `Modal`
- [ ] `QueueDialog` — оставить как side-panel (не модалка по сути) —
       убрать только дублирующиеся scrim/motion если они есть.
- [ ] Lint + typecheck + build pass.
- [ ] Smoke-проверка каждого диалога вручную (или в test mode после PR).
- [ ] PR opened, CI green.

**Risk:** средний — диалоги критичны (paywall, переименование, share).
Каждую миграцию делаем атомарно, поэтому если что-то вылезет — ловим
в diff одного файла.

---

## PR 3 — Unified PWA safe-area handling

- [ ] Аудит: какие top-level контейнеры страниц забыли про `pt-safe` /
      `pl-safe` / `pr-safe`.
- [ ] Унифицировать в `<AppLayout>` / `<PageContainer>` примитиве,
      чтобы любая новая страница автоматически получала корректные
      инсеты.
- [ ] `FullscreenPlayer`: notch + home-indicator. Сейчас работает в
      целом, проверить углы (свайпы, кнопка close, прогресс-бар).
- [ ] `MobileBottomDock`: уже использует `env(safe-area-inset-bottom)`,
      проверить, что не двоится с `pb-safe`.
- [ ] Toast host: уже учитывает чёлку, верифицировать.
- [ ] Sidebar: уже учитывает desktop PWA top-inset, оставляем.
- [ ] Landing / OnboardingTour: проверить, что не уезжают под чёлку.
- [ ] Добавить utility `pb-safe-dock` (env-bottom + var(--player-height)).
- [ ] Lint + typecheck + build pass.
- [ ] PR opened, CI green.

**Risk:** низкий. Только padding / safe-area правки, без рендер-логики.

---

## PR 4 — Redesign album / artist / playlist pages (mobile-first hero)

Это самая визуально-заметная часть. Все три страницы переезжают на
общий `<PageHero>` (PR 1) и общий `<IconButton>` (PR 1):

- [ ] `AlbumPage` — hero с обложкой и мета через `<PageHero>`.
- [ ] `ArtistPage` — hero с фото / fallback-аватаром через `<PageHero>`.
- [ ] `PlaylistPage` — hero с обложкой / `Heart` для liked /
      `ListMusic` fallback через `<PageHero>`.
- [ ] Все action-кнопки (`like`, `dislike`, `share`, `follow`,
      `pin`, `offline-save`) — через `<IconButton>`.
- [ ] Главный CTA (`Play / Pause / Continue`) — единый компонент.
- [ ] Mobile-первый layout: hero collapses в стек, кнопки переносятся
      аккуратно, тапы не уходят под нижний док.
- [ ] Skeleton loaders унифицируем под общий `<PageHeroSkeleton>`.
- [ ] Не трогаем content под hero (track list / albums grid /
      similar artists) — только верх и стиль кнопок.
- [ ] Lint + typecheck + build pass.
- [ ] PR opened, CI green.

**Risk:** средний — визуальная регрессия возможна, поэтому в test
mode прогоняем все три страницы на mobile + desktop, с
обложкой / без обложки.

---

## PR 5 — i18n audit

- [ ] `OfflineProgressIcon.tsx:87` — `aria-label='Загрузка'` →
      перенести в `ru/en.json` (например, `offline.progressAria`).
- [ ] Прогнать regex по `src/**/*.{ts,tsx}` на хардкоды русских строк
      (исключая `// комментарии`, JSDoc, имена переменных).
- [ ] Прогнать regex на хардкоды английских user-facing строк.
- [ ] `displayName` для liked playlist: проверить, что fallback
      `playlist.name` для не-liked плейлистов не зависит от русского
      бэкенд-имени (если зависит — задокументировать в notes).
- [ ] Lint + typecheck + build pass.
- [ ] PR opened, CI green.

**Risk:** очень низкий — добавление ключей и замена строк.

---

## PR 6 — Polish

- [ ] Сократить устаревшие многострочные комментарии (особенно в
      `Player.tsx`, `FullscreenPlayer.tsx`, `MobileBottomDock.tsx`,
      где описаны фиксы за прошлые баги — оставляем краткое "почему",
      убираем нарратив).
- [ ] Убрать оставшийся хардкод hex-цветов / shadows / paddings,
      заменить на токены из `_tokens.scss`.
- [ ] Унифицировать z-index'ы под `--z-modal` / `--z-toast` /
      `--z-tooltip`.
- [ ] Привести классы кнопок-действий к единому шаблону (после PR 4
      многое уже исчезнет).
- [ ] Удалить очевидно мёртвый код (закомментированные блоки,
      переменные без use), консервативно — только то, в чём
      уверены.
- [ ] Lint + typecheck + build pass.
- [ ] PR opened, CI green.

**Risk:** низкий, но требует внимательности — комментарии часто
содержат критичный context за поведением.

---

## Open questions для пользователя

> Все 8 вопросов разрешены — см. соответствующие `Resolved decisions`
> 1–7 в [`docs/refactor/tracker.md`](docs/refactor/tracker.md).

1. \* **Новый CTA-цвет.** → **Resolved (decision #1):** `--color-accent
   #5E6AD2` остаётся canonical, gradient `accent → magenta → accent` в
   плеере намеренный, унифицирован через `--color-accent-magenta` в
   PR #387.
2. **Шрифт серифа `Instrument Serif`.** → **Resolved (decision #6):**
   оставить как есть, без rebrand'а. Используется как fallback /
   reserved token, удалять не надо.
3. **`liquid-glass` vs `liquid-glass-scrim`.** → **Resolved (decision
   #7):** унифицирован в PR #379 при миграции диалогов на `<Modal>` /
   `<Sheet>` примитивы.
4. **`Bratan Music` brandmark.** → **Resolved (decision #5):** оставить
   константой в коде, rebranding не планируется.
5. **Анимации входа на album/artist/playlist hero.** → **Resolved
   (decision #2):** лёгкий fade-up через `motion` добавлен в PR #381.
6. **PWA top-inset на не-mobile-PWA.** → **Resolved (decision #3):**
   текущее поведение `@media (display-mode: standalone) and (pointer:
   coarse)` оставлено намеренно — desktop-PWA не имеет чёлки.
7. **`OnboardingTour`.** → **Resolved (decision #4):** переведён под
   новые токены в PR #384, плюс iOS-fix комментарии собраны в
   PR #395.
8. **Шрифты в `index.html`.** → **Resolved (decision #6):** Inter +
   Instrument Serif — без изменений.

---

## Live status

> **All milestones merged. Live tracker moved to**
> [`docs/refactor/tracker.md`](docs/refactor/tracker.md).

- [x] Repo cloned, deps installed, baseline lint/typecheck pass.
- [x] Discovery done — план зафиксирован выше.
- [x] Plan attached to user message.
- [x] **PR 1 merged.** [#373](https://github.com/BRATAN-CORP/bratan-music/pull/373).
- [x] **PR 2 merged.** [#379](https://github.com/BRATAN-CORP/bratan-music/pull/379).
- [x] **PR 3 merged.** [#380](https://github.com/BRATAN-CORP/bratan-music/pull/380).
- [x] **PR 4 merged.** [#381](https://github.com/BRATAN-CORP/bratan-music/pull/381).
- [x] **PR 5 merged.** [#382](https://github.com/BRATAN-CORP/bratan-music/pull/382).
- [x] **PR 6 merged.** [#384](https://github.com/BRATAN-CORP/bratan-music/pull/384).
- [x] Follow-up'ы (PR #7..#17) — все merged, см. `tracker.md` Roadmap.

_File frozen as historical 2026-05-08 by Devin session
`https://app.devin.ai/sessions/7f10684789d747179251e486ffb73fe1`.
Live state continues in `docs/refactor/tracker.md`._
