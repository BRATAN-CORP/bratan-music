# BRATAN MUSIC — audit TODO

Дата аудита: 2026-04-26

## P0 — критично для production

- [ ] Настроить Telegram BotFather:
  - [ ] `/setdomain` → `bratan-corp.github.io`
  - [ ] Web App URL → `https://bratan-corp.github.io/bratan-music/`
  - [ ] Menu Button → открыть Web App
  - [ ] webhook → `https://bratan-music-api.bratan-corp.workers.dev/webhook/telegram`
- [ ] Проверить production secrets в Cloudflare Worker:
  - [ ] `TELEGRAM_BOT_TOKEN`
  - [ ] `TELEGRAM_BOT_USERNAME`
  - [ ] `TELEGRAM_WEBHOOK_SECRET`
  - [ ] `TELEGRAM_ADMIN_IDS`
  - [ ] `JWT_SECRET`
  - [ ] `JWT_REFRESH_SECRET`
  - [ ] `SESSION_ENCRYPTION_KEY`
  - [ ] `TIDAL_CLIENT_ID`
  - [ ] `TIDAL_CLIENT_SECRET`
  - [ ] `TIDAL_SESSION_TOKEN`
- [ ] Перевыпустить Tidal bearer/session token, который был отправлен в чат, и обновить `TIDAL_SESSION_TOKEN` в Cloudflare.
- [ ] Проверить Tidal end-to-end вручную:
  - [ ] поиск `Shape of You`
  - [ ] открытие трека
  - [ ] открытие альбома
  - [ ] открытие артиста
  - [ ] получение stream URL
  - [ ] получение download URL
- [ ] Исправить streaming overrides: `/tracks/:id/stream` сейчас возвращает `r2_key` как `url` для override-трека; frontend ожидает playable URL. Нужно возвращать `/tracks/:id/override/stream` или signed/proxied URL.
- [ ] Исправить `/library/playlists` и `/playlists` response mapping под frontend `Playlist`:
  - [ ] `track_count` → `trackCount`
  - [ ] `is_liked` → `isLiked`
  - [ ] `updated_at` → `updatedAt`
- [ ] Исправить liked/playlist tracks: backend хранит только `track_id/source`, frontend ожидает полноценные `Track` объекты. Нужно hydrate metadata из Tidal/cache.
- [ ] Добавить server-side validation для playlist names и upload metadata:
  - [ ] max length
  - [ ] allowed audio MIME types
  - [ ] max file size
- [ ] Убедиться, что download route защищён JWT и daily/subscription policy, если это требуется продуктово.

## P1 — обязательный продуктовый функционал

- [ ] Добавить UI для добавления трека в выбранный плейлист.
- [ ] Добавить UI для удаления трека из плейлиста.
- [ ] Добавить UI для unlike.
- [ ] Встроить `TrackOverrideModal` в track/player/library flows.
- [ ] Добавить страницу/секцию liked tracks.
- [ ] Добавить управление плейлистами:
  - [ ] rename
  - [ ] delete
  - [ ] empty state
  - [ ] loading/error states
- [ ] Добавить UI для скачивания трека.
- [ ] Добавить frontend handling лимита 3 трека/сутки и CTA на подписку.
- [ ] Добавить экран подписки и понятный Telegram Stars flow из WebApp.
- [ ] Добавить admin UI или расширить bot admin panel:
  - [ ] просмотр пользователей
  - [ ] выдача/отмена подписки
  - [ ] управление Tidal/service accounts

## P2 — архитектура и масштабирование

- [ ] Добавить abstraction layer для музыкальных провайдеров (`tidal`, затем `soundcloud`, `youtube`).
- [ ] Добавить encrypted storage для service account credentials, сейчас таблица `service_accounts.credentials` есть, но не используется.
- [ ] Добавить rotation/refresh pipeline для Tidal session token.
- [ ] Добавить metadata cache для tracks/albums/artists, чтобы не ходить в Tidal на каждый render.
- [ ] Добавить structured logging без секретов.
- [ ] Добавить миграции для будущих изменений схемы вместо ручного изменения `schema.sql`.
- [ ] Добавить e2e smoke checklist для ручного тестирования перед merge/deploy.

## P3 — polish

- [ ] Убрать оставшиеся inline styles в старых UI utility компонентах (`EmptyState`, `ErrorFallback`, `Skeleton`) и привести их к shadcn-style.
- [ ] Перевести Sass `@import` на `@use`, чтобы убрать deprecation warning.
- [ ] Добавить skeleton/error states на album/artist/track/library pages.
- [ ] Проверить PWA installability и offline fallback после каждого deploy.
