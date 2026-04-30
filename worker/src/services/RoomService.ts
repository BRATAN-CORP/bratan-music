import type { Env } from '../types/env';

/**
 * Shared listening rooms (PR #214).
 *
 * Sync protocol is "polling-based, server-anchored time":
 *
 *   - The server stores `started_at_ms` (server epoch when the current
 *     play span began) plus `position_ms` (the offset within the track
 *     at which that span starts). When `is_paused = 1`, the position is
 *     frozen at `position_ms`. When `is_paused = 0`, clients compute
 *     position as `Date.now() - started_at_ms + position_ms` after
 *     correcting for clock skew using the server-provided `serverNowMs`
 *     in every state response.
 *
 *   - The state row carries a monotonic `version` that the controller
 *     bumps on every meaningful change. The client polls `GET
 *     /rooms/:id/state` ~every 1.5s and only acts on state changes
 *     where `version` advanced past what it last applied.
 *
 *   - Anyone who is a current member can take control. Whoever called
 *     last is recorded as `controller_id` so the UI can render
 *     attribution ("Маша поставила на паузу"). This matches the user-
 *     facing requirement that "оба могут управлять".
 *
 * Anti-abuse design for uploads / overrides (host-supplied audio):
 *
 *   - Tidal stream URLs are not exposed by this surface — guests still
 *     hit `/tracks/:id/stream` for those, which goes through the normal
 *     daily-listens / subscription gate.
 *
 *   - For `upload:*` and override-backed tracks, the room exposes a
 *     dedicated `/rooms/:roomId/stream/:source/:rawId` endpoint that
 *     verifies (a) the caller is a current room member, (b) the
 *     requested track matches the room's *currently playing* state,
 *     and (c) the host (or the override owner) is still in the room.
 *     The endpoint short-circuits the moment the host changes the
 *     current track — guests can't keep streaming "yesterday's host
 *     upload" once the room moves on. R2 is read server-side and
 *     piped through the worker so we never hand out signed URLs that
 *     would survive past the next track change.
 */

const ROOM_INACTIVITY_MS = 1000 * 60 * 60 * 6; // close after 6h idle
const MEMBER_PRESENCE_MS = 1000 * 45; // member is "live" if seen <45s ago

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RoomTrackSnapshot {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  artists?: Array<{ id: string; name: string }>;
  album?: string | null;
  albumId?: string | null;
  coverUrl?: string | null;
  coverVideoUrl?: string | null;
  duration: number;
  source: string;
}

export interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  name: string;
  status: 'active' | 'closed';
  created_at: number;
  updated_at: number;
  last_activity_at: number;
}

export interface RoomStateRow {
  room_id: string;
  track_json: string | null;
  track_id: string | null;
  track_source: string | null;
  started_at_ms: number;
  position_ms: number;
  is_paused: number;
  controller_id: string | null;
  version: number;
  updated_at_ms: number;
}

export interface RoomMemberRow {
  room_id: string;
  user_id: string;
  role: 'host' | 'member';
  joined_at: number;
  last_seen_ms: number;
}

export interface RoomMember {
  userId: string;
  username: string | null;
  name: string | null;
  role: 'host' | 'member';
  joinedAt: number;
  lastSeenMs: number;
  isLive: boolean;
}

export interface RoomState {
  version: number;
  isPaused: boolean;
  positionMs: number;
  startedAtMs: number;
  updatedAtMs: number;
  controllerId: string | null;
  track: RoomTrackSnapshot | null;
}

export interface RoomDetail {
  id: string;
  code: string;
  name: string;
  hostId: string;
  status: 'active' | 'closed';
  createdAt: number;
  state: RoomState;
  members: RoomMember[];
  serverNowMs: number;
}

function nowMs() { return Date.now(); }
function nowSec() { return Math.floor(Date.now() / 1000); }

function generateCode(): string {
  // 6-char Crockford-ish alphabet: skips I/O/0/1 to avoid join-code typos.
  let out = '';
  const rand = new Uint8Array(6);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[rand[i] % CODE_ALPHABET.length];
  return out;
}

function uuid(): string {
  return crypto.randomUUID();
}

function parseTrackJson(raw: string | null): RoomTrackSnapshot | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as RoomTrackSnapshot; } catch { return null; }
}

export class RoomService {
  constructor(private env: Env) {}

  /**
   * Create a fresh room with the caller as host. Initialises an empty
   * paused state row and a host membership row in the same write so
   * `getRoom` after creation sees a consistent picture.
   */
  async createRoom(hostId: string, name: string): Promise<RoomRow> {
    const id = uuid();
    const now = nowSec();
    const cleanName = (name?.trim() || 'Комната совместного прослушивания').slice(0, 80);

    // Try a few times in case of an extremely unlikely code collision.
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      try {
        await this.env.DB.batch([
          this.env.DB.prepare(
            `INSERT INTO listening_rooms
             (id, code, host_id, name, status, created_at, updated_at, last_activity_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
          ).bind(id, code, hostId, cleanName, now, now, now),
          this.env.DB.prepare(
            `INSERT INTO listening_room_state
             (room_id, started_at_ms, position_ms, is_paused, version, updated_at_ms)
             VALUES (?, 0, 0, 1, 0, ?)`
          ).bind(id, nowMs()),
          this.env.DB.prepare(
            `INSERT INTO listening_room_members
             (room_id, user_id, role, joined_at, last_seen_ms)
             VALUES (?, ?, 'host', ?, ?)`
          ).bind(id, hostId, now, nowMs()),
        ]);
        return {
          id, code, host_id: hostId, name: cleanName, status: 'active',
          created_at: now, updated_at: now, last_activity_at: now,
        };
      } catch (err) {
        // Unique-constraint clash on `code` → regenerate and retry.
        const message = err instanceof Error ? err.message : String(err);
        if (!/UNIQUE|constraint/i.test(message)) throw err;
      }
    }
    throw new Error('Не удалось сгенерировать код комнаты');
  }

  async findById(id: string): Promise<RoomRow | null> {
    return this.env.DB.prepare(`SELECT * FROM listening_rooms WHERE id = ?`)
      .bind(id).first<RoomRow>();
  }

  async findByCode(code: string): Promise<RoomRow | null> {
    return this.env.DB.prepare(`SELECT * FROM listening_rooms WHERE UPPER(code) = UPPER(?)`)
      .bind(code).first<RoomRow>();
  }

  async getState(roomId: string): Promise<RoomStateRow | null> {
    return this.env.DB.prepare(`SELECT * FROM listening_room_state WHERE room_id = ?`)
      .bind(roomId).first<RoomStateRow>();
  }

  async listMyRooms(userId: string): Promise<RoomRow[]> {
    const rows = await this.env.DB.prepare(
      `SELECT r.* FROM listening_rooms r
       INNER JOIN listening_room_members m ON m.room_id = r.id
       WHERE m.user_id = ? AND r.status = 'active'
       ORDER BY r.last_activity_at DESC`
    ).bind(userId).all<RoomRow>();
    return rows.results ?? [];
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    const rows = await this.env.DB.prepare(
      `SELECT m.user_id, m.role, m.joined_at, m.last_seen_ms,
              u.tg_username, u.tg_name
       FROM listening_room_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ?
       ORDER BY m.joined_at ASC`
    ).bind(roomId).all<RoomMemberRow & { tg_username: string | null; tg_name: string | null }>();
    const cutoff = nowMs() - MEMBER_PRESENCE_MS;
    return (rows.results ?? []).map((r) => ({
      userId: r.user_id,
      username: r.tg_username,
      name: r.tg_name,
      role: r.role,
      joinedAt: r.joined_at,
      lastSeenMs: r.last_seen_ms,
      isLive: r.last_seen_ms >= cutoff,
    }));
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
      `SELECT 1 AS x FROM listening_room_members WHERE room_id = ? AND user_id = ?`
    ).bind(roomId, userId).first<{ x: number }>();
    return Boolean(row);
  }

  async addMember(roomId: string, userId: string): Promise<void> {
    const now = nowSec();
    await this.env.DB.prepare(
      `INSERT INTO listening_room_members (room_id, user_id, role, joined_at, last_seen_ms)
       VALUES (?, ?, 'member', ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET last_seen_ms = excluded.last_seen_ms`
    ).bind(roomId, userId, now, nowMs()).run();
    await this.touchRoom(roomId);
  }

  async heartbeat(roomId: string, userId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE listening_room_members SET last_seen_ms = ?
       WHERE room_id = ? AND user_id = ?`
    ).bind(nowMs(), roomId, userId).run();
  }

  /**
   * Remove a member. If the host leaves and another member is still
   * present, promote the longest-tenured remaining member to host;
   * otherwise close the room.
   */
  async removeMember(roomId: string, userId: string): Promise<void> {
    const room = await this.findById(roomId);
    if (!room) return;
    await this.env.DB.prepare(
      `DELETE FROM listening_room_members WHERE room_id = ? AND user_id = ?`
    ).bind(roomId, userId).run();

    if (room.host_id === userId) {
      const next = await this.env.DB.prepare(
        `SELECT user_id FROM listening_room_members
         WHERE room_id = ? ORDER BY joined_at ASC LIMIT 1`
      ).bind(roomId).first<{ user_id: string }>();
      if (next) {
        await this.env.DB.prepare(
          `UPDATE listening_rooms SET host_id = ?, updated_at = ? WHERE id = ?`
        ).bind(next.user_id, nowSec(), roomId).run();
        await this.env.DB.prepare(
          `UPDATE listening_room_members SET role = 'host'
           WHERE room_id = ? AND user_id = ?`
        ).bind(roomId, next.user_id).run();
      } else {
        await this.closeRoom(roomId);
      }
    }
    await this.touchRoom(roomId);
  }

  async closeRoom(roomId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE listening_rooms SET status = 'closed', updated_at = ? WHERE id = ?`
    ).bind(nowSec(), roomId).run();
  }

  private async touchRoom(roomId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE listening_rooms SET last_activity_at = ?, updated_at = ? WHERE id = ?`
    ).bind(nowSec(), nowSec(), roomId).run();
  }

  /**
   * Apply a control action coming from a member. Returns the new state
   * snapshot the caller can echo back to its UI without an extra read.
   */
  async applyControl(
    roomId: string,
    userId: string,
    action:
      | { kind: 'play' }
      | { kind: 'pause'; positionMs?: number }
      | { kind: 'seek'; positionMs: number }
      | { kind: 'track'; track: RoomTrackSnapshot; positionMs?: number; isPaused?: boolean },
  ): Promise<RoomState> {
    const state = await this.getState(roomId);
    if (!state) throw new Error('Состояние комнаты не найдено');

    const now = nowMs();
    let track = parseTrackJson(state.track_json);
    let trackId = state.track_id;
    let trackSource = state.track_source;
    let isPaused = state.is_paused === 1;
    let positionMs = state.position_ms;
    let startedAtMs = state.started_at_ms;

    if (action.kind === 'play') {
      if (isPaused) {
        startedAtMs = now;
        isPaused = false;
      }
    } else if (action.kind === 'pause') {
      if (!isPaused) {
        // Freeze the position at "now" relative to the running span.
        positionMs = clampNonNegative(positionMs + (now - startedAtMs));
        isPaused = true;
      } else if (typeof action.positionMs === 'number') {
        positionMs = clampNonNegative(action.positionMs);
      }
    } else if (action.kind === 'seek') {
      positionMs = clampNonNegative(action.positionMs);
      if (!isPaused) startedAtMs = now;
    } else if (action.kind === 'track') {
      track = sanitiseTrack(action.track);
      trackId = track.id;
      trackSource = track.source;
      positionMs = clampNonNegative(action.positionMs ?? 0);
      isPaused = action.isPaused ?? false;
      startedAtMs = now;
    }

    const newVersion = state.version + 1;
    await this.env.DB.prepare(
      `UPDATE listening_room_state
         SET track_json = ?, track_id = ?, track_source = ?,
             started_at_ms = ?, position_ms = ?, is_paused = ?,
             controller_id = ?, version = ?, updated_at_ms = ?
       WHERE room_id = ?`
    ).bind(
      track ? JSON.stringify(track) : null,
      trackId,
      trackSource,
      startedAtMs,
      positionMs,
      isPaused ? 1 : 0,
      userId,
      newVersion,
      now,
      roomId,
    ).run();
    await this.touchRoom(roomId);
    return {
      version: newVersion,
      isPaused,
      positionMs,
      startedAtMs,
      updatedAtMs: now,
      controllerId: userId,
      track,
    };
  }

  toRoomState(row: RoomStateRow): RoomState {
    return {
      version: row.version,
      isPaused: row.is_paused === 1,
      positionMs: row.position_ms,
      startedAtMs: row.started_at_ms,
      updatedAtMs: row.updated_at_ms,
      controllerId: row.controller_id,
      track: parseTrackJson(row.track_json),
    };
  }

  async detail(room: RoomRow): Promise<RoomDetail> {
    const [state, members] = await Promise.all([
      this.getState(room.id),
      this.listMembers(room.id),
    ]);
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      hostId: room.host_id,
      status: room.status,
      createdAt: room.created_at,
      state: state ? this.toRoomState(state) : emptyState(),
      members,
      serverNowMs: nowMs(),
    };
  }

  /**
   * Best-effort GC of stale rooms. Called from the cron job. A room
   * with no activity for `ROOM_INACTIVITY_MS` is closed.
   */
  async gc(): Promise<{ closed: number }> {
    const cutoff = nowSec() - Math.floor(ROOM_INACTIVITY_MS / 1000);
    const res = await this.env.DB.prepare(
      `UPDATE listening_rooms SET status = 'closed', updated_at = ?
       WHERE status = 'active' AND last_activity_at < ?`
    ).bind(nowSec(), cutoff).run();
    return { closed: res.meta?.changes ?? 0 };
  }
}

function clampNonNegative(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function emptyState(): RoomState {
  return {
    version: 0,
    isPaused: true,
    positionMs: 0,
    startedAtMs: 0,
    updatedAtMs: 0,
    controllerId: null,
    track: null,
  };
}

function sanitiseTrack(t: RoomTrackSnapshot): RoomTrackSnapshot {
  // Strip unexpected fields and clamp lengths so an attacker who controls
  // the track snapshot can't poison the JSON column with megabytes of
  // markup that every poll would re-broadcast to every member.
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: str(t.id, 200),
    title: str(t.title, 300),
    artist: str(t.artist, 300),
    artistId: t.artistId ? str(t.artistId, 200) : null,
    artists: Array.isArray(t.artists)
      ? t.artists.slice(0, 16).map((a) => ({ id: str(a.id, 200), name: str(a.name, 300) }))
      : undefined,
    album: t.album ? str(t.album, 300) : null,
    albumId: t.albumId ? str(t.albumId, 200) : null,
    coverUrl: t.coverUrl ? str(t.coverUrl, 1024) : null,
    coverVideoUrl: t.coverVideoUrl ? str(t.coverVideoUrl, 1024) : null,
    duration: typeof t.duration === 'number' && Number.isFinite(t.duration)
      ? Math.max(0, Math.floor(t.duration))
      : 0,
    source: str(t.source || 'tidal', 32) || 'tidal',
  };
}
