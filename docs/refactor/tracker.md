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
| 8   | `devin/1778246144-refactor-daily-variant`    | DRY daily-playlist variant theme + plural helper     | open     | _(opens after push)_                                            |

`#7` — отдельный pass под явный запрос пользователя ("куча мусорного кода и
многострочных комментариев"). Делаем после полировки, чтобы не удалять то,
что ещё используется в активных рефакторингах.

`#8` — продолжение запроса "меньше хардкода и повтора кода": один и тот же
25-строчный `VARIANT_THEME` и почти идентичный `dailyTrackUnitKey` жили в
`app/home/page.tsx` и `app/daily/page.tsx`. Вынесены в `src/lib/dailyVariant.ts`.

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

---

## Handoff log

| Когда (UTC)             | Кто (Devin session)                                 | Что сделал                                          |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------- |
| 2026-05-08 ~11:30       | `dcf6f7fd-063d-4797-bbfd-49edc769aa7a`              | PR #373 (foundation), `REFACTOR_PROGRESS.md`        |
| 2026-05-08 ~11:50       | `9363824c-19ed-41b2-9915-dac317a5a082`              | knowledge base (AGENTS.md + docs/), tracker.md      |
| 2026-05-08 ~13:15       | `0c93bc21-a83b-41f7-adb5-9821edc1dfa2` (текущий)    | sync tracker (PR #2..#7 merged) + PR #8             |

> При следующем перехвате — добавь свою строку в этот лог и обнови `Live status`.
