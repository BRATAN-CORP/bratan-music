import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
