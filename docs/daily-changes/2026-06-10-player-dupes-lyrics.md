# Дубли треков, лирики-близнецы и баги шаффла — fix/player-dupes-and-lyrics-twins

**Когда:** 2026-06-10 (вечер) UTC
**Кто:** Viktor (AI)
**Branch:** `fix/player-dupes-and-lyrics-twins`
**Базис:** `main` @ `e8cd8b9` (после PR #495 и #496)

## Контекст

Пользователь прислал два «разных» трека —
`/track/81198969` и `/track/225824679` — оба «XO Tour Llif3» Lil Uzi
Vert. Это **каталожные близнецы Tidal**: одна и та же запись в двух
изданиях альбома (albumId `81198953`, LOSSLESS vs `225824663`, LOW).
Дедуп везде ключевался только по `source:ID`, поэтому близнецы проходили
парой в волну/рекомендации/дейли и в поиск. У LOW-переиздания вдобавок
нет записи лирики в Tidal (`available:false` подтверждён live-запросом),
хотя у близнеца `81198969` лирика есть.

Плюс баг-хант по плееру нашёл два бага шаффла и один мелкий в диалоге
плейлистов.

## Что изменилось

### Go (api-go)

- **`internal/tidal/dedupe.go` (новый):** `NormalizeForMatch` (переехал
  из `routes/import_likes.go`), `RecordingKey` (ISRC → normalized
  artist|title → id), `DedupeTracksByRecording` — дедуп на уровне
  *записи*: первая позиция сохраняется, более качественное издание
  (LOSSLESS > LOW) заменяет на месте, explicit — тайбрейк.
  Тесты: `dedupe_test.go`.
- **`internal/tidal/normalize.go`:** в маппленный `Track` добавлено поле
  `ISRC` (`isrc,omitempty`), копируется в `MapTrack` из `TrackRaw`.
- **`internal/services/recommendations.go`:** `dedupTracks` теперь
  recording-level (волна, рекомендации, daily-миксы — `daily.go` зовёт
  тот же хелпер). `trackKey`-карты provenance не тронуты.
- **`internal/routes/tidal_routes.go`:**
  - `buildSearchResult` дедупит треки поиска recording-level;
  - `trackLyrics` — **фолбек на близнеца**: если у трека нет лирики,
    ищем твинов через search (ISRC-матч ИЛИ normalized artist+title +
    |Δduration| ≤ 2 c), до 3 попыток `GetTrackLyrics`, отдаём первую
    непустую. Чинит «нет лириков» у `225824679`.
- **`internal/routes/import_likes.go`:** локальный `normalizeForMatch` →
  алиас над `tidal.NormalizeForMatch` (поведение идентично, тесты
  импорта зелёные).

### Frontend

- **`src/store/player.ts`:** шаффл в `next()`/`nextManual()` больше не
  может выбрать ТЕКУЩИЙ трек (раньше `Math.random()*length` иногда
  попадал в него → «та же песня два раза подряд»). Новый
  `pickShuffleIndex` — offset-приём без ре-роллов.
- **`src/hooks/useAudioPlayer.ts`:** «Bug 5 fix» — авто-кроссфейд
  отключён при включённом шаффле: `startCrossfade` /
  `scheduleAutoCrossfade` всегда фейдили в `queue[idx+1]` и молча
  игнорировали случайный выбор стора (шаффл де-факто не работал при
  включённом кроссфейде). Теперь жёсткий переход через `onEnded →
  next()`. Live-read из стора, по образцу Bug 3/4.
- **`src/components/features/AddToPlaylistDialog.tsx`:** при закрытии
  диалога сбрасывается `errorId` — раньше красная ошибка от прошлой
  неудачной попытки висела при следующем открытии.

## Почему

Прямой запрос пользователя: «повторы треков иногда попадаются» + «у
225824679 нету лириксов» + общий баг-хант по плееру/кнопкам/плейлистам.

## Документация в `docs/`

- не менялась (кроме этой записи).

## Проверки

- `go build ./... && go vet ./... && go test ./...` — зелёные
  (включая новые тесты дедупа и существующие тесты импорта).
- `bun run lint` (3 pre-existing warnings в AdminTidalPanel), `tsc
  --noEmit`, `bun run build` — чисто.

## Не вошло / follow-up

- Explicit-twin swap (`swapInExplicitTwins` из TS-worker) по-прежнему не
  портирован; recording-дедуп частично закрывает его explicit-тайбрейком.
- Удаление `worker/` + ci-степов — отдельным PR.
