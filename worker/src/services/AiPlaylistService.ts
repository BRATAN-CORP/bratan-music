import type { Env } from '../types/env';
import { TidalService } from './tidal/TidalService';
import type { Track } from '../types/music';

/**
 * AI playlist generator backed by Yandex Foundation Models
 * (gpt-oss-120b through the OpenAI-compatible /v1/chat/completions
 * endpoint at ai.api.cloud.yandex.net).
 *
 * Two-step flow on a single user prompt:
 *
 *   1.  Ask the LLM to translate the prompt into a *plan* — a small
 *       set of concrete Tidal search queries plus a name and short
 *       description for the playlist. The model returns strict JSON
 *       (we use response_format=json_object); we don't expose Tidal's
 *       catalogue to the model directly because it would require
 *       multi-megabyte context.
 *
 *   2.  Resolve every query against TidalService.search in parallel,
 *       merge results in the order the model proposed them, dedupe
 *       by track id, and return the cleaned-up list together with
 *       the model's name + description.
 *
 * The prompt below is deliberately strict: the model cannot return
 * raw track names (it doesn't know the actual catalogue), only
 * search queries that TidalService is then trusted to resolve.
 */

const YA_BASE = 'https://ai.api.cloud.yandex.net/v1';
const TARGET_TRACKS_DEFAULT = 20;
const TARGET_TRACKS_MAX = 40;
const MAX_QUERIES = 12;

interface YandexChatChoice {
  message?: { role: string; content?: string };
}
interface YandexChatResponse {
  choices?: YandexChatChoice[];
  error?: { message?: string };
}

export interface AiPlanQuery {
  query: string;
  limit: number;
}
export interface AiPlan {
  name: string;
  description: string;
  queries: AiPlanQuery[];
}

export interface AiPlaylistPreview {
  name: string;
  description: string;
  tracks: Track[];
  rejected: number;
  prompt: string;
  plan: AiPlan;
}

export class AiPlaylistError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
    this.name = 'AiPlaylistError';
  }
}

export class AiPlaylistService {
  private apiToken: string;
  private folderId: string;
  private modelUri: string;

  constructor(private env: Env) {
    if (!env.YANDEX_API_TOKEN || !env.YANDEX_FOLDER_ID) {
      throw new AiPlaylistError(
        'Yandex AI не настроен на сервере. Попроси админа добавить YANDEX_API_TOKEN и YANDEX_FOLDER_ID.',
        503,
      );
    }
    this.apiToken = env.YANDEX_API_TOKEN;
    this.folderId = env.YANDEX_FOLDER_ID;
    this.modelUri = env.YANDEX_MODEL_URI ?? `gpt://${env.YANDEX_FOLDER_ID}/gpt-oss-120b/latest`;
  }

  async generate(prompt: string, target: number = TARGET_TRACKS_DEFAULT): Promise<AiPlaylistPreview> {
    // Limit raised at the input layer (route validates ≤200) but
    // we keep a defence-in-depth cap at 1000 so a future API change
    // can't trigger massive prompt costs.
    const cleanPrompt = prompt.trim().slice(0, 1000);
    if (!cleanPrompt) {
      throw new AiPlaylistError('Промпт не может быть пустым', 400);
    }
    const want = Math.max(5, Math.min(TARGET_TRACKS_MAX, target | 0 || TARGET_TRACKS_DEFAULT));

    const plan = await this.askForPlan(cleanPrompt, want);
    if (!plan.queries.length) {
      throw new AiPlaylistError('Модель не смогла придумать поиски — попробуй переформулировать промпт', 422);
    }

    const tracks = await this.resolvePlan(plan, want);
    const rejected = Math.max(0, plan.queries.reduce((s, q) => s + q.limit, 0) - tracks.length);

    return {
      name: plan.name.slice(0, 80),
      description: plan.description.slice(0, 280),
      tracks: tracks.slice(0, want),
      rejected,
      prompt: cleanPrompt,
      plan,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Step 1: plan
  // ──────────────────────────────────────────────────────────────────

  private async askForPlan(prompt: string, want: number): Promise<AiPlan> {
    const system = [
      'Ты — музыкальный куратор для глобального каталога Tidal.',
      'Тебе дают короткий промпт на русском или английском (≤200 символов), ты возвращаешь JSON-план.',
      'Ты НЕ знаешь конкретный каталог и НЕ должен придумывать названия треков «из головы» — только формулируешь поисковые запросы.',
      '',
      'ОБЯЗАТЕЛЬНО смешай ОБА языка в queries:',
      '— если промпт на русском, добавь и оригинальные русские термины (например: «русский рок», «дворовая лирика», конкретного артиста на кириллице),',
      '  И их английские эквиваленты («russian rock», «post-soviet wave», латинская транслитерация артистов).',
      '— если промпт на английском, тоже верни и английские, и русские варианты, чтобы покрыть и западный, и русскоязычный каталог Tidal.',
      'Каталог Tidal ищет лучше всего по латинице — поэтому для жанров/настроений предпочитай английский (synthwave, breakcore, lo-fi hip hop).',
      '',
      'Тип запросов варьируй: жанр+эпоха («deep house 2010s»), настроение ("late night drive"), конкретный артист ("Tame Impala"),',
      'трек-якорь («Mac DeMarco Chamber of Reflection»), альбом ("Random Access Memories"), субжанр+гео ("japanese city pop"). Не повторяйся.',
      'Хорошие запросы: короткие (1–4 слова), специфические, без знаков препинания, без слова "music".',
      'Никаких комментариев и markdown — только чистый JSON по схеме.',
    ].join(' ');

    const schema = {
      name: 'string — короткое название плейлиста (≤ 80 символов), на языке промпта',
      description: 'string — описание в одно предложение (≤ 280 символов)',
      queries: `array of { query: string, limit: integer 3..15 } размером 4..${MAX_QUERIES}. Сумма limit ~ ${Math.ceil(want * 1.6)}.`,
    };

    const user = [
      `Промпт пользователя: """${prompt}"""`,
      `Требуется примерно ${want} треков в итоговом плейлисте.`,
      'Верни строго JSON по схеме:',
      JSON.stringify(schema, null, 2),
    ].join('\n');

    const raw = await this.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    let parsed: unknown;
    try {
      // Yandex sometimes wraps JSON in ```json fences even with response_format
      // set; strip them defensively.
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      parsed = JSON.parse(stripped);
    } catch {
      throw new AiPlaylistError('AI вернул не-JSON ответ. Попробуй ещё раз.', 502);
    }
    return this.coercePlan(parsed);
  }

  private coercePlan(value: unknown): AiPlan {
    const v = (value ?? {}) as Record<string, unknown>;
    const queriesRaw = Array.isArray(v.queries) ? v.queries : [];
    const queries: AiPlanQuery[] = queriesRaw
      .map((q) => {
        const obj = (q ?? {}) as Record<string, unknown>;
        const query = typeof obj.query === 'string' ? obj.query.trim() : '';
        const limit = Number(obj.limit);
        if (!query) return null;
        return {
          query: query.slice(0, 80),
          limit: Math.max(3, Math.min(15, Number.isFinite(limit) ? Math.floor(limit) : 6)),
        } as AiPlanQuery;
      })
      .filter((q): q is AiPlanQuery => q !== null)
      .slice(0, MAX_QUERIES);

    return {
      name: (typeof v.name === 'string' ? v.name : 'AI плейлист').trim(),
      description: (typeof v.description === 'string' ? v.description : '').trim(),
      queries,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Step 2: resolve plan against Tidal
  // ──────────────────────────────────────────────────────────────────

  private async resolvePlan(plan: AiPlan, want: number): Promise<Track[]> {
    const tidal = new TidalService(this.env);

    const results = await Promise.all(
      plan.queries.map(async (q) => {
        try {
          const r = await tidal.search(q.query, 'tracks', { limit: q.limit });
          return r.tracks ?? [];
        } catch (err) {
          console.warn('[ai/plan] search failed', q.query, err);
          return [];
        }
      }),
    );

    // Round-robin merge: take 1 from each query, then loop. This way
    // even underrepresented queries surface in the final list instead
    // of the first long query stuffing the playlist on its own.
    const buckets = results.map((tracks) => [...tracks]);
    const seen = new Set<string>();
    const merged: Track[] = [];
    while (merged.length < want * 2 && buckets.some((b) => b.length > 0)) {
      for (const b of buckets) {
        const next = b.shift();
        if (!next) continue;
        const key = `${next.source ?? 'tidal'}:${next.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(next);
        if (merged.length >= want) break;
      }
    }
    return merged;
  }

  // ──────────────────────────────────────────────────────────────────
  // Yandex API client
  // ──────────────────────────────────────────────────────────────────

  private async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    const res = await fetch(`${YA_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${this.apiToken}`,
        'x-folder-id': this.folderId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelUri,
        max_tokens: 2048,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[ai/yandex] http error', res.status, text);
      const status = res.status === 401 || res.status === 403 ? 503 : 502;
      throw new AiPlaylistError(`Yandex AI вернул ошибку ${res.status}`, status);
    }
    let body: YandexChatResponse;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AiPlaylistError('Yandex AI вернул не-JSON', 502);
    }
    if (body.error) {
      throw new AiPlaylistError(body.error.message ?? 'Yandex AI ошибка', 502);
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiPlaylistError('Yandex AI вернул пустой ответ', 502);
    }
    return content;
  }
}
