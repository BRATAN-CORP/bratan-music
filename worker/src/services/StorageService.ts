import type { Env } from '../types/env';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/wav'];

export class StorageService {
  constructor(private env: Env) {}

  async upload(userId: string, trackId: string, source: string, body: ReadableStream, mimeType: string, size: number): Promise<string> {
    if (size > MAX_FILE_SIZE) {
      throw new Error(`Файл слишком большой. Максимум: ${MAX_FILE_SIZE / 1024 / 1024} МБ`);
    }

    if (!ALLOWED_TYPES.includes(mimeType)) {
      throw new Error(`Неподдерживаемый формат: ${mimeType}. Допустимые: ${ALLOWED_TYPES.join(', ')}`);
    }

    const r2Key = `overrides/${userId}/${source}/${trackId}`;

    await this.env.TRACKS.put(r2Key, body, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { userId, trackId, source },
    });

    const now = Math.floor(Date.now() / 1000);

    await this.env.DB.prepare(
      `INSERT INTO track_overrides (user_id, track_id, source, r2_key, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, track_id, source)
       DO UPDATE SET r2_key = ?, mime_type = ?, size_bytes = ?, created_at = ?`
    ).bind(userId, trackId, source, r2Key, mimeType, size, now, r2Key, mimeType, size, now).run();

    return r2Key;
  }

  async delete(userId: string, trackId: string, source: string = 'tidal'): Promise<boolean> {
    const override = await this.env.DB.prepare(
      'SELECT r2_key FROM track_overrides WHERE user_id = ? AND track_id = ? AND source = ?'
    ).bind(userId, trackId, source).first<{ r2_key: string }>();

    if (!override) return false;

    await this.env.TRACKS.delete(override.r2_key);
    await this.env.DB.prepare(
      'DELETE FROM track_overrides WHERE user_id = ? AND track_id = ? AND source = ?'
    ).bind(userId, trackId, source).run();

    return true;
  }

  async getUrl(r2Key: string): Promise<string | null> {
    const object = await this.env.TRACKS.head(r2Key);
    if (!object) return null;
    return r2Key;
  }

  async getObject(r2Key: string): Promise<R2ObjectBody | null> {
    return this.env.TRACKS.get(r2Key);
  }
}
