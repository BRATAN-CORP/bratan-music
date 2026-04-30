import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminUsersResponse } from '@/types/admin';

export interface AdminUsersFilters {
  q?: string;
  role?: 'admin' | 'user' | '';
  banned?: '1' | '0' | '';
  sub?: 'active' | 'none' | '';
  sort?: 'created_at' | 'last_played_at' | 'tg_username';
  limit?: number;
  offset?: number;
}

function buildQS(f: AdminUsersFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.role) p.set('role', f.role);
  if (f.banned) p.set('banned', f.banned);
  if (f.sub) p.set('sub', f.sub);
  if (f.sort) p.set('sort', f.sort);
  if (f.limit) p.set('limit', String(f.limit));
  if (f.offset) p.set('offset', String(f.offset));
  return p.toString();
}

export function useAdminUsers(filters: AdminUsersFilters) {
  return useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () => api.get<AdminUsersResponse>(`/admin/users?${buildQS(filters)}`),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

export function useBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      api.post<{ ok: boolean }>(`/admin/users/${id}/ban`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useUnbanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.post<{ ok: boolean }>(`/admin/users/${id}/unban`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useToggleAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      api.post<{ ok: boolean }>('/admin/admin-flag', { userId, isAdmin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useGrantSub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, days }: { userId: string; days: number }) =>
      api.post<{ ok: boolean }>('/admin/grant', { userId, days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
