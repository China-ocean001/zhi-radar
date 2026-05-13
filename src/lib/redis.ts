/**
 * Upstash Redis 缓存封装
 * 选题池缓存 6 小时，缓存 key 按领域隔离
 * 未配置 Redis 时静默降级为 null（不缓存）
 */

import { Redis } from "@upstash/redis";

// 仅当两个环境变量都存在时才初始化，否则返回 null（开发/demo 场景）
function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = createRedis();

const TOPIC_CACHE_TTL = 60 * 60 * 6; // 6小时

/** 读取缓存 */
export async function getCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const data = await redis.get<T>(key);
    return data ?? null;
  } catch (e) {
    console.warn("[redis] get error:", e);
    return null;
  }
}

/** 写入缓存 */
export async function setCache<T>(
  key: string,
  value: T,
  ttl = TOPIC_CACHE_TTL
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttl });
  } catch (e) {
    console.warn("[redis] set error:", e);
  }
}

/** 生成选题池缓存 key */
export function topicCacheKey(domain: string): string {
  return `zhi-radar:topics:${domain}`;
}

/** 滑动窗口限流（每分钟最多 N 次） */
export async function checkRateLimit(
  identifier: string,
  limit = 20
): Promise<boolean> {
  if (!redis) return true; // 未配置 Redis 时不限流
  const key = `zhi-radar:ratelimit:${identifier}:${Math.floor(Date.now() / 60000)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count <= limit;
  } catch {
    return true;
  }
}
