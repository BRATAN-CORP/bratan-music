import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRoomConnectionStore } from '@/store/roomConnection';
import type { RoomDetail, RoomListItem } from '@/types/rooms';

export function useRoomsList() {
  return useQuery({
    queryKey: ['rooms', 'list'],
    queryFn: async () => {
      const res = await api.get<{ items: RoomListItem[] }>('/rooms');
      return res.items;
    },
    staleTime: 15_000,
  });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name?: string) => api.post<RoomDetail>('/rooms', { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms', 'list'] });
    },
  });
}

export function useJoinRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => api.post<RoomDetail>('/rooms/join', { code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms', 'list'] });
    },
  });
}

export function useLeaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.post<{ ok: boolean }>(`/rooms/${id}/leave`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms', 'list'] });
    },
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete<{ ok: boolean }>(`/rooms/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms', 'list'] });
    },
  });
}

/**
 * Toggle a room's host-only-control flag. PATCH returns the updated
 * RoomDetail so callers can hand it straight back to the room-detail
 * cache without an extra round-trip — the worker has already paid the
 * cost of recomputing state + members.
 *
 * Applies the change optimistically to both the detail cache and the
 * connection store so the toggle responds instantly. If the request
 * fails (network blip, lost host status, etc.) we roll back to the
 * pre-mutation snapshot so the UI reflects the actual server truth.
 */
export function useUpdateRoomSettings(roomId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: { hostOnlyControl?: boolean }) => {
      if (!roomId) throw new Error('roomId required');
      return api.patch<RoomDetail>(`/rooms/${roomId}/settings`, settings);
    },
    onMutate: async (settings) => {
      if (!roomId) return { previousDetail: undefined, previousHostOnly: undefined };
      await qc.cancelQueries({ queryKey: ['rooms', 'detail', roomId] });
      const previousDetail = qc.getQueryData<RoomDetail>(['rooms', 'detail', roomId]);
      const previousHostOnly = useRoomConnectionStore.getState().hostOnlyControl;
      if (typeof settings.hostOnlyControl === 'boolean') {
        if (previousDetail) {
          qc.setQueryData<RoomDetail>(['rooms', 'detail', roomId], {
            ...previousDetail,
            hostOnlyControl: settings.hostOnlyControl,
          });
        }
        useRoomConnectionStore.getState().setHostOnlyControl(settings.hostOnlyControl);
      }
      return { previousDetail, previousHostOnly };
    },
    onError: (_err, _vars, ctx) => {
      if (!roomId || !ctx) return;
      if (ctx.previousDetail !== undefined) {
        qc.setQueryData(['rooms', 'detail', roomId], ctx.previousDetail);
      }
      if (typeof ctx.previousHostOnly === 'boolean') {
        useRoomConnectionStore.getState().setHostOnlyControl(ctx.previousHostOnly);
      }
    },
    onSuccess: (next) => {
      qc.setQueryData(['rooms', 'detail', roomId], next);
      useRoomConnectionStore.getState().setHostOnlyControl(next.hostOnlyControl);
    },
  });
}
