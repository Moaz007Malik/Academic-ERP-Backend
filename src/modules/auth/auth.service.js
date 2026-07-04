import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { AppError } from '../../utils/AppError.js';
import { getPortalRouteForRole } from '../../utils/constants.js';
import { assertLoginAccess, isSubscriptionExpired } from '../../utils/instituteAccess.js';
import {
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  getStoredRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  verifyRefreshToken,
  denylistToken,
  isRefreshTokenValid,
} from '../../services/token.service.js';
import { isRedisReady } from '../../config/redis.js';
import { writeAuditLog } from '../../services/audit.service.js';
import { publishEvent } from '../../events/eventBus.js';

const BCRYPT_ROUNDS = 12;
const OTP_PREFIX = 'otp:';

export async function login({ email, password }, ip, userAgent) {
  const { isAccountLocked, recordLoginAttempt, assertIpWhitelist, detectSuspiciousLogin, createUserSession } =
    await import('../../security/securityPolicies.js');

  if (await isAccountLocked(email)) {
    throw new AppError('Account temporarily locked due to failed login attempts', 429);
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { institute: true },
  });

  if (!user || !user.isActive) {
    await recordLoginAttempt(email, ip, false, 'INVALID_CREDENTIALS');
    throw new AppError('Invalid email or password', 401);
  }

  if (user.instituteId) {
    await assertIpWhitelist(user.instituteId, ip);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordLoginAttempt(email, ip, false, 'INVALID_PASSWORD');
    throw new AppError('Invalid email or password', 401);
  }

  await recordLoginAttempt(email, ip, true);

  const portalRoute = getPortalRouteForRole(user.role);
  if (portalRoute === '/login') {
    throw new AppError('Your account does not have portal access', 403);
  }

  let accessResult;
  try {
    accessResult = assertLoginAccess(user);
  } catch (err) {
    throw new AppError(err.message, err.statusCode || 403);
  }

  const tokenPayload = {
    userId: user.id,
    role: user.role,
    instituteId: user.instituteId,
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken({ userId: user.id });
  await storeRefreshToken(user.id, refreshToken);

  await createUserSession(user.id, {
    ipAddress: ip,
    userAgent,
    deviceType: 'web',
  });

  const suspicious = await detectSuspiciousLogin(user.id, ip, userAgent);
  if (suspicious) {
    await publishEvent({
      eventType: 'security.login.suspicious',
      aggregateType: 'User',
      aggregateId: user.id,
      instituteId: user.instituteId,
      payload: { email: user.email, ip, userAgent },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip },
  });

  await prisma.loginHistory.create({
    data: {
      userId: user.id,
      instituteId: user.instituteId,
      ipAddress: ip,
      userAgent,
      success: true,
    },
  });

  const subscriptionExpired = accessResult.subscriptionExpired ?? false;
  const instituteStatus = user.institute
    ? (isSubscriptionExpired(user.institute) && user.institute.status === 'ACTIVE'
        ? 'EXPIRED'
        : user.institute.status)
    : null;

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      instituteId: user.instituteId,
      mustChangePass: user.mustChangePass,
      modules: user.institute?.activeModules ?? [],
      instituteName: user.institute?.name ?? null,
      instituteStatus,
      subscriptionExpiry: user.institute?.expiryDate ?? null,
      subscriptionExpired,
      portalRoute,
    },
  };
}

export async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const stored = await getStoredRefreshToken(payload.userId);
  if (!isRefreshTokenValid(stored, refreshToken)) {
    throw new AppError('Refresh token revoked', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { institute: true },
  });

  if (!user || !user.isActive) throw new AppError('User not found', 401);

  if (user.role !== 'SUPER_ADMIN' && user.institute) {
    try {
      assertLoginAccess(user);
    } catch (err) {
      throw new AppError(err.message, err.statusCode || 403);
    }
  }

  await revokeRefreshToken(user.id);

  const tokenPayload = {
    userId: user.id,
    role: user.role,
    instituteId: user.instituteId,
  };

  const newAccessToken = signAccessToken(tokenPayload);
  const newRefreshToken = signRefreshToken({ userId: user.id });
  await storeRefreshToken(user.id, newRefreshToken);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export async function logout(userId, accessJti, accessExp) {
  await revokeAllUserTokens(userId);
  if (accessJti && accessExp) await denylistToken(accessJti, accessExp);
}

export async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { institute: { include: { plan: true } } },
  });

  if (!user) throw new AppError('User not found', 404);

  const expired = user.institute ? isSubscriptionExpired(user.institute) : false;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    instituteId: user.instituteId,
    mustChangePass: user.mustChangePass,
    modules: user.institute?.activeModules ?? [],
    instituteStatus: user.institute
      ? (expired && user.institute.status === 'ACTIVE' ? 'EXPIRED' : user.institute.status)
      : null,
    subscriptionExpired: expired && user.role === 'INSTITUTE_ADMIN',
    subscriptionExpiry: user.institute?.expiryDate ?? null,
    portalRoute: getPortalRouteForRole(user.role),
    instituteName: user.institute?.name ?? null,
    institute: user.institute
      ? {
          id: user.institute.id,
          name: user.institute.name,
          code: user.institute.instituteCode,
          status: user.institute.status,
          expiryDate: user.institute.expiryDate,
          plan: user.institute.plan?.name,
        }
      : null,
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const { assertPasswordPolicy, savePasswordHistory } = await import('../../security/securityPolicies.js');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError('Current password is incorrect', 400);

  await assertPasswordPolicy(userId, newPassword);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePass: false },
  });
  await savePasswordHistory(userId, passwordHash);

  await revokeAllUserTokens(userId);
}

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { message: 'If the email exists, an OTP has been sent' };

  const otp = String(Math.floor(100000 + Math.random() * 900000));

  if (isRedisReady()) {
    const { getRedis } = await import('../../config/redis.js');
    const redis = getRedis();
    await redis.setex(`${OTP_PREFIX}${email.toLowerCase()}`, 900, otp);
  } else if (process.env.NODE_ENV === 'development') {
    console.log(`OTP for ${email}: ${otp} (Redis disabled — OTP not persisted)`);
    return { message: 'If the email exists, an OTP has been sent', devOtp: otp };
  }

  return { message: 'If the email exists, an OTP has been sent' };
}

export async function resetPassword(email, otp, newPassword) {
  let stored = null;
  if (isRedisReady()) {
    const { getRedis } = await import('../../config/redis.js');
    const redis = getRedis();
    stored = await redis.get(`${OTP_PREFIX}${email.toLowerCase()}`);
  }

  if (!stored || stored !== otp) {
    throw new AppError('Invalid or expired OTP', 400);
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError('User not found', 404);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePass: false },
  });

  if (isRedisReady()) {
    const { getRedis } = await import('../../config/redis.js');
    await getRedis().del(`${OTP_PREFIX}${email.toLowerCase()}`);
  }
  await revokeAllUserTokens(user.id);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
