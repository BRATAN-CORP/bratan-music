package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

// AIPlaylistService — Go port of worker/src/services/AiPlaylistService.ts.
//
// Two-step flow on a single user prompt:
//
//   1. Ask Yandex Foundation Models (gpt-oss-120b via /v1/chat/completions
//      OpenAI-compatible endpoint) to return a *plan* — strict JSON with
//      a name, a description, and 4..MAX_QUERIES Tidal search queries.
//      The model NEVER returns raw track ids — it doesn't know the
//      catalogue.
//   2. Resolve every query against tidal.API.Search in parallel,
//      round-robin merge results so under-represented queries still
//      surface in the output, dedupe by `source:id`.
//
// Errors thrown for the route layer use AIPlaylistError so the caller
// can map status codes back to the JSON envelope without losing the
// original message.

const (
	aiYandexBase           = "https://ai.api.cloud.yandex.net/v1"
	aiTargetTracksDefault  = 20
	aiTargetTracksMax      = 40
	aiMaxQueries           = 12
	aiPromptMaxChars       = 1000
	aiYandexHTTPTimeoutMS  = 45_000
)

// AIPlaylistError is a typed error so the route handler can lift the
// http status verbatim. Mirrors AiPlaylistError in the TS source.
type AIPlaylistError struct {
	Message string
	Status  int
}

func (e *AIPlaylistError) Error() string { return e.Message }

func newAIErr(msg string, status int) *AIPlaylistError {
	return &AIPlaylistError{Message: msg, Status: status}
}

// AIPlanQuery / AIPlan / AIPlaylistPreview mirror the TS interfaces.
type AIPlanQuery struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}
type AIPlan struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Queries     []AIPlanQuery `json:"queries"`
}
type AIPlaylistPreview struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Tracks      []tidal.Track `json:"tracks"`
	Rejected    int           `json:"rejected"`
	Prompt      string        `json:"prompt"`
	Plan        AIPlan        `json:"plan"`
}

// AIPlaylistService is the live (non-stub) implementation. We keep the
// type name identical to the stub in stubs.go and replace the stub via
// build tagging — actually simpler: we delete the stub field set and
// rebuild it here. See stubs.go for the original placeholder.
type AIPlaylistService struct {
	A     *app.App
	tidal *TidalService
	http  *http.Client
}

// NewAIPlaylistService wires the AI service. Yandex creds are
// validated *lazily* on Generate so a deployment without YANDEX_*
// still boots, just returns 503 from /ai/playlists/generate.
func NewAIPlaylistService(a *app.App) *AIPlaylistService {
	return &AIPlaylistService{
		A:     a,
		tidal: NewTidalService(a),
		http: &http.Client{
			Timeout: time.Duration(aiYandexHTTPTimeoutMS) * time.Millisecond,
		},
	}
}

// Generate runs the two-step plan→resolve flow for a user prompt.
// `target` is the desired track count (5..aiTargetTracksMax, default
// aiTargetTracksDefault). Errors returned are *AIPlaylistError when
// the route layer should surface the status verbatim; everything else
// is a plain error treated as 500.
func (s *AIPlaylistService) Generate(ctx context.Context, prompt string, target int) (*AIPlaylistPreview, error) {
	if s.A.Cfg.YandexAPIToken == "" || s.A.Cfg.YandexFolderID == "" {
		return nil, newAIErr("Yandex AI не настроен на сервере. Попроси админа добавить YANDEX_API_TOKEN и YANDEX_FOLDER_ID.", 503)
	}

	cleanPrompt := strings.TrimSpace(prompt)
	if len(cleanPrompt) > aiPromptMaxChars {
		cleanPrompt = cleanPrompt[:aiPromptMaxChars]
	}
	if cleanPrompt == "" {
		return nil, newAIErr("Промпт не может быть пустым", 400)
	}

	want := target
	if want <= 0 {
		want = aiTargetTracksDefault
	}
	if want < 5 {
		want = 5
	}
	if want > aiTargetTracksMax {
		want = aiTargetTracksMax
	}

	plan, err := s.askForPlan(ctx, cleanPrompt, want)
	if err != nil {
		return nil, err
	}
	if len(plan.Queries) == 0 {
		return nil, newAIErr("Модель не смогла придумать поиски — попробуй переформулировать промпт", 422)
	}

	tracks := s.resolvePlan(ctx, plan, want)

	// rejected = sum(limit) - returned (clamped non-negative).
	totalAsked := 0
	for _, q := range plan.Queries {
		totalAsked += q.Limit
	}
	rejected := totalAsked - len(tracks)
	if rejected < 0 {
		rejected = 0
	}
	if len(tracks) > want {
		tracks = tracks[:want]
	}

	name := strings.TrimSpace(plan.Name)
	if len(name) > 80 {
		name = name[:80]
	}
	desc := strings.TrimSpace(plan.Description)
	if len(desc) > 280 {
		desc = desc[:280]
	}

	return &AIPlaylistPreview{
		Name:        name,
		Description: desc,
		Tracks:      tracks,
		Rejected:    rejected,
		Prompt:      cleanPrompt,
		Plan:        plan,
	}, nil
}

// ──────────────────────────────────────────────────────────────────
// Step 1: plan
// ──────────────────────────────────────────────────────────────────

func (s *AIPlaylistService) askForPlan(ctx context.Context, prompt string, want int) (AIPlan, error) {
	system := strings.Join([]string{
		"Ты — музыкальный куратор для глобального каталога Tidal.",
		"Тебе дают короткий промпт на русском или английском (≤200 символов), ты возвращаешь JSON-план.",
		"Ты НЕ знаешь конкретный каталог и НЕ должен придумывать названия треков «из головы» — только формулируешь поисковые запросы.",
		"",
		"ОБЯЗАТЕЛЬНО смешай ОБА языка в queries:",
		"— если промпт на русском, добавь и оригинальные русские термины (например: «русский рок», «дворовая лирика», конкретного артиста на кириллице),",
		"  И их английские эквиваленты («russian rock», «post-soviet wave», латинская транслитерация артистов).",
		"— если промпт на английском, тоже верни и английские, и русские варианты, чтобы покрыть и западный, и русскоязычный каталог Tidal.",
		"Каталог Tidal ищет лучше всего по латинице — поэтому для жанров/настроений предпочитай английский (synthwave, breakcore, lo-fi hip hop).",
		"",
		"Тип запросов варьируй: жанр+эпоха («deep house 2010s»), настроение (\"late night drive\"), конкретный артист (\"Tame Impala\"),",
		"трек-якорь («Mac DeMarco Chamber of Reflection»), альбом (\"Random Access Memories\"), субжанр+гео (\"japanese city pop\"). Не повторяйся.",
		"Хорошие запросы: короткие (1–4 слова), специфические, без знаков препинания, без слова \"music\".",
		"Никаких комментариев и markdown — только чистый JSON по схеме.",
	}, " ")

	schemaSumLimit := (want*16 + 5) / 10 // ceil(want * 1.6)
	schema := map[string]string{
		"name":        "string — короткое название плейлиста (≤ 80 символов), на языке промпта",
		"description": "string — описание в одно предложение (≤ 280 символов)",
		"queries":     fmt.Sprintf("array of { query: string, limit: integer 3..15 } размером 4..%d. Сумма limit ~ %d.", aiMaxQueries, schemaSumLimit),
	}
	schemaJSON, _ := json.MarshalIndent(schema, "", "  ")
	user := strings.Join([]string{
		fmt.Sprintf(`Промпт пользователя: """%s"""`, prompt),
		fmt.Sprintf("Требуется примерно %d треков в итоговом плейлисте.", want),
		"Верни строго JSON по схеме:",
		string(schemaJSON),
	}, "\n")

	raw, err := s.chat(ctx, []map[string]string{
		{"role": "system", "content": system},
		{"role": "user", "content": user},
	})
	if err != nil {
		return AIPlan{}, err
	}

	// Yandex sometimes wraps JSON in ```json fences even with
	// response_format set; strip them defensively.
	stripped := stripJSONFences(raw)

	var anyVal any
	if err := json.Unmarshal([]byte(stripped), &anyVal); err != nil {
		return AIPlan{}, newAIErr("AI вернул не-JSON ответ. Попробуй ещё раз.", 502)
	}
	return coercePlan(anyVal), nil
}

var aiFenceRE = regexp.MustCompile("(?is)^```(?:json)?\\s*|\\s*```\\s*$")

func stripJSONFences(s string) string {
	return strings.TrimSpace(aiFenceRE.ReplaceAllString(s, ""))
}

func coercePlan(v any) AIPlan {
	plan := AIPlan{Name: "AI плейлист"}
	m, ok := v.(map[string]any)
	if !ok {
		return plan
	}
	if name, ok := m["name"].(string); ok {
		plan.Name = strings.TrimSpace(name)
		if plan.Name == "" {
			plan.Name = "AI плейлист"
		}
	}
	if desc, ok := m["description"].(string); ok {
		plan.Description = strings.TrimSpace(desc)
	}
	rawQs, _ := m["queries"].([]any)
	for _, qRaw := range rawQs {
		qm, ok := qRaw.(map[string]any)
		if !ok {
			continue
		}
		query, _ := qm["query"].(string)
		query = strings.TrimSpace(query)
		if query == "" {
			continue
		}
		if len(query) > 80 {
			query = query[:80]
		}
		limit := 6
		switch raw := qm["limit"].(type) {
		case float64:
			limit = int(raw)
		case string:
			// Yandex sometimes stringifies numbers inside response_format=json_object.
			fmt.Sscanf(raw, "%d", &limit)
		}
		if limit < 3 {
			limit = 3
		}
		if limit > 15 {
			limit = 15
		}
		plan.Queries = append(plan.Queries, AIPlanQuery{Query: query, Limit: limit})
		if len(plan.Queries) >= aiMaxQueries {
			break
		}
	}
	return plan
}

// ──────────────────────────────────────────────────────────────────
// Step 2: resolve plan against Tidal
// ──────────────────────────────────────────────────────────────────

func (s *AIPlaylistService) resolvePlan(ctx context.Context, plan AIPlan, want int) []tidal.Track {
	buckets := make([][]tidal.Track, len(plan.Queries))
	var wg sync.WaitGroup
	for i, q := range plan.Queries {
		i, q := i, q
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := s.tidal.API.Search(ctx, q.Query, "TRACKS", q.Limit, 0)
			if err != nil {
				s.A.Logger.Warn("ai/plan search failed", "q", q.Query, "err", err)
				return
			}
			if raw == nil || raw.Tracks == nil {
				return
			}
			items := tidal.UnwrapBucket[tidal.TrackRaw](raw.Tracks)
			out := make([]tidal.Track, 0, len(items))
			for j := range items {
				out = append(out, tidal.MapTrack(&items[j]))
			}
			buckets[i] = out
		}()
	}
	wg.Wait()

	// Round-robin merge so under-represented queries still surface.
	merged := make([]tidal.Track, 0, want)
	seen := map[string]bool{}
	cursors := make([]int, len(buckets))
	for len(merged) < want*2 {
		progressed := false
		for i := range buckets {
			if cursors[i] >= len(buckets[i]) {
				continue
			}
			t := buckets[i][cursors[i]]
			cursors[i]++
			progressed = true

			src := t.Source
			if src == "" {
				src = "tidal"
			}
			key := src + ":" + t.ID
			if seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, t)
			if len(merged) >= want {
				return merged
			}
		}
		if !progressed {
			break
		}
	}
	return merged
}

// ──────────────────────────────────────────────────────────────────
// Yandex API client
// ──────────────────────────────────────────────────────────────────

type yandexChatRequest struct {
	Model          string              `json:"model"`
	MaxTokens      int                 `json:"max_tokens"`
	Temperature    float64             `json:"temperature"`
	ResponseFormat map[string]string   `json:"response_format"`
	Messages       []map[string]string `json:"messages"`
}

type yandexChatResponse struct {
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (s *AIPlaylistService) chat(ctx context.Context, messages []map[string]string) (string, error) {
	modelURI := s.A.Cfg.YandexModelURI
	if modelURI == "" {
		modelURI = fmt.Sprintf("gpt://%s/gpt-oss-120b/latest", s.A.Cfg.YandexFolderID)
	}
	body, _ := json.Marshal(yandexChatRequest{
		Model:          modelURI,
		MaxTokens:      2048,
		Temperature:    0.6,
		ResponseFormat: map[string]string{"type": "json_object"},
		Messages:       messages,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, aiYandexBase+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Api-Key "+s.A.Cfg.YandexAPIToken)
	req.Header.Set("x-folder-id", s.A.Cfg.YandexFolderID)
	req.Header.Set("Content-Type", "application/json")

	res, err := s.http.Do(req)
	if err != nil {
		return "", newAIErr("Не удалось связаться с Yandex AI", 502)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		s.A.Logger.Error("ai/yandex http error", "status", res.StatusCode, "body", string(raw))
		status := 502
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
			status = 503
		}
		return "", newAIErr(fmt.Sprintf("Yandex AI вернул ошибку %d", res.StatusCode), status)
	}

	var parsed yandexChatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", newAIErr("Yandex AI вернул не-JSON", 502)
	}
	if parsed.Error != nil {
		msg := parsed.Error.Message
		if msg == "" {
			msg = "Yandex AI ошибка"
		}
		return "", newAIErr(msg, 502)
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == "" {
		return "", newAIErr("Yandex AI вернул пустой ответ", 502)
	}
	return parsed.Choices[0].Message.Content, nil
}

// AsAIError unwraps an *AIPlaylistError out of a wrapped chain so route
// handlers can keep using errors.As without importing the concrete type.
func AsAIError(err error) (*AIPlaylistError, bool) {
	var e *AIPlaylistError
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
