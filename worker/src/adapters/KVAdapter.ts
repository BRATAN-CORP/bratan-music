/**
 * KVNamespace-compatible adapter backed by Redis.
 *
 * The worker only uses KV in two places (recommendation cache):
 *   env.SESSIONS.get(key, 'json')             → parsed JSON | null
 *   env.SESSIONS.put(key, json, { expirationTtl }) → void
 *
 * We implement the full KVNamespace surface for completeness.
 */

import type { Redis } from 'ioredis';

export class KVNamespaceAdapter {
  constructor(private redis: Redis) {}

  /**
   * Get a value by key.
   * @param type — 'text' (default), 'json', 'arrayBuffer', 'stream'
   */
  async get(key: string, type?: string): Promise<any> {
    const value = await this.redis.get(key);
    if (value === null) return null;

    switch (type) {
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      case 'arrayBuffer':
        return new TextEncoder().encode(value).buffer;
      case 'stream':
        return new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(value));
            ctrl.close();
          },
        });
      case 'text':
      default:
        return value;
    }
  }

  /**
   * Get a value with metadata.
   */
  async getWithMetadata(
    key: string,
    type?: string,
  ): Promise<{ value: any; metadata: Record<string, unknown> | null }> {
    const value = await this.get(key, type);
    // We store metadata as a separate key: `${key}:__meta__`
    const metaRaw = await this.redis.get(`${key}:__meta__`);
    const metadata = metaRaw ? JSON.parse(metaRaw) : null;
    return { value, metadata };
  }

  /**
   * Store a value.
   */
  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expiration?: number;
      expirationTtl?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    let strValue: string;
    if (typeof value === 'string') {
      strValue = value;
    } else if (value instanceof ArrayBuffer) {
      strValue = new TextDecoder().decode(value);
    } else {
      // ReadableStream
      const reader = (value as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const res = await reader.read();
        done = res.done;
        if (res.value) chunks.push(res.value);
      }
      strValue = new TextDecoder().decode(
        new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0)),
      );
    }

    if (options?.expirationTtl) {
      await this.redis.set(key, strValue, 'EX', options.expirationTtl);
    } else if (options?.expiration) {
      const ttl = options.expiration - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.set(key, strValue, 'EX', ttl);
      } else {
        await this.redis.set(key, strValue);
      }
    } else {
      await this.redis.set(key, strValue);
    }

    if (options?.metadata) {
      await this.redis.set(`${key}:__meta__`, JSON.stringify(options.metadata));
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key, `${key}:__meta__`);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor: string;
  }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const cursor = options?.cursor ?? '0';
    const [nextCursor, keys] = await this.redis.scan(
      Number(cursor),
      'MATCH',
      `${prefix}*`,
      'COUNT',
      limit,
    );
    return {
      keys: keys
        .filter((k) => !k.endsWith(':__meta__'))
        .map((k) => ({ name: k })),
      list_complete: nextCursor === '0',
      cursor: nextCursor,
    };
  }
}
