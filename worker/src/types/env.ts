export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  TRACKS: R2Bucket;

  TIDAL_CLIENT_ID: string;
  TIDAL_CLIENT_SECRET: string;
  TIDAL_SESSION_TOKEN: string;
  TIDAL_REFRESH_TOKEN?: string;
  TIDAL_CLIENT_VERSION?: string;
  TIDAL_COUNTRY_CODE?: string;
  TIDAL_LOCALE?: string;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_ADMIN_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  APP_URL?: string;

  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  SESSION_ENCRYPTION_KEY: string;

  ENVIRONMENT: string;
}

export interface Variables {
  userId: string;
  isAdmin: boolean;
}
