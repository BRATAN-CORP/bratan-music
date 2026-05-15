export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  TRACKS: R2Bucket;
  /** Per-room broadcast hub — see worker/src/do/ChatRoomDO.ts. */
  CHAT_ROOM: DurableObjectNamespace;

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

  // Yandex AI Studio (gpt-oss-120b) — used for AI playlist generation.
  YANDEX_API_TOKEN?: string;
  YANDEX_FOLDER_ID?: string;
  YANDEX_MODEL_URI?: string;

  // Brevo (transactional email provider) — used for the
  // passwordless email-OTP login flow. The API key is the only real
  // secret; sender email/name are non-sensitive plain vars and
  // declared in [vars] in wrangler.toml so they're visible at deploy
  // time.
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
}

export interface Variables {
  userId: string;
  isAdmin: boolean;
  /** Row id from the `sessions` table that issued the current access
   *  token. Populated by `jwtAuth` middleware from the JWT's `sid`
   *  claim. Used by `/user/sessions` to mark "current" in the device
   *  list and by `/user/sessions/logout-all` to know which row to
   *  preserve. Optional because access tokens minted before the
   *  `sid` claim existed don't carry one. */
  sessionId?: string;
}
