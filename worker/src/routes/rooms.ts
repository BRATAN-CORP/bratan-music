import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import { jwtAuth } from '../middleware/auth';
import { RoomService, type RoomTrackSnapshot } from '../services/RoomService';
import { TidalService } from '../services/tidal/TidalService';

/**
 * Routes for shared listening rooms (PR #214).
 *
 * Auth: every endpoint requires a valid JWT. Membership is enforced
 * inside each handler against `listening_room_members` so a forged
 * `roomId` parameter from a non-member returns 403, not 404 — we don't
 * want to leak room existence by status code.
 */

const rooms = new Hono<{ Bindings: Env; Variables: Variables }>();

rooms.use('/*', jwtAuth);

interface CreateBody { name?: string }
interface JoinBody { code?: string }
interface ControlBody {
  kind: 'play' | 'pause' | 'seek' | 'track';
  positionMs?: number;
  isPaused?: boolean;
  track?: RoomTrackSnapshot;
}
interface ChatBody { body?: string }

rooms.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<CreateBody>().catch(() => ({} as CreateBody));
  const svc = new RoomService(c.env);
  const room = await svc.createRoom(userId, body.name ?? '');
  const detail = await svc.detail(room);
  return c.json(detail);
});

rooms.get('/', async (c) => {
  const userId = c.get('userId');
  const svc = new RoomService(c.env);
  const list = await svc.listMyRooms(userId);
  // Light list for the index page — full state per room would be wasteful.
  return c.json({
    items: list.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      hostId: r.host_id,
      isHost: r.host_id === userId,
      lastActivityAt: r.last_activity_at,
    })),
  });
});

rooms.post('/join', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<JoinBody>().catch(() => ({} as JoinBody));
  const code = (body.code ?? '').trim();
  if (!code) return c.json({ error: 'Код комнаты обязателен' }, 400);
  const svc = new RoomService(c.env);
  const room = await svc.findByCode(code);
  if (!room || room.status !== 'active') {
    return c.json({ error: 'Комната не найдена или закрыта' }, 404);
  }
  await svc.addMember(room.id, userId);
  const detail = await svc.detail(room);
  return c.json(detail);
});

rooms.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const room = await svc.findById(id);
  if (!room) return c.json({ error: 'Нет доступа' }, 403);
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);
  await svc.heartbeat(id, userId);
  const detail = await svc.detail(room);
  return c.json(detail);
});

/**
 * Lightweight state poll. The frontend hits this on a 1.5s interval. If
 * the caller passes `?since=<version>` and the server-side version
 * hasn't advanced, we return `{ unchanged: true, serverNowMs }` so the
 * client can still resync its clock skew without rendering anything.
 */
rooms.get('/:id/state', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);

  await svc.heartbeat(id, userId);
  const stateRow = await svc.getState(id);
  if (!stateRow) return c.json({ error: 'Нет состояния' }, 404);
  const sinceRaw = c.req.query('since');
  const since = sinceRaw ? parseInt(sinceRaw, 10) : NaN;
  const serverNowMs = Date.now();
  if (Number.isFinite(since) && stateRow.version <= since) {
    return c.json({ unchanged: true, version: stateRow.version, serverNowMs });
  }
  const state = svc.toRoomState(stateRow);
  const members = await svc.listMembers(id);
  return c.json({ unchanged: false, state, members, serverNowMs });
});

rooms.post('/:id/heartbeat', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);
  await svc.heartbeat(id, userId);
  return c.json({ ok: true, serverNowMs: Date.now() });
});

/**
 * Initial chat snapshot (most recent ~100 messages, ascending). With
 * `?since=<id>` the endpoint becomes the polling cursor — returns only
 * messages strictly newer than the supplied id.
 */
rooms.get('/:id/chat', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);
  const since = parseInt(c.req.query('since') ?? '', 10);
  if (Number.isFinite(since) && since >= 0) {
    const messages = await svc.listMessagesSince(id, since);
    return c.json({ messages, serverNowMs: Date.now() });
  }
  const messages = await svc.listRecentMessages(id);
  return c.json({ messages, serverNowMs: Date.now() });
});

/**
 * Append a chat message. Length-clamped + cooldown-rate-limited inside
 * the service. Returns the created row so the sender can echo it
 * optimistically without a follow-up poll.
 */
rooms.post('/:id/chat', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const room = await svc.findById(id);
  if (!room || room.status !== 'active') {
    return c.json({ error: 'Комната не найдена' }, 404);
  }
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);
  const body = await c.req.json<ChatBody>().catch(() => ({} as ChatBody));
  try {
    const message = await svc.appendMessage(id, userId, body.body ?? '');
    return c.json({ message, serverNowMs: Date.now() });
  } catch (err) {
    const stamped = (err as { status?: number } | null | undefined)?.status;
    const text = err instanceof Error ? err.message : 'Ошибка';
    if (stamped === 400) return c.json({ error: text }, 400);
    if (stamped === 429) return c.json({ error: text }, 429);
    return c.json({ error: text }, 500);
  }
});

rooms.post('/:id/control', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const room = await svc.findById(id);
  if (!room || room.status !== 'active') {
    return c.json({ error: 'Комната не найдена' }, 404);
  }
  const member = await svc.isMember(id, userId);
  if (!member) return c.json({ error: 'Нет доступа' }, 403);

  const body = await c.req.json<ControlBody>().catch(() => null);
  if (!body || !body.kind) return c.json({ error: 'kind обязателен' }, 400);

  let newState;
  try {
    if (body.kind === 'play') {
      newState = await svc.applyControl(id, userId, { kind: 'play' });
    } else if (body.kind === 'pause') {
      newState = await svc.applyControl(id, userId, { kind: 'pause', positionMs: body.positionMs });
    } else if (body.kind === 'seek') {
      if (typeof body.positionMs !== 'number') {
        return c.json({ error: 'positionMs обязателен' }, 400);
      }
      newState = await svc.applyControl(id, userId, { kind: 'seek', positionMs: body.positionMs });
    } else if (body.kind === 'track') {
      if (!body.track || typeof body.track !== 'object') {
        return c.json({ error: 'track обязателен' }, 400);
      }
      newState = await svc.applyControl(id, userId, {
        kind: 'track',
        track: body.track,
        positionMs: body.positionMs,
        isPaused: body.isPaused,
      });
    } else {
      return c.json({ error: `Неизвестный kind: ${String(body.kind)}` }, 400);
    }
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Ошибка' }, 500);
  }
  return c.json({ ok: true, state: newState, serverNowMs: Date.now() });
});

rooms.post('/:id/leave', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  await svc.removeMember(id, userId);
  return c.json({ ok: true });
});

/**
 * Host-only hard delete. Anyone else gets 403. We don't soft-close here
 * — the spec is explicit that "удалить — прям вообще". FK cascades
 * wipe state + members in the same write.
 */
rooms.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const svc = new RoomService(c.env);
  const room = await svc.findById(id);
  if (!room) return c.json({ error: 'Комната не найдена' }, 404);
  if (room.host_id !== userId) {
    return c.json({ error: 'Удалять комнату может только хост' }, 403);
  }
  await svc.deleteRoom(id);
  return c.json({ ok: true });
});

/**
 * Anti-abuse stream proxy for host-supplied audio (uploads + override
 * files in R2). See RoomService.ts header for the full design — the
 * gist is: the requested track must match the room's *current* state,
 * and the caller must be a current member, otherwise we return 403.
 *
 * Tidal tracks deliberately don't go through this endpoint; clients
 * use the regular `/tracks/:id/stream` for those, which carries the
 * normal daily-listens / subscription gate.
 */
rooms.get('/:id/stream/:source/:rawId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const source = c.req.param('source');
  const rawId = c.req.param('rawId');

  const svc = new RoomService(c.env);
  const room = await svc.findById(id);
  if (!room || room.status !== 'active') return c.json({ error: 'Нет доступа' }, 403);
  if (!(await svc.isMember(id, userId))) return c.json({ error: 'Нет доступа' }, 403);
  const stateRow = await svc.getState(id);
  if (!stateRow) return c.json({ error: 'Нет состояния' }, 404);

  // Hard-gate: the requested track must be the room's currently-playing
  // track. Anything else is a guest reaching for a previously-played
  // upload, which is exactly the abuse this endpoint exists to block.
  const currentSource = stateRow.track_source ?? '';
  const currentId = stateRow.track_id ?? '';
  const fullCurrentId = currentSource === 'upload'
    ? `upload:${currentId.replace(/^upload:/, '')}`
    : currentId;
  const fullRequested = source === 'upload' ? `upload:${rawId}` : rawId;
  if (fullCurrentId !== fullRequested || (currentSource && currentSource !== source)) {
    return c.json({ error: 'Этот трек больше не играет в комнате' }, 410);
  }

  if (source === 'upload') {
    return streamUploadInRoom(c.env, room.host_id, rawId, c.req.header('Range'));
  }
  if (source === 'override') {
    // Format of override "rawId" is "<sourceTrackSource>:<sourceTrackId>",
    // i.e. the original track id whose audio was overridden. The override
    // owner is the room host (only the host's overrides apply to the room).
    return streamOverrideInRoom(c.env, room.host_id, rawId, c.req.header('Range'));
  }
  if (source === 'tidal') {
    // Resolve through the regular Tidal pipeline but without the daily-
    // listens gate — guests in a room are listening to the host's
    // selection, not freely browsing the catalog. We still require an
    // active room state so this can't be abused as an unmetered Tidal
    // proxy outside of rooms.
    const tidal = new TidalService(c.env);
    const quality = (c.req.query('quality') ?? 'LOSSLESS').toUpperCase();
    try {
      const url = await tidal.getStreamUrl(rawId, quality);
      return c.json({ url });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка стрима';
      return c.json({ error: message }, 502);
    }
  }
  return c.json({ error: 'Неизвестный источник' }, 400);
});

async function streamUploadInRoom(
  env: Env,
  hostId: string,
  rawId: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT r2_key, mime_type FROM user_tracks WHERE id = ? AND user_id = ?'
  ).bind(rawId, hostId).first<{ r2_key: string; mime_type: string }>();
  if (!row) return new Response(JSON.stringify({ error: 'Файл не найден' }), { status: 404 });
  return r2Stream(env, row.r2_key, row.mime_type, rangeHeader);
}

async function streamOverrideInRoom(
  env: Env,
  hostId: string,
  combined: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  const idx = combined.indexOf(':');
  const trackSource = idx >= 0 ? combined.slice(0, idx) : 'tidal';
  const trackId = idx >= 0 ? combined.slice(idx + 1) : combined;
  const row = await env.DB.prepare(
    'SELECT r2_key, mime_type FROM track_overrides WHERE user_id = ? AND track_id = ? AND source = ?'
  ).bind(hostId, trackId, trackSource).first<{ r2_key: string; mime_type: string }>();
  if (!row) return new Response(JSON.stringify({ error: 'Override не найден' }), { status: 404 });
  return r2Stream(env, row.r2_key, row.mime_type, rangeHeader);
}

async function r2Stream(
  env: Env,
  key: string,
  mimeType: string,
  rangeHeader: string | undefined,
): Promise<Response> {
  let rangeOpt: { offset: number; length?: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : NaN;
      const end = match[2] ? parseInt(match[2], 10) : NaN;
      if (!Number.isNaN(start)) {
        rangeOpt = { offset: start };
        if (!Number.isNaN(end)) rangeOpt.length = end - start + 1;
      } else if (!Number.isNaN(end)) {
        rangeOpt = { offset: -end };
      }
    }
  }
  const object = await env.TRACKS.get(key, rangeOpt ? { range: rangeOpt } : undefined);
  if (!object) return new Response(JSON.stringify({ error: 'Файл не найден' }), { status: 404 });
  const total = object.size;
  const headers = new Headers();
  headers.set('Content-Type', mimeType);
  headers.set('Accept-Ranges', 'bytes');
  // Don't cache — the room can swap track at any time and stale CDN
  // bytes shouldn't outlive the current play span.
  headers.set('Cache-Control', 'private, no-store');
  if (rangeOpt) {
    const start = rangeOpt.offset >= 0 ? rangeOpt.offset : Math.max(0, total + rangeOpt.offset);
    const length = rangeOpt.length ?? (total - start);
    const end = Math.min(total - 1, start + length - 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(total));
  return new Response(object.body, { status: 200, headers });
}

export { rooms };
