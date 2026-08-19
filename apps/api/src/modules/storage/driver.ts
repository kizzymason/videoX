import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppError, ErrorCode } from '../../core/errors.js';
import { env } from '../../config/env.js';

export interface ObjectMeta {
  size: number;
  contentType: string;
}

export interface GetResult extends ObjectMeta {
  stream: Readable;
}

export interface GetRange {
  start?: number;
  end?: number;
}

export interface Storage {
  get(key: string, range?: GetRange): Promise<GetResult>;
  getBuffer(key: string): Promise<Buffer>;
  put(key: string, body: Readable | Buffer, contentType?: string): Promise<void>;
  putFile(key: string, localPath: string, contentType?: string): Promise<void>;
  head(key: string): Promise<ObjectMeta | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
}

const MIME: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  ts: 'video/mp2t',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  vtt: 'text/vtt',
  bin: 'application/octet-stream',
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** 去掉前导斜杠、禁止 `..`，避免本地盘越权读到仓库外。 */
export function sanitizeKey(key: string): string {
  const cleaned = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) {
    throw AppError.badRequest('非法的存储路径');
  }
  return cleaned;
}

export interface DriverConfig {
  driver: 'local' | 's3';
  root?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
}

export function createStorageDriver(config: DriverConfig): Storage {
  if (config.driver === 's3') return new S3Storage(config);
  return new LocalStorage(config.root || env.storageRoot);
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const safe = sanitizeKey(key);
    const full = path.resolve(this.root, safe);
    const root = path.resolve(this.root);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw AppError.badRequest('非法的存储路径');
    }
    return full;
  }

  async get(key: string, range?: GetRange): Promise<GetResult> {
    const file = this.resolve(key);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new AppError({ message: '对象不存在', code: ErrorCode.NOT_FOUND, status: 404 });
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    const stream = createReadStream(file, { start, end });
    return { stream, size: Math.max(0, end - start + 1), contentType: contentTypeFor(key) };
  }

  async getBuffer(key: string): Promise<Buffer> {
    const file = this.resolve(key);
    return fsp.readFile(file);
  }

  async put(key: string, body: Readable | Buffer, _contentType?: string): Promise<void> {
    const file = this.resolve(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await fsp.writeFile(file, body);
      return;
    }
    await pipeline(body, createWriteStream(file));
  }

  async putFile(key: string, localPath: string, contentType?: string): Promise<void> {
    await this.put(key, createReadStream(localPath), contentType);
  }

  async head(key: string): Promise<ObjectMeta | null> {
    const file = this.resolve(key);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    return { size: stat.size, contentType: contentTypeFor(key) };
  }

  async delete(key: string): Promise<void> {
    await fsp.unlink(this.resolve(key)).catch(() => undefined);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const dir = this.resolve(prefix);
    const stat = await fsp.stat(dir).catch(() => null);
    if (!stat) return 0;
    if (stat.isFile()) {
      await fsp.unlink(dir).catch(() => undefined);
      return 1;
    }
    let count = 0;
    const walk = async (current: string): Promise<void> => {
      const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(next);
        else {
          await fsp.unlink(next).catch(() => undefined);
          count += 1;
        }
      }
    };
    await walk(dir);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return count;
  }
}

class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: DriverConfig) {
    if (!config.bucket) {
      throw new AppError({
        message: 'S3 bucket 未配置',
        code: ErrorCode.STORAGE_ERROR,
        status: 500,
      });
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region || 'auto',
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    });
  }

  async get(key: string, range?: GetRange): Promise<GetResult> {
    const safe = sanitizeKey(key);
    const Range =
      range && (range.start !== undefined || range.end !== undefined)
        ? `bytes=${range.start ?? 0}-${range.end ?? ''}`
        : undefined;
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safe, Range }));
      const body = out.Body;
      if (!body) throw new AppError({ message: '对象不存在', code: ErrorCode.NOT_FOUND, status: 404 });
      const stream = body as Readable;
      const size = Number(out.ContentLength ?? 0);
      return { stream, size, contentType: out.ContentType || contentTypeFor(safe) };
    } catch (error) {
      throw wrapStorageError(error, '读取对象失败');
    }
  }

  async getBuffer(key: string): Promise<Buffer> {
    const result = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async put(key: string, body: Readable | Buffer, contentType?: string): Promise<void> {
    const safe = sanitizeKey(key);
    const payload = Buffer.isBuffer(body) ? body : await readableToBuffer(body);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: safe,
          Body: payload,
          ContentType: contentType || contentTypeFor(safe),
        }),
      );
    } catch (error) {
      throw wrapStorageError(error, '写入对象失败');
    }
  }

  async putFile(key: string, localPath: string, contentType?: string): Promise<void> {
    const buf = await fsp.readFile(localPath);
    await this.put(key, buf, contentType);
  }

  async head(key: string): Promise<ObjectMeta | null> {
    const safe = sanitizeKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safe }));
      return { size: Number(out.ContentLength ?? 0), contentType: out.ContentType || contentTypeFor(safe) };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw wrapStorageError(error, '探测对象失败');
    }
  }

  async delete(key: string): Promise<void> {
    const safe = sanitizeKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safe }));
    } catch (error) {
      throw wrapStorageError(error, '删除对象失败');
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const safe = sanitizeKey(prefix);
    let count = 0;
    let token: string | undefined;
    try {
      do {
        const listed = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: safe.endsWith('/') ? safe : `${safe}/`,
            ContinuationToken: token,
          }),
        );
        const objects = (listed.Contents ?? []).filter((o) => o.Key).map((o) => ({ Key: o.Key! }));
        if (objects.length > 0) {
          await this.client.send(
            new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }),
          );
          count += objects.length;
        }
        token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (token);
    } catch (error) {
      throw wrapStorageError(error, '批量删除失败');
    }
    return count;
  }
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function wrapStorageError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (status === 404) return AppError.notFound('对象不存在');
  const message = error instanceof Error ? error.message : fallback;
  return new AppError({ message, code: ErrorCode.STORAGE_ERROR, status: 500, cause: error });
}
