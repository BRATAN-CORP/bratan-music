import type { Env } from '../types/env';

export interface Subscription {
  id: string;
  user_id: string;
  status: 'active' | 'expired' | 'manual';
  expires_at: number;
  payment_method: string | null;
  stars_tx_id: string | null;
  created_at: number;
  updated_at: number;
}

export class SubscriptionService {
  constructor(private env: Env) {}

  async getActive(userId: string): Promise<Subscription | null> {
    const now = Math.floor(Date.now() / 1000);
    return this.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'
    ).bind(userId, 'active', now).first<Subscription>();
  }

  async activate(userId: string, paymentMethod: string, starsTxId?: string): Promise<Subscription> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 30 * 24 * 60 * 60;
    const id = crypto.randomUUID();

    await this.env.DB.prepare(
      'INSERT INTO subscriptions (id, user_id, status, expires_at, payment_method, stars_tx_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, userId, 'active', expiresAt, paymentMethod, starsTxId ?? null, now, now).run();

    return (await this.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<Subscription>())!;
  }

  async activateManual(userId: string, days: number = 30): Promise<Subscription> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + days * 24 * 60 * 60;
    const id = crypto.randomUUID();

    await this.env.DB.prepare(
      'INSERT INTO subscriptions (id, user_id, status, expires_at, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, userId, 'active', expiresAt, 'manual', now, now).run();

    return (await this.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<Subscription>())!;
  }

  async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await this.getActive(userId);
    return sub !== null;
  }

  async expireOld(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.env.DB.prepare(
      'UPDATE subscriptions SET status = ?, updated_at = ? WHERE status = ? AND expires_at <= ?'
    ).bind('expired', now, 'active', now).run();

    return result.meta.changes ?? 0;
  }
}
