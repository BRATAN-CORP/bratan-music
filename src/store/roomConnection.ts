import { create } from 'zustand';

/**
 * Lightweight, NON-persisted store for the room the current user is
 * actively viewing. The room page sets this on mount and clears it on
 * unmount; layout-level chrome (the floating "ты в комнате" corner
 * badge) reads it so the indicator follows the user even if they
 * navigate to /home or /library while staying logically connected.
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
  setActive: (info: { roomId: string; roomCode: string; roomName: string }) => void;
  clear: () => void;
}

export const useRoomConnectionStore = create<RoomConnectionState>((set) => ({
  roomId: null,
  roomCode: null,
  roomName: null,
  setActive: ({ roomId, roomCode, roomName }) => set({ roomId, roomCode, roomName }),
  clear: () => set({ roomId: null, roomCode: null, roomName: null }),
}));
