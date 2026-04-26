# Tidal API — Исследование

> Документ составлен на основе:
> 1. **Реальных запросов из DevTools** (захвачены вручную из tidal.com, апрель 2026)
> 2. Реверс-инжиниринга python-tidal, hmelder/TIDAL, gkasdorf/Tidal-API-Docs
> 3. Официального Tidal Developer Portal

---

## 1. Базовые URL

| Назначение | URL | Примечание |
|---|---|---|
| **Web Proxy (основной)** | `https://tidal.com/v1/...` и `https://tidal.com/v2/...` | Same-origin proxy, используется веб-приложением |
| API v1 (direct) | `https://api.tidal.com/v1/` | Прямой доступ к API |
| API v2 (direct) | `https://api.tidal.com/v2/` | |
| Auth (token) | `https://auth.tidal.com/v1/oauth2/token` | |
| Device Auth | `https://auth.tidal.com/v1/oauth2/device_authorization` | |
| Login (PKCE) | `https://login.tidal.com/authorize` | |
| **Аудио-стрим** | `https://sp-ad-fa.audio.tidal.com/mediatracks/...` | CDN для аудио-файлов |
| Изображения | `https://resources.tidal.com/images/{IMAGE_ID}/{W}x{H}.jpg` | |

**Важно:** Веб-приложение Tidal использует same-origin proxy через `tidal.com/v1/` и `tidal.com/v2/` вместо прямых запросов к `api.tidal.com`. Для Workers-прокси мы будем использовать `api.tidal.com` напрямую.

---

## 2. Аутентификация

### 2.1 Структура JWT-токена (из реального запроса)

Декодированный payload Bearer-токена из веб-сессии:
```json
{
  "type": "o2_access",
  "uid": 208159949,
  "scope": "w_usr r_usr",
  "gVer": 0,
  "sVer": 0,
  "cid": 8049,
  "cuk": "71f32269-9a05-4f4a-9eca-e63332568d40",
  "cc": "BR",
  "at": "INTERNAL",
  "exp": 1777222566,
  "sid": "2446a602-58c6-41ad-a0e4-2ec197844337",
  "iss": "https://auth.tidal.com/v1"
}
```

Ключевые поля:
- `cid`: **8049** — client_id для веб-приложения (числовой)
- `uid`: user ID
- `sid`: session ID
- `cc`: country code (BR)
- `at`: "INTERNAL" — тип доступа
- `scope`: "w_usr r_usr"

### 2.2 Device Authorization Flow (OAuth 2.0 RFC 8628)

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

```http
POST https://auth.tidal.com/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&device_code={DEVICE_CODE}&scope=r_usr+w_usr+w_sub
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

### 2.3 PKCE Flow (для Hi-Res аудио)

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

### 2.4 Обновление токена (Refresh)

```http
POST https://auth.tidal.com/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

### 2.5 Инициализация сессии

```http
GET https://api.tidal.com/v1/sessions
Authorization: Bearer {ACCESS_TOKEN}
```

Ответ:
```json
{
  "sessionId": "2446a602-58c6-41ad-a0e4-2ec197844337",
  "userId": 208159949,
  "countryCode": "BR"
}
```

### 2.6 Известные Client ID

| Источник | client_id | Тип |
|---|---|---|
| **Веб-приложение (tidal.com)** | `8049` | Числовой, из JWT |
| python-tidal (Device Auth) | `fX2JxdmntZWK0ixT` | Строковый |
| python-tidal (client_secret) | `1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=` | |

---

## 3. Обязательные заголовки (из реальных запросов)

```http
Authorization: Bearer {ACCESS_TOKEN}
Accept: application/json
x-tidal-client-version: 2026.4.23
```

### Обязательные query-параметры

| Параметр | Описание | Пример |
|---|---|---|
| `countryCode` | Код страны пользователя | `BR` |
| `locale` | Локаль | `en_US` |
| `deviceType` | Тип устройства | `BROWSER` |

---

## 4. Поиск (РЕАЛЬНЫЙ ЗАПРОС)

```http
GET https://tidal.com/v2/search/?
  includeContributors=true&
  includeDidYouMean=true&
  includeUserPlaylists=true&
  limit=20&
  query={QUERY}&
  supportsUserData=true&
  types=ARTISTS,ALBUMS,TRACKS,VIDEOS,PLAYLISTS,UPLOADS&
  countryCode={CC}&
  locale=en_US&
  deviceType=BROWSER
Authorization: Bearer {ACCESS_TOKEN}
```

Или через direct API:
```http
GET https://api.tidal.com/v1/search?
  query={QUERY}&
  types=ARTISTS,ALBUMS,TRACKS,VIDEOS,PLAYLISTS&
  limit=25&
  offset=0&
  countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

Дополнительные параметры v2 (веб):
- `includeContributors=true`
- `includeDidYouMean=true`
- `includeUserPlaylists=true`
- `supportsUserData=true`
- `types`: включает `UPLOADS` (пользовательские загрузки)

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

## 6. Альбомы (РЕАЛЬНЫЙ ЗАПРОС)

### Страница альбома (веб-формат)

```http
GET https://tidal.com/v1/pages/album?
  albumId={ALBUM_ID}&
  countryCode={CC}&
  locale=en_US&
  deviceType=BROWSER
Authorization: Bearer {ACCESS_TOKEN}
```

Пример: `albumId=457912926`

### Получить альбом (direct API)

```http
GET https://api.tidal.com/v1/albums/{albumId}?countryCode={CC}
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

## 7. Артисты (РЕАЛЬНЫЙ ЗАПРОС)

### Топ-треки артиста (веб-формат)

```http
GET https://tidal.com/v2/artist/ARTIST_TOP_TRACKS/view-all?
  artistId={ARTIST_ID}&
  locale=en_US&
  countryCode={CC}&
  deviceType=BROWSER&
  platform=WEB&
  limit=50&
  offset=0
Authorization: Bearer {ACCESS_TOKEN}
```

Пример: `artistId=3995478` (Ed Sheeran)

### Получить артиста (direct API)

```http
GET https://api.tidal.com/v1/artists/{artistId}?countryCode={CC}
Authorization: Bearer {ACCESS_TOKEN}
```

### Альбомы артиста

```http
GET /v1/artists/{artistId}/albums?limit=50&offset=0&filter=ALBUMS&countryCode={CC}
```

Значения filter: `ALBUMS`, `EPSANDSINGLES`, `COMPILATIONS`

### Топ-треки артиста (direct API)

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
  "urls": ["https://sp-ad-fa.audio.tidal.com/mediatracks/..."],
  "codecs": "mp4a.40.2",
  "mimeType": "audio/mp4",
  "encryptionType": "NONE",
  "keyId": null
}
```

Кодеки:
- `mp4a.40.2` — AAC-LC
- `flac` — FLAC lossless

### 8.3 Реальный URL аудио-потока (из DevTools)

```
https://sp-ad-fa.audio.tidal.com/mediatracks/{ENCODED_TRACK_PATH}/{SEGMENT}.mp4?token={TOKEN}
```

Пример:
```
https://sp-ad-fa.audio.tidal.com/mediatracks/GisIAxIn...62Lm1wNCIhsx.../0.mp4?token=3924692492~...
```

Особенности:
- URL содержит закодированный путь к треку
- `token` — одноразовый токен для доступа к CDN
- Сегмент `0.mp4` — начальный сегмент аудио
- **Не требует Authorization header** (аутентификация через token в URL)
- `credentials: "omit"` — куки не отправляются

### 8.4 Формат MPEG-DASH (application/dash+xml)

Используется для HI_RES_LOSSLESS. Поле `manifest` — base64-encoded MPD XML.

### 8.5 Прямой URL (только для Device Auth, не PKCE)

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

## 15. Выводы для реализации BRATAN MUSIC

### Архитектура проксирования:

```
Клиент (браузер) → Workers API → api.tidal.com
                                → sp-ad-fa.audio.tidal.com (аудио)
```

### Рекомендуемый flow авторизации:

1. **Device Authorization Flow** — основной. Не требует браузера на стороне сервера, нет reCaptcha.
2. Сохранять `access_token` и `refresh_token` в Cloudflare KV с TTL.
3. При истечении `access_token` использовать `refresh_token` для обновления.
4. `countryCode` получать из JWT payload (поле `cc`) или из `/sessions`.

### Получение потока аудио:

1. Запросить `/tracks/{id}/playbackinfopostpaywall` с нужным качеством.
2. Декодировать `manifest` из base64.
3. Для BTS — извлечь `urls[0]` (прямая ссылка на `sp-ad-fa.audio.tidal.com`).
4. URL аудио **не требует Bearer-токен** — аутентификация через `token` в query string.
5. Workers могут либо проксировать поток, либо отдавать URL клиенту напрямую.

### Ключевые различия web-приложения vs direct API:

| Аспект | Web (tidal.com) | Direct (api.tidal.com) |
|---|---|---|
| Поиск | `/v2/search/` с доп. параметрами | `/v1/search` |
| Альбом | `/v1/pages/album?albumId=...` | `/v1/albums/{id}` |
| Артист | `/v2/artist/ARTIST_TOP_TRACKS/view-all` | `/v1/artists/{id}/toptracks` |
| Аудио | `sp-ad-fa.audio.tidal.com` (без auth) | То же через manifest |
| Доп. параметры | `locale`, `deviceType`, `platform` | `countryCode` |

### Важные ограничения:

- Client ID может измениться (Tidal обновляет периодически).
- reCaptcha v3 защищает веб-flow (поэтому используем Device Auth).
- `x-tidal-client-version` нужно обновлять (текущая: `2026.4.23`).
- Rate limiting на стороне Tidal — нужно кешировать результаты.

---

## 16. Источники

- **Реальные запросы из DevTools** (захвачены пользователем, апрель 2026)
- [python-tidal](https://github.com/tamland/python-tidal) — Python-клиент, основной референс
- [hmelder/TIDAL](https://github.com/hmelder/TIDAL) — документация реверс-инжиниринга (82 endpoint'а)
- [gkasdorf/Tidal-API-Docs](https://github.com/gkasdorf/Tidal-API-Docs) — дополнительная документация
- [placeboplayer/TIDAL_API_REFERENCE.md](https://git.dsg.is/dsg/placeboplayer) — комплексный справочник
- [TIDAL Developer Portal](https://developer.tidal.com) — официальная документация (ограниченная)
