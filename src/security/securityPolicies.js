import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

import { validatePasswordStrength } from '../utils/passwordPolicy.js';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_HISTORY_COUNT = 5;

export async function recordLoginAttempt(email, ipAddress, success, failReason = null) {
  if (!prisma.loginAttempt?.create) return;
  try {
    await prisma.loginAttempt.create({
      data: { email: email.toLowerCase(), ipAddress, success, failReason },
    });
  } catch (err) {
    console.warn('recordLoginAttempt skipped:', err.message);
  }
}

export async function isAccountLocked(email) {
  if (!prisma.loginAttempt?.count) return false;
  try {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failures = await prisma.loginAttempt.count({
      where: { email: email.toLowerCase(), success: false, attemptedAt: { gte: since } },
    });
    return failures >= LOCKOUT_THRESHOLD;
  } catch (err) {
    console.warn('isAccountLocked skipped:', err.message);
    return false;
  }
}

export async function assertPasswordPolicy(userId, newPassword) {
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    throw new AppError(strengthError, 400);
  }
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_COUNT,
  });
  for (const entry of history) {
    if (await bcrypt.compare(newPassword, entry.passwordHash)) {
      throw new AppError('Cannot reuse a recent password', 400);
    }
  }
}

export async function savePasswordHistory(userId, passwordHash) {
  await prisma.passwordHistory.create({ data: { userId, passwordHash } });
  const old = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: PASSWORD_HISTORY_COUNT,
    select: { id: true },
  });
  if (old.length) {
    await prisma.passwordHistory.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
}

export async function assertIpWhitelist(instituteId, ipAddress) {
  if (!instituteId || !ipAddress || !prisma.ipWhitelist?.findMany) return;
  try {
    const rules = await prisma.ipWhitelist.findMany({
      where: { instituteId, isActive: true },
    });
    if (!rules.length) return;
    const allowed = rules.some((r) => ipInCidr(ipAddress, r.cidr));
    if (!allowed) throw new AppError('Access denied: IP not whitelisted', 403);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.warn('assertIpWhitelist skipped:', err.message);
  }
}

export async function detectSuspiciousLogin(userId, ipAddress, userAgent) {
  const recent = await prisma.loginHistory.findFirst({
    where: { userId, success: true },
    orderBy: { createdAt: 'desc' },
    skip: 1,
  });
  if (!recent) return false;
  return recent.ipAddress && recent.ipAddress !== ipAddress;
}

export async function createUserSession(userId, meta) {
  if (!prisma.userSession?.create) return null;
  try {
    return await prisma.userSession.create({
      data: {
        userId,
        deviceName: meta.deviceName,
        deviceType: meta.deviceType,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
  } catch (err) {
    console.warn('createUserSession skipped:', err.message);
    return null;
  }
}

export async function revokeSession(sessionId, userId) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
}

/** Field-level encryption placeholder — use KMS in production */
export function encryptField(value) {
  if (!env.fieldEncryptionKey) return value;
  // Production: use AES-256-GCM with env.fieldEncryptionKey
  return value;
}

function ipInCidr(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  // Simplified — production should use ip-cidr library
  const [network] = cidr.split('/');
  return ip.startsWith(network.split('.').slice(0, 3).join('.'));
}
