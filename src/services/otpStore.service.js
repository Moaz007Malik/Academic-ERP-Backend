import { isRedisReady } from '../config/redis.js';

const OTP_PREFIX = 'otp:';
const TTL_SECONDS = 900;

// In-process fallback when Redis is disabled — mirrors the job queue's in-process fallback
// (src/jobs/jobQueue.js). Without this, forgotPassword hands out a devOtp that
// resetPassword can never verify, since there's nowhere to check it against.
const memoryStore = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key);
  }
}

export async function setOtp(email, otp) {
  const key = `${OTP_PREFIX}${email.toLowerCase()}`;
  if (isRedisReady()) {
    const { getRedis } = await import('../config/redis.js');
    await getRedis().setex(key, TTL_SECONDS, otp);
    return;
  }
  pruneExpired();
  memoryStore.set(key, { otp, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

export async function getOtp(email) {
  const key = `${OTP_PREFIX}${email.toLowerCase()}`;
  if (isRedisReady()) {
    const { getRedis } = await import('../config/redis.js');
    return getRedis().get(key);
  }
  pruneExpired();
  return memoryStore.get(key)?.otp ?? null;
}

export async function clearOtp(email) {
  const key = `${OTP_PREFIX}${email.toLowerCase()}`;
  if (isRedisReady()) {
    const { getRedis } = await import('../config/redis.js');
    await getRedis().del(key);
    return;
  }
  memoryStore.delete(key);
}
