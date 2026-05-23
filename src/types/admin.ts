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

// All "*At" fields below are unix seconds. The worker normalises
// play_history.played_at (stored as Date.now() ms) to seconds before
// returning so callers can treat every timestamp uniformly.
export interface AdminUserStatsSubscription {
  id: string;
  status: string;
  expiresAt: number;
  paymentMethod: string | null;
  starsTxId: string | null;
  createdAt: number;
  updatedAt?: number;
}

export interface AdminUserStatsRecentPlay {
  trackId: string;
  source: string;
  title: string;
  artistName: string;
  coverUrl: string | null;
  duration: number;
  listenedSeconds: number;
  completed: boolean;
  playedAt: number;
}

export interface AdminUserStats {
  user: {
    id: string;
    username: string | null;
    name: string | null;
    email: string | null;
    isAdmin: boolean;
    isBanned: boolean;
    bannedAt: number | null;
    bannedBy: string | null;
    bannedReason: string | null;
    tourCompletedAt: number | null;
    createdAt: number;
    updatedAt: number;
  };
  subscription: {
    current: AdminUserStatsSubscription | null;
    history: AdminUserStatsSubscription[];
  };
  storage: {
    uploads: { count: number; bytes: number };
    overrides: { count: number; bytes: number };
    totalBytes: number;
  };
  library: {
    playlists: { total: number; liked: number; created: number };
    playlistTracks: number;
    libraryAlbums: number;
    libraryArtists: number;
    dislikes: number;
  };
  playHistory: {
    total: number;
    last7d: number;
    last30d: number;
    lastPlayedAt: number | null;
    bySource: Array<{ source: string; count: number }>;
    recent: AdminUserStatsRecentPlay[];
  };
  sessions: {
    active: number;
    lastCreatedAt: number | null;
  };
  preferences: unknown;
}
