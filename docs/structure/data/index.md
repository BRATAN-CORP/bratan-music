# Data (D1 / KV / R2 / DO)

Все хранилища: SQLite (D1), key-value (KV), object storage (R2),
Durable Objects.

## D1 — `bratan-music-db`

`database_id = af567808-4d71-4248-89f0-4681371dc771`. Биндинг — `DB`.

### Таблицы (highlights)

| Таблица | Что хранит |
| --- | --- |
| `users` | Telegram-id keyed, `tg_username`, `tg_name`, `is_admin`, `is_banned`, `created_at`. |
| `sessions` | Refresh-token hashes per device, `expires_at`, `last_used_at`. |
| `playlists` | Owner, name, description, cover URL, public/private, share token, `source_kind` (`user` / `tidal` / null), pinned timestamp. |
| `playlist_tracks` | Junction: `playlist_id`, `track_id`, `position`, `snapshot` (JSON: cover/artist/title для offline render). |
| `library_items` | Likes (track / album / artist). |
| `user_tracks` | Custom uploads: id, R2 key, mime, size, metadata. |
| `track_overrides` | Per-user "stream this file instead of the Tidal track" mapping. |
| `subscriptions` | `active` / `expired` / `manual`, `telegram_payment_charge_id` (UNIQUE), `started_at`, `expires_at`. |
| `daily_listen_tracks` | Free-tier 3-tracks/day quota (deduped). |
| `play_history` | Listening history (с playback context). |
| `auth_nonces` | Single-use 5-min nonces для deep-link login. |
| `listening_rooms` | Комнаты: id, host, name, created_at. |
| `listening_room_members` | Members + role. |
| `listening_room_state` | Server-anchored player state (track, position, version, host_only_control). |
| `room_chat_messages` | История чата. |
| `tidal_pool` | Multi-account refresh tokens (encrypted) для горизонтального масштабирования Tidal-бэка. |
| `recommendation_seen` | Rolling 30 дней — что уже показывали в дневных плейлистах. |
| `user_taste_profile` | Feature-вектор для AI-плейлистов. |
| `user_dislikes` | Tracks / artists, которые пользователь дизлайкнул. |
| `health_logs` | Ring buffer для админ-панели. |

### Миграции (`worker/src/db/migrations/`)

24 файла, `0001_init.sql` … `0024_play_history_artists.sql`. Применяются
автоматически workflow'ом `apply-d1-migrations.yml`. Локально:

```bash
cd worker
npx wrangler d1 migrations apply bratan-music-db --local   # local dev DB
npx wrangler d1 migrations apply bratan-music-db --remote  # production
```

**Правило:** уже применённые миграции не редактируем. Новая = новый
файл `00NN_<name>.sql`.

Снимок схемы: [`worker/src/db/schema.sql`](../../../worker/src/db/schema.sql).

## KV — `SESSIONS`

`id = 2f2ca120b5104617a262332524b27190`. Биндинг — `SESSIONS`.

| Префикс | Что хранит |
| --- | --- |
| `tidal:session` | Encrypted Tidal session (AES-GCM), refresh раз в 60 минут. |
| `tidal:country` | `countryCode` для пользователя (Tidal regional). |
| `stream:<trackId>` | Memo stream-URL (TTL на длину presigned URL). |
| `auth:nonce:<id>` | Single-use 5-min nonce (продублировано с `auth_nonces` D1 для скорости). |
| `rate:*` | Rate-limit counters. |

## R2 — `bratanmusic-tracks`

Биндинг — `TRACKS`.

| Префикс | Назначение |
| --- | --- |
| `uploads/<userId>/<trackId>` | Custom uploads пользователя (50 MB cap). |
| `overrides/<userId>/<trackId>` | Override Tidal-трека. |
| `covers/<sha>` | Cached covers (для offline / privacy proxy). |

R2 keys валидируются: `^[a-zA-Z0-9_-]{1,64}$`, без path-traversal.

## Durable Objects

| Класс | Биндинг | Назначение |
| --- | --- | --- |
| `ChatRoomDO` | `CHAT_ROOM` | Per-room WS broadcast hub. Stateless (`Set<WebSocket>`); D1 — источник правды для history. |

Адресация: `env.CHAT_ROOM.idFromName(roomId)`. На Free-плане
используется `new_sqlite_classes` (вместо paid-tier `new_classes`).

Migration tag: `v1-chat-room-do`. Список migrations append-only.

## Конкретные ID и значения (production)

| Ключ | Значение |
| --- | --- |
| Worker name | `bratan-music-api` |
| API URL | `https://bratan-music-api.bratan-corp.workers.dev` |
| D1 DB name | `bratan-music-db` |
| D1 DB id | `af567808-4d71-4248-89f0-4681371dc771` |
| KV namespace id | `2f2ca120b5104617a262332524b27190` |
| R2 bucket | `bratanmusic-tracks` |
| Cron schedule | `30 4 * * *` UTC |

## Ссылки

- Wrangler config: [`worker/wrangler.toml`](../../../worker/wrangler.toml)
- Schema snapshot: [`worker/src/db/schema.sql`](../../../worker/src/db/schema.sql)
- Migrations: [`worker/src/db/migrations/`](../../../worker/src/db/migrations/)
