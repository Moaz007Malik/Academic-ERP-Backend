import Redis from 'ioredis';
import { env } from './env.js';

let redis = null;

export function isRedisEnabled() {
  return env.redisEnabled;
}

export function isRedisReady() {
  return isRedisEnabled() && redis?.status === 'ready';
}

export function getRedis() {
  if (!isRedisEnabled()) return null;
  if (!redis) {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });
    redis.on('error', () => {
      // Suppress noisy logs when Redis is optional
    });
  }
  return redis;
}

export async function connectRedis() {
  if (!isRedisEnabled()) {
    console.log('Redis disabled (REDIS_ENABLED=false)');
    return null;
  }

  const client = getRedis();
  try {
    if (client.status !== 'ready') await client.connect();
    console.log('Redis connected');
  } catch {
    console.warn('Redis enabled but unavailable — token cache/revocation disabled');
    redis = null;
  }
  return client;
}
