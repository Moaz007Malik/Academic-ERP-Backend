import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { isRedisReady } from '../config/redis.js';
import { getRedis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';
import { isSubscriptionExpired } from '../utils/instituteAccess.js';

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }

    const token = authHeader.slice(7);
    let payload;

    try {
      payload = jwt.verify(token, env.jwt.accessSecret);
    } catch {
      throw new AppError('Invalid or expired token', 401);
    }

    if (isRedisReady()) {
      const redis = getRedis();
      const denied = await redis.get(`denylist:${payload.jti}`);
      if (denied) throw new AppError('Token revoked', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { institute: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('User not found or inactive', 401);
    }

    const institute = user.institute;
    const expired = institute ? isSubscriptionExpired(institute) : false;

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      instituteId: user.instituteId,
      firstName: user.firstName,
      lastName: user.lastName,
      activeModules: institute?.activeModules ?? [],
      instituteStatus: expired && institute?.status === 'ACTIVE' ? 'EXPIRED' : (institute?.status ?? null),
      subscriptionExpiry: institute?.expiryDate ?? null,
      instituteName: institute?.name ?? null,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
}
