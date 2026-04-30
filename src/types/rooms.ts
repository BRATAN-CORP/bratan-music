/**
 * Domain types for shared listening rooms (PR #214). Mirrors the
 * `RoomService` shapes on the worker so callers stay type-safe across
 * the JSON boundary.
 */

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

export interface RoomListItem {
  id: string;
  code: string;
  name: string;
  hostId: string;
  isHost: boolean;
  lastActivityAt: number;
}

export interface RoomStatePoll {
  unchanged: boolean;
  version?: number;
  state?: RoomState;
  members?: RoomMember[];
  serverNowMs: number;
}
