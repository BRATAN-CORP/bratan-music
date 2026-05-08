# AGENTS.md

Точка входа для ИИ-агентов (Devin, Claude, Codex и т.п.), работающих с этим
репозиторием. Файл читается агентом автоматически в начале сессии.

## Роль и задача

Ты — Software Developer, работающий в рамках проекта **BRATAN MUSIC**
(`BRATAN-CORP/bratan-music`). Все изменения вносишь на основе **базы знаний
в `docs/`** и текущей задачи пользователя. База знаний — это локальный аналог
Obsidian-vault: дерево markdown-файлов с wiki-ссылками `[[…]]`. Не нужно
читать весь код для каждой задачи — переходи по ссылкам только в нужный
раздел.

## Что прочитать в первую очередь

1. [`docs/README.md`](docs/README.md) — корень базы знаний: список разделов и
   как с ними работать.
2. [`docs/structure/index.md`](docs/structure/index.md) — карта кода
   (frontend / worker / telegram-bot / data). Это твой главный навигатор по
   реализации.
3. [`docs/context/index.md`](docs/context/index.md) — описание продукта,
   стека, бизнес-правил, ограничений.
4. [`docs/daily-changes/index.md`](docs/daily-changes/index.md) — журнал
   изменений базы знаний и текущих рефакторингов. **Сюда же ты пишешь
   запись после каждой своей задачи.**

## Контракт работы с базой знаний

- **Перед задачей:** читай только релевантные узлы. Для типичных задач
  достаточно: `docs/README.md` → конкретный раздел `structure/<sub>/…` →
  при необходимости `context/`.
- **После задачи:** если ты добавил/удалил/переименовал что-то в коде —
  актуализируй соответствующий файл в `docs/structure/`. Размер файла >300
  строк — раздели на подфайлы.
- **Лог изменений:** добавь запись в
  `docs/daily-changes/YYYY-MM-DD.md` (формат — в
  [`docs/daily-changes/index.md`](docs/daily-changes/index.md)).
- **Tracker:** для длительных рефакторингов веди отдельный файл-трекер в
  `docs/refactor/<имя>.md` со статусом каждой подзадачи. Это позволяет
  следующему агенту перехватить работу без потери контекста.

## Главные правила проекта

- **Default branch:** `main`. PR'ы открывай против `main`.
- **CI:** `npm run lint`, `npm run typecheck`, `npm run build` для frontend
  (`/`) и для worker (`/worker`). Должны проходить до мерджа.
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
  с опциональным scope, например `feat(player): …`.
- **TypeScript строгий**, в коде приложения `any` не используем.
- **Стиль:** Tailwind 3.4 + SCSS (дизайн-токены — в
  `src/styles/_tokens.scss`). Цвета и spacing'и не хардкодим.
- **i18n:** все user-facing строки — через `useT()` / RU + EN словари в
  `src/i18n/locales`. Хардкод языка запрещён.
- **Секреты:** только через Cloudflare Workers Secret store /
  переменные окружения. В репозитории — никаких ключей.
- **D1-миграции:** только новые `0024_…sql`, `0025_…sql`, …; уже
  применённые не редактируем.

## Команды разработки (быстрая шпаргалка)

```bash
# Frontend
npm install
npm run dev          # vite, http://localhost:5173/bratan-music/
npm run lint
npm run typecheck
npm run build

# Worker
cd worker
npm install
npm run dev          # wrangler dev, http://localhost:8787
npm run lint
npm run typecheck
npm run deploy       # вручную (по умолчанию деплой через GitHub Actions)
```

## Что НЕЛЬЗЯ ломать

- **Аудио-движок** (`src/hooks/useAudioPlayer.ts`, `src/components/layout/Player.tsx`,
  `src/components/layout/FullscreenPlayer.tsx`) — пользователю важны:
  гэплесс-кроссфейд, EQ, лирика, fullscreen-плеер с TiltCard, визуализатор.
  Без явной задачи на изменение — не трогаем дизайн и поведение плеера.
- **Аутентификация Telegram WebApp** — HMAC-проверка `initData`,
  JWT-пара, refresh rotation, single-use 5-min nonce.
- **Telegram Stars billing** — идемпотентная активация подписки по
  `telegram_payment_charge_id`.
- **CORS allowlist, RLS на админ-роуты, parameterized SQL** — security-аудит
  пройден, не ослабляй гарантии.

## Документация по предметной области

- Глобальное описание продукта и стека: [`docs/context/index.md`](docs/context/index.md)
- Карта frontend: [`docs/structure/frontend/index.md`](docs/structure/frontend/index.md)
- Карта worker: [`docs/structure/worker/index.md`](docs/structure/worker/index.md)
- Карта Telegram-бота: [`docs/structure/telegram-bot/index.md`](docs/structure/telegram-bot/index.md)
- Данные (D1 / KV / R2 / DO): [`docs/structure/data/index.md`](docs/structure/data/index.md)
- Journal/tracker: [`docs/daily-changes/index.md`](docs/daily-changes/index.md)
