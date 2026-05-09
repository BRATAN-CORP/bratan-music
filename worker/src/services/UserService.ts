import type { Env } from '../types/env';

export interface User {
  id: string;
  tg_username: string | null;
  tg_name: string | null;
  /**
   * Numeric Telegram user id stored as a string. For tg-first users
   * created before migration 0027 it equals `id` (back-filled by the
   * migration). For email-first users it is NULL until they go through
   * the "Link Telegram" flow, after which it is set to the numeric
   * Telegram id while `id` keeps its `email_…` prefix to preserve the
   * cascading FKs.
   */
  tg_id: string | null;
  is_admin: number;
  /**
   * Unix seconds when the spotlight onboarding tour was completed (or
   * skipped). `null` for users who haven't run it yet — frontend mounts
   * `<OnboardingTour />` on next login while this is null.
   */
  tour_completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class UserService {
  constructor(private env: Env) {}

  async findById(id: string): Promise<User | null> {
    return this.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  }

  /**
   * Look up by Telegram numeric id. Used by the Telegram login flow
   * so an email-first user that has linked their Telegram identity
   * resolves to their existing row instead of accidentally minting a
   * fresh one (which would happen if we kept looking up by `users.id`
   * — that's still `email_<hex>` for them).
   *
   * Falls back to a `WHERE id = ?` lookup so legacy tg-first rows
   * created before migration 0027 (which back-fills `tg_id`) are still
   * resolvable in the unlikely case the back-fill didn't run yet.
   */
  async findByTgId(tgId: string): Promise<User | null> {
    const row = await this.env.DB
      .prepare('SELECT * FROM users WHERE tg_id = ? LIMIT 1')
      .bind(tgId)
      .first<User>();
    if (row) return row;
    return this.findById(tgId);
  }

  async upsert(data: {
    id: string;
    tgUsername?: string;
    tgName?: string;
  }): Promise<User> {
    const now = Math.floor(Date.now() / 1000);
    // Look up by `tg_id` first so the email-first → linked-tg user
    // resolves to their existing row instead of triggering an INSERT
    // that the UNIQUE INDEX on `tg_id` would reject. Falls back to
    // `id`-lookup for legacy tg-first rows.
    const existing = await this.findByTgId(data.id);

    if (existing) {
      await this.env.DB.prepare(
        'UPDATE users SET tg_username = ?, tg_name = ?, tg_id = COALESCE(tg_id, ?), updated_at = ? WHERE id = ?'
      ).bind(
        data.tgUsername ?? existing.tg_username,
        data.tgName ?? existing.tg_name,
        data.id,
        now,
        existing.id,
      ).run();

      return (await this.findById(existing.id))!;
    }

    const adminIds = this.env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim());
    const isAdmin = adminIds.includes(data.id) ? 1 : 0;

    await this.env.DB.prepare(
      'INSERT INTO users (id, tg_id, tg_username, tg_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      data.id,
      data.id,
      data.tgUsername ?? null,
      data.tgName ?? null,
      isAdmin,
      now,
      now,
    ).run();

    return (await this.findById(data.id))!;
  }

  /**
   * Bind a Telegram identity to an existing user row. Used by the
   * "Link Telegram" flow that email-first users go through to attach
   * a Telegram account post-signup.
   *
   * Throws when the tg_id is already bound to a different user — the
   * caller (`/user/me/telegram/link/finish`) surfaces that as a 409
   * so the UI can tell the user the Telegram account is already
   * attached elsewhere.
   */
  async linkTelegram(userId: string, tg: { id: string; username: string | null; name: string | null }): Promise<User> {
    const now = Math.floor(Date.now() / 1000);

    // Refuse if some other user already owns this tg_id. Race-aware
    // UPDATE below also catches this via UNIQUE, but the explicit
    // pre-check lets us surface a dedicated error instead of a generic
    // constraint violation.
    const owner = await this.env.DB
      .prepare('SELECT id FROM users WHERE tg_id = ? LIMIT 1')
      .bind(tg.id)
      .first<{ id: string }>();
    if (owner && owner.id !== userId) {
      throw new Error('tg_id_taken');
    }

    await this.env.DB
      .prepare('UPDATE users SET tg_id = ?, tg_username = ?, tg_name = ?, updated_at = ? WHERE id = ?')
      .bind(tg.id, tg.username, tg.name, now, userId)
      .run();

    return (await this.findById(userId))!;
  }

  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.findById(userId);
    return user?.is_admin === 1;
  }

  /** Mark the spotlight onboarding tour as finished for the user.
   *  Idempotent — calling it twice keeps the original timestamp. */
  async markTourCompleted(userId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.prepare(
      'UPDATE users SET tour_completed_at = COALESCE(tour_completed_at, ?), updated_at = ? WHERE id = ?',
    )
      .bind(now, now, userId)
      .run();
  }

  /** Replay the tour on next login by clearing the completion timestamp.
   *  Used by the profile screen's "Пройти тур заново" affordance. */
  async resetTour(userId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.prepare(
      'UPDATE users SET tour_completed_at = NULL, updated_at = ? WHERE id = ?',
    )
      .bind(now, userId)
      .run();
  }
}
