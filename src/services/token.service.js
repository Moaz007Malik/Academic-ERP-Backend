import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { getRedis, isRedisReady } from '../config/redis.js';

const REFRESH_PREFIX = 'refresh:';
const DENYLIST_PREFIX = 'denylist:';

export function signAccessToken(payload) {
  const jti = uuidv4();
  return jwt.sign(
    { ...payload, jti },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiry }
  );
}

export function signRefreshToken(payload) {
  const jti = uuidv4();
  return jwt.sign(
    { ...payload, jti },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiry }
  );
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

export async function storeRefreshToken(userId, token) {
  if (!isRedisReady()) return;
  const redis = getRedis();
  const decoded = jwt.decode(token);
  const ttl = decoded.exp - Math.floor(Date.now() / 1000);
  await redis.setex(`${REFRESH_PREFIX}${userId}`, ttl, token);
}

export async function getStoredRefreshToken(userId) {
  if (!isRedisReady()) return null;
  const redis = getRedis();
  return redis.get(`${REFRESH_PREFIX}${userId}`);
}

export async function revokeRefreshToken(userId) {
  if (!isRedisReady()) return;
  const redis = getRedis();
  const token = await redis.get(`${REFRESH_PREFIX}${userId}`);
  if (token) {
    const decoded = jwt.decode(token);
    if (decoded?.jti) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) await redis.setex(`${DENYLIST_PREFIX}${decoded.jti}`, ttl, '1');
    }
  }
  await redis.del(`${REFRESH_PREFIX}${userId}`);
}

export async function denylistToken(jti, exp) {
  if (!isRedisReady()) return;
  const redis = getRedis();
  const ttl = exp - Math.floor(Date.now() / 1000);
  if (ttl > 0) await redis.setex(`${DENYLIST_PREFIX}${jti}`, ttl, '1');
}

export async function revokeAllUserTokens(userId) {
  await revokeRefreshToken(userId);
}

export function isRefreshTokenValid(stored, token) {
  if (!isRedisReady()) return true;
  return stored === token;
}
