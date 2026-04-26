export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;

  TIDAL_CLIENT_ID: string;
  TIDAL_CLIENT_SECRET: string;
  TIDAL_SESSION_TOKEN: string;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_ADMIN_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  SESSION_ENCRYPTION_KEY: string;

  ENVIRONMENT: string;
}

export interface Variables {
  userId: string;
  isAdmin: boolean;
}
