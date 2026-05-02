import { create } from 'zustand';
import type { RoomMember, RoomState } from '@/types/rooms';

/**
 * Lightweight, NON-persisted store for the room the current user is
 * actively connected to. The room page sets this on join/landing; the
 * bridge (`useRoomBridge`) keeps it populated for as long as the user
 * is a member, regardless of which page they're currently looking at.
 *
 * Layout-level chrome (the floating "ты в комнате" corner badge) reads
 * this so the indicator follows the user even when they navigate to
 * /home or /library while staying connected. The bridge clears it on
 * explicit Leave / Delete or when the server stops returning a 200 for
 * `/rooms/:id/state` (membership revoked).
 *
 * It's intentionally not persisted — a hard reload always lands the
 * user back on the room page (or not), which is the source of truth.
 * Persisting would risk the badge claiming the user is "connected"
 * to a room they actually closed weeks ago.
 */

interface RoomConnectionState {
  roomId: string | null;
  roomCode: string | null;
  roomName: string | null;
  hostId: string | null;
  hostOnlyControl: boolean;
  /**
   * True when `useRoomBridge` is actively pushing local player state
   * to the room and pulling remote state down. Surfaces in the UI
   * (e.g. badge animation) so the user can tell the bridge is alive
   * even on slow networks.
   */
  isLive: boolean;
  /**
   * Latest server-pushed state mirror. `useRoomBridge` writes this on
   * every successful `/rooms/:id/state` poll so the room page can
   * render members + controller without running its own duplicate
   * 1.5 s loop. `null` until the first poll lands.
   */
  state: RoomState | null;
  members: RoomMember[];
  /** Server clock — Date.now offset, kept fresh by the bridge. */
  serverNowMs: number;
  setActive: (info: {
    roomId: string;
    roomCode: string;
    roomName: string;
    hostId: string;
    hostOnlyControl: boolean;
  }) => void;
  setHostOnlyControl: (value: boolean) => void;
  setLive: (live: boolean) => void;
  setRemote: (info: { state: RoomState; members: RoomMember[]; serverNowMs: number }) => void;
  clear: () => void;
}

export const useRoomConnectionStore = create<RoomConnectionState>((set) => ({
  roomId: null,
  roomCode: null,
  roomName: null,
  hostId: null,
  hostOnlyControl: false,
  isLive: false,
  state: null,
  members: [],
  serverNowMs: 0,
  setActive: ({ roomId, roomCode, roomName, hostId, hostOnlyControl }) =>
    set((prev) => {
      // Switching to a different room: tear down stale state so the
      // bridge doesn't briefly render the previous room's playback.
      if (prev.roomId !== roomId) {
        return { roomId, roomCode, roomName, hostId, hostOnlyControl, isLive: false, state: null, members: [] };
      }
      // Same room — refresh metadata in place so we don't flicker the
      // members list / "live" badge while the detail query refetches
      // (e.g. after an optimistic settings update bumps the cache).
      return { roomCode, roomName, hostId, hostOnlyControl };
    }),
  setHostOnlyControl: (hostOnlyControl) => set({ hostOnlyControl }),
  setLive: (isLive) => set({ isLive }),
  setRemote: ({ state, members, serverNowMs }) => set({ state, members, serverNowMs }),
  clear: () => set({
    roomId: null,
    roomCode: null,
    roomName: null,
    hostId: null,
    hostOnlyControl: false,
    isLive: false,
    state: null,
    members: [],
    serverNowMs: 0,
  }),
}));
