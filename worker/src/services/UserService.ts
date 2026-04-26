import type { Env } from '../types/env';

export interface User {
  id: string;
  tg_username: string | null;
  tg_name: string | null;
  is_admin: number;
  created_at: number;
  updated_at: number;
}

export class UserService {
  constructor(private env: Env) {}

  async findById(id: string): Promise<User | null> {
    return this.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  }

  async upsert(data: {
    id: string;
    tgUsername?: string;
    tgName?: string;
  }): Promise<User> {
    const now = Math.floor(Date.now() / 1000);
    const existing = await this.findById(data.id);

    if (existing) {
      await this.env.DB.prepare(
        'UPDATE users SET tg_username = ?, tg_name = ?, updated_at = ? WHERE id = ?'
      ).bind(data.tgUsername ?? existing.tg_username, data.tgName ?? existing.tg_name, now, data.id).run();

      return (await this.findById(data.id))!;
    }

    const adminIds = this.env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim());
    const isAdmin = adminIds.includes(data.id) ? 1 : 0;

    await this.env.DB.prepare(
      'INSERT INTO users (id, tg_username, tg_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(data.id, data.tgUsername ?? null, data.tgName ?? null, isAdmin, now, now).run();

    return (await this.findById(data.id))!;
  }

  async isAdmin(userId: string): Promise<boolean> {
    const user = await this.findById(userId);
    return user?.is_admin === 1;
  }
}
