# Tidal API — Исследование

> Документ составлен на основе реверс-инжиниринга python-tidal, hmelder/TIDAL, gkasdorf/Tidal-API-Docs и официального Tidal Developer Portal.

---

## 1. Базовые URL

| Назначение | URL |
|---|---|
| API v1 | `https://api.tidal.com/v1/` |
| API v2 | `https://api.tidal.com/v2/` |
| OpenAPI v2 | `https://openapi.tidal.com/v2/` |
| Auth (token) | `https://auth.tidal.com/v1/oauth2/token` |
| Login (PKCE) | `https://login.tidal.com/authorize` |
| Device Auth | `https://auth.tidal.com/v1/oauth2/device_authorization` |
| Изображения | `https://resources.tidal.com/images/{IMAGE_ID}/{W}x{H}.jpg` |
| Изображения (оригинал) | `https://resources.tidal.com/images/{IMAGE_ID}/origin.jpg` |

---

## 2. Аутентификация

### 2.1 Device Authorization Flow (OAuth 2.0 RFC 8628)

Рекомендуемый flow для серверного приложения. Не требует reCaptcha.

**Шаг 1: Запрос device code**

```http
POST https://auth.tidal.com/v1/oauth2/device_authorization
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}&scope=r_usr+w_usr+w_sub
```

Ответ:
```json
{
  "deviceCode": "unique-device-code",
  "userCode": "ABC123",
  "verificationUri": "https://listen.tidal.com/device",
  "verificationUriComplete": "https://listen.tidal.com/device?code=ABC123",
  "expiresIn": 300,
  "interval": 2
}
```

**Шаг 2: Polling для получения токена**

Пользователь переходит по `verificationUri` и вводит `userCode`. Клиент опрашивает:

```http
POST https://auth.tidal.com/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&device_code={DEVICE_CODE}&scope=r_usr+w_usr+w_sub
```

Ожидание (400):
```json
{ "error": "authorization_pending", "error_description": "User hasn't authorized yet" }
```

Успех (200):
```json
{
  "access_token": "eyJ...",
  "refresh_token": "abc123...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "r_usr w_usr w_sub"
}
```

### 2.2 PKCE Flow (для Hi-Res аудио)

PKCE обязателен для доступа к `HI_RES_LOSSLESS` потокам.

```
GET https://login.tidal.com/authorize?
  response_type=code&
  redirect_uri=https://tidal.com/android/login/auth&
  client_id={PKCE_CLIENT_ID}&
  lang=EN&
  appMode=android&
  client_unique_key={CLIENT_UNIQUE_KEY}&
  code_challenge={CODE_CHALLENGE}&
  code_challenge_method=S256&
  restrict_signup=true
```

Обмен кода на токен:
```http
POST https://auth.tidal.com/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={AUTH_CODE}&client_id={PKCE_CLIENT_ID}&redirect_uri=https://tidal.com/android/login/auth&code_verifier={CODE_VERIFIER}&client_unique_key={CLIENT_UNIQUE_KEY}&scope=r_usr+w_usr+w_sub
```

### 2.3 Обновление токена (Refresh)

```http
POST https://auth.tidal.com/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

Ответ:
```json
{
  "access_token": "new_access_token",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### 2.4 Инициализация сессии

```http
GET https://api.tidal.com/v1/sessions
Authorization: Bearer {ACCESS_TOKEN}
```

Ответ:
```json
{
  "sessionId": "uuid-string",
  "userId": 123456,
  "countryCode": "US"
}
```

### 2.5 Известные Client ID / Secret

Из python-tidal (Device Auth flow):
- `client_id`: `fX2JxdmntZWK0ixT` (может измениться)
- `client_secret`: `1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=`

---

## 3. Обязательные заголовки

```http
Authorization: Bearer {ACCESS_TOKEN}
User-Agent: Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36
x-tidal-client-version: 2025.7.16
```

### Обязательные query-параметры

| Параметр | Описание |
|---|---|
| `sessionId` | UUID сессии из `/sessions` |
| `countryCode` | Код страны пользователя (напр. "US", "RU") |

---

## 4. Поиск

```http
GET /v1/search?
  query={QUERY}&
  types=ARTISTS,ALBUMS,TRACKS,VIDEOS,PLAYLISTS&
  limit=25&
  offset=0&
  countryCode={CC}
```

Заголовки: `Authorization: Bearer {ACCESS_TOKEN}`

Ответ:
```json
{
  "artists": { "items": [/* Artist objects */], "totalNumberOfItems": 100 },
  "albums": { "items": [/* Album objects */], "totalNumberOfItems": 500 },
  "tracks": { "items": [/* Track objects */], "totalNumberOfItems": 1000 },
  "videos": { "items": [/* Video objects */], "totalNumberOfItems": 50 },
  "playlists": { "items": [/* Playlist objects */], "totalNumberOfItems": 200 },
  "topHit": { "type": "TRACKS", "value": {/* Track object */} }
}
```

---

## 5. Треки

### Получить трек

```http
GET /v1/tracks/{trackId}?countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

Ответ:
```json
{
  "id": 12345678,
  "title": "Track Title",
  "duration": 240,
  "version": "Radio Edit",
  "explicit": true,
  "popularity": 85,
  "trackNumber": 1,
  "volumeNumber": 1,
  "isrc": "USRC12345678",
  "streamReady": true,
  "allowStreaming": true,
  "audioQuality": "LOSSLESS",
  "audioModes": ["STEREO"],
  "mediaMetadata": { "tags": ["LOSSLESS", "HIRES_LOSSLESS"] },
  "artist": { "id": 123, "name": "Artist Name" },
  "artists": [
    { "id": 123, "name": "Artist Name", "type": "MAIN" },
    { "id": 456, "name": "Featured Artist", "type": "FEATURED" }
  ],
  "album": { "id": 789, "title": "Album Title", "cover": "image-uuid" },
  "streamStartDate": "2024-01-01T00:00:00.000Z"
}
```

### Текст трека

```http
GET /v1/tracks/{trackId}/lyrics?countryCode={CC}
```

### Радио трека (похожие)

```http
GET /v1/tracks/{trackId}/radio?limit=25&offset=0&countryCode={CC}
```

---

## 6. Альбомы

### Получить альбом

```http
GET /v1/albums/{albumId}?countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

### Треки альбома

```http
GET /v1/albums/{albumId}/tracks?limit=100&offset=0&countryCode={CC}
```

### Все элементы альбома (треки + видео)

```http
GET /v1/albums/{albumId}/items?limit=100&offset=0&countryCode={CC}
```

### Похожие альбомы

```http
GET /v1/albums/{albumId}/similar?limit=10&countryCode={CC}
```

---

## 7. Артисты

### Получить артиста

```http
GET /v1/artists/{artistId}?countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

### Альбомы артиста

```http
GET /v1/artists/{artistId}/albums?limit=50&offset=0&filter=ALBUMS&countryCode={CC}
```

Значения filter: `ALBUMS`, `EPSANDSINGLES`, `COMPILATIONS`

### Топ-треки артиста

```http
GET /v1/artists/{artistId}/toptracks?limit=10&offset=0&countryCode={CC}
```

### Похожие артисты

```http
GET /v1/artists/{artistId}/similar?limit=10&countryCode={CC}
```

---

## 8. Стриминг и воспроизведение (КРИТИЧЕСКИ ВАЖНО)

### 8.1 Получить информацию о воспроизведении

Основной endpoint для получения URL потока:

```http
GET /v1/tracks/{trackId}/playbackinfopostpaywall?
  audioquality={QUALITY}&
  playbackmode=STREAM&
  assetpresentation=FULL&
  countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

Значения `audioquality`: `LOW`, `HIGH`, `LOSSLESS`, `HI_RES_LOSSLESS`

Ответ:
```json
{
  "trackId": 12345678,
  "audioMode": "STEREO",
  "audioQuality": "LOSSLESS",
  "manifestMimeType": "application/vnd.tidal.bts",
  "manifestHash": "abc123...",
  "manifest": "eyJjb2RlY3Mi...==",
  "albumReplayGain": -11.8,
  "albumPeakAmplitude": 1.0,
  "trackReplayGain": -9.62,
  "trackPeakAmplitude": 1.0,
  "bitDepth": 16,
  "sampleRate": 44100
}
```

### 8.2 Формат манифеста BTS (application/vnd.tidal.bts)

Используется для LOW, HIGH и LOSSLESS. Поле `manifest` — base64-encoded JSON:

```json
{
  "urls": ["https://audio.tidal.com/..."],
  "codecs": "mp4a.40.2",
  "mimeType": "audio/mp4",
  "encryptionType": "NONE",
  "keyId": null
}
```

Кодеки:
- `mp4a.40.2` — AAC-LC
- `flac` — FLAC lossless

### 8.3 Формат MPEG-DASH (application/dash+xml)

Используется для HI_RES_LOSSLESS. Поле `manifest` — base64-encoded MPD XML.

### 8.4 Прямой URL (только для Device Auth, не PKCE)

```http
GET /v1/tracks/{trackId}/urlpostpaywall?
  audioquality={QUALITY}&
  urlusagemode=STREAM&
  assetpresentation=FULL&
  countryCode={CC}
```

---

## 9. Качество аудио

| Значение | Описание | Формат |
|---|---|---|
| `LOW` | Низкое качество | 96 kbps AAC |
| `HIGH` | Высокое качество | 320 kbps AAC |
| `LOSSLESS` | CD-качество | 16-bit/44.1kHz FLAC |
| `HI_RES_LOSSLESS` | Hi-Res | 24-bit до 192kHz FLAC |

## 10. Кодеки

| Кодек | MIME-тип | Расширение | Качество |
|---|---|---|---|
| MP3 | audio/mpeg | .mp3 | LOW |
| AAC | audio/mp4 | .m4a | LOW, HIGH |
| FLAC | audio/flac | .flac | LOSSLESS, HI_RES |
| EAC3 | audio/eac3 | .m4a | Dolby Atmos |

---

## 11. Изображения

Формат URL: `https://resources.tidal.com/images/{IMAGE_ID}/{W}x{H}.jpg`

IMAGE_ID в ответах API — это UUID с дефисами. Для URL нужно заменить `-` на `/`.

| Сущность | Поддерживаемые размеры |
|---|---|
| Album | 80, 160, 320, 640, 1280, 3000, origin |
| Artist | 160, 320, 480, 750 |
| Playlist | 160, 320, 480, 640, 750, 1080 |
| User | 100, 210, 600 |

---

## 12. Пагинация

| Параметр | По умолчанию | Макс. |
|---|---|---|
| `limit` | 50 | 10000 |
| `offset` | 0 | — |

## 13. Сортировка

| Параметр | Значения |
|---|---|
| `order` | NAME, DATE, ARTIST, ALBUM, INDEX, LENGTH, RELEASE_DATE |
| `orderDirection` | ASC, DESC |

---

## 14. Библиотека пользователя

### Добавить в избранное

```http
POST /v1/users/{userId}/favorites/tracks
Content-Type: application/x-www-form-urlencoded

trackId=123,456,789
```

Аналогично для: `/favorites/albums`, `/favorites/artists`, `/favorites/videos`

### Получить избранное

```http
GET /v1/users/{userId}/favorites/tracks?limit=100&offset=0&order=DATE&orderDirection=DESC&countryCode={CC}
```

### Удалить из избранного

```http
DELETE /v1/users/{userId}/favorites/tracks/{trackId}?countryCode={CC}
```

---

## 15. Выводы для реализации

### Рекомендуемый flow авторизации для BRATAN MUSIC:

1. **Device Authorization Flow** — основной. Не требует браузера на стороне сервера, нет reCaptcha.
2. Сохранять `access_token` и `refresh_token` в Cloudflare KV с TTL.
3. При истечении `access_token` использовать `refresh_token` для обновления.
4. `countryCode` получать из `/sessions` после авторизации.

### Получение потока аудио:

1. Запросить `/tracks/{id}/playbackinfopostpaywall` с нужным качеством.
2. Декодировать `manifest` из base64.
3. Для BTS — извлечь `urls[0]` (прямая ссылка на аудио).
4. Проксировать аудио-поток через Workers (добавляя нужные заголовки).

### Важные ограничения:

- Client ID может измениться (Tidal обновляет периодически).
- reCaptcha v3 защищает веб-flow (поэтому используем Device Auth).
- Некоторые endpoint'ы требуют `sessionId` в query.
- Rate limiting на стороне Tidal — нужно кешировать результаты.

---

## 16. Источники

- [python-tidal](https://github.com/tamland/python-tidal) — Python-клиент, основной референс
- [hmelder/TIDAL](https://github.com/hmelder/TIDAL) — документация реверс-инжиниринга (82 endpoint'а)
- [gkasdorf/Tidal-API-Docs](https://github.com/gkasdorf/Tidal-API-Docs) — дополнительная документация
- [placeboplayer/TIDAL_API_REFERENCE.md](https://git.dsg.is/dsg/placeboplayer) — комплексный справочник
- [TIDAL Developer Portal](https://developer.tidal.com) — официальная документация (ограниченная)
