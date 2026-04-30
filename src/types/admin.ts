export interface AdminUser {
  id: string;
  username: string | null;
  name: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt: number | null;
  bannedReason: string | null;
  subscription: { status: 'active'; expiresAt: number } | null;
  lastPlayedAt: number | null;
  playCount: number;
  createdAt: number;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}
