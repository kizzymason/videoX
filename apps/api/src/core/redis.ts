import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let client: Redis | null = null;

/** 通用连接：缓存、计数器、在线状态。 */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    client.on('error', (error) => logger.error({ err: error }, 'Redis 连接异常'));
  }
  return client;
}

/**
 * BullMQ 要求 maxRetriesPerRequest = null 的独立连接，
 * 不能和普通命令共用上面那个客户端。
 */
export function createQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}

/** 带兜底的缓存读取：Redis 挂了也不影响主流程，退化为直接查库。 */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch (error) {
    logger.warn({ err: error, key }, '读取缓存失败，回落到数据源');
  }

  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn({ err: error, key }, '写入缓存失败');
  }
  return value;
}

export async function invalidate(pattern: string): Promise<void> {
  const redis = getRedis();
  try {
    // 用 scan 而非 keys，避免在大 key 空间上阻塞 Redis。
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (error) {
    logger.warn({ err: error, pattern }, '清理缓存失败');
  }
}
