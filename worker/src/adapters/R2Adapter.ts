/**
 * R2Bucket-compatible adapter backed by MinIO (S3-compatible).
 *
 * The worker uses R2 in 6 places:
 *   env.TRACKS.get(key)              → R2ObjectBody | null
 *   env.TRACKS.get(key, { range })   → R2ObjectBody | null
 *   env.TRACKS.put(key, body, meta)  → R2Object
 *   env.TRACKS.delete(key)           → void
 */

import * as Minio from 'minio';
import { Readable } from 'stream';

/* ── R2-compatible response shapes ───────────────────── */

interface R2ObjectBody {
  key: string;
  size: number;
  etag: string;
  httpMetadata: { contentType?: string };
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
  writeHttpMetadata(headers: Headers): void;
  range?: { offset: number; length: number };
}

interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface R2GetOptions {
  range?: R2Range | Headers;
}

/* ── Helpers ─────────────────────────────────────────── */

function nodeStreamToWebReadable(nodeStream: Readable): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

function webReadableToNodeStream(webStream: ReadableStream | ArrayBuffer | Buffer | Uint8Array): Readable {
  if (webStream instanceof ArrayBuffer || webStream instanceof Buffer || webStream instanceof Uint8Array) {
    return Readable.from(Buffer.from(webStream as any));
  }
  const reader = (webStream as ReadableStream).getReader();
  return new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        this.push(Buffer.from(value));
      }
    },
  });
}

/* ── R2Bucket adapter ────────────────────────────────── */

export class R2BucketAdapter {
  private client: Minio.Client;
  private bucket: string;

  constructor(opts: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  }) {
    this.client = new Minio.Client({
      endPoint: opts.endPoint,
      port: opts.port,
      useSSL: opts.useSSL,
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
    });
    this.bucket = opts.bucket;
  }

  /** Ensure bucket exists (call once at startup). */
  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    try {
      // Build range headers for MinIO
      const getOpts: Record<string, number> = {};
      if (options?.range && !(options.range instanceof Headers)) {
        const r = options.range as R2Range;
        if (r.offset !== undefined) getOpts['offset'] = r.offset;
        if (r.length !== undefined) getOpts['length'] = r.length;
      }

      // Stat to get metadata
      const stat = await this.client.statObject(this.bucket, key);

      // Get stream
      const stream = await this.client.getObject(this.bucket, key);

      const webStream = nodeStreamToWebReadable(stream);

      const obj: R2ObjectBody = {
        key,
        size: stat.size,
        etag: stat.etag,
        httpMetadata: {
          contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
        },
        body: webStream,
        bodyUsed: false,
        range: options?.range && !(options.range instanceof Headers)
          ? { offset: (options.range as R2Range).offset ?? 0, length: (options.range as R2Range).length ?? stat.size }
          : undefined,
        async arrayBuffer(): Promise<ArrayBuffer> {
          const reader = webStream.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const res = await reader.read();
            done = res.done;
            if (res.value) chunks.push(res.value);
          }
          const total = chunks.reduce((a, c) => a + c.length, 0);
          const buf = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            buf.set(chunk, offset);
            offset += chunk.length;
          }
          return buf.buffer;
        },
        async text() {
          const ab = await this.arrayBuffer();
          return new TextDecoder().decode(ab);
        },
        async json<T>() {
          return JSON.parse(await this.text()) as T;
        },
        async blob() {
          const ab = await this.arrayBuffer();
          return new Blob([ab]);
        },
        writeHttpMetadata(headers: Headers) {
          if (stat.metaData?.['content-type']) {
            headers.set('Content-Type', stat.metaData['content-type']);
          }
          headers.set('Content-Length', String(stat.size));
          headers.set('ETag', stat.etag);
        },
      };
      return obj;
    } catch (err: any) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
        return null;
      }
      throw err;
    }
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | Buffer | Uint8Array | null,
    options?: R2PutOptions,
  ): Promise<{ key: string; size: number; etag: string }> {
    let stream: Readable;
    let size: number | undefined;

    if (typeof value === 'string') {
      const buf = Buffer.from(value);
      stream = Readable.from(buf);
      size = buf.length;
    } else if (value instanceof ArrayBuffer) {
      const buf = Buffer.from(value);
      stream = Readable.from(buf);
      size = buf.length;
    } else if (value instanceof Buffer) {
      stream = Readable.from(value);
      size = value.length;
    } else if (value instanceof Uint8Array) {
      const buf = Buffer.from(value);
      stream = Readable.from(buf);
      size = buf.length;
    } else if (value && typeof (value as ReadableStream).getReader === 'function') {
      stream = webReadableToNodeStream(value as ReadableStream);
    } else {
      stream = Readable.from(Buffer.alloc(0));
      size = 0;
    }

    const metaData: Record<string, string> = {};
    if (options?.httpMetadata?.contentType) {
      metaData['Content-Type'] = options.httpMetadata.contentType;
    }
    if (options?.customMetadata) {
      Object.assign(metaData, options.customMetadata);
    }

    const result = await this.client.putObject(this.bucket, key, stream, size, metaData);
    return {
      key,
      size: size ?? 0,
      etag: result.etag,
    };
  }

  async delete(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      await this.client.removeObjects(this.bucket, key);
    } else {
      await this.client.removeObject(this.bucket, key);
    }
  }

  async head(key: string): Promise<{ key: string; size: number; etag: string } | null> {
    try {
      const stat = await this.client.statObject(this.bucket, key);
      return { key, size: stat.size, etag: stat.etag };
    } catch (err: any) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') return null;
      throw err;
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    objects: Array<{ key: string; size: number; etag: string }>;
    truncated: boolean;
    cursor: string;
  }> {
    return new Promise((resolve, reject) => {
      const objects: Array<{ key: string; size: number; etag: string }> = [];
      const stream = this.client.listObjectsV2(this.bucket, options?.prefix ?? '', true);
      const limit = options?.limit ?? 1000;
      stream.on('data', (obj) => {
        if (objects.length < limit && obj.name) {
          objects.push({ key: obj.name, size: obj.size, etag: obj.etag });
        }
      });
      stream.on('end', () => resolve({ objects, truncated: false, cursor: '' }));
      stream.on('error', reject);
    });
  }
}
