/**
 * Institute subscription & access control — enforced at login and on every API request.
 * Super Admin bypasses all checks.
 */

export function isSubscriptionExpired(institute) {
  if (!institute) return false;
  if (institute.status === 'EXPIRED') return true;
  if (institute.expiryDate && new Date(institute.expiryDate) < new Date()) return true;
  return false;
}

export function getInstituteAccessState(institute) {
  if (!institute) {
    return { blocked: false, suspended: false, expired: false, status: null };
  }

  const expired = isSubscriptionExpired(institute);
  return {
    blocked: institute.status === 'BLOCKED',
    suspended: institute.status === 'SUSPENDED',
    expired,
    status: expired && institute.status === 'ACTIVE' ? 'EXPIRED' : institute.status,
  };
}

export function assertLoginAccess(user) {
  if (user.role === 'SUPER_ADMIN') return { portalRoute: null, subscriptionExpired: false };

  if (!user.institute) {
    throw Object.assign(new Error('No institute linked to this account'), { statusCode: 403 });
  }

  const access = getInstituteAccessState(user.institute);

  if (access.blocked) {
    throw Object.assign(
      new Error('Institute account is blocked. Contact the Super Administrator.'),
      { statusCode: 403 }
    );
  }

  if (access.suspended) {
    throw Object.assign(
      new Error('Institute account is suspended. Contact the Super Administrator.'),
      { statusCode: 403 }
    );
  }

  if (access.expired && user.role !== 'INSTITUTE_ADMIN') {
    throw Object.assign(
      new Error('Subscription expired. Contact your institute administrator.'),
      { statusCode: 402 }
    );
  }

  return {
    subscriptionExpired: access.expired && user.role === 'INSTITUTE_ADMIN',
    instituteStatus: access.status,
  };
}

/** Paths institute admin may use when subscription is expired */
export const EXPIRED_ADMIN_PATHS = [
  '/auth/logout',
  '/auth/me',
  '/auth/change-password',
  '/admin/subscription',
  '/admin/tickets',
];

export function normalizeApiPath(path) {
  return path.replace(/^\/api\/v\d+/, '');
}

export function isExpiredAdminAllowedPath(path, method) {
  const normalized = normalizeApiPath(path);
  if (EXPIRED_ADMIN_PATHS.some((p) => normalized.startsWith(p))) return true;
  if (method === 'GET' && normalized.includes('/admin/subscription')) return true;
  if (method === 'POST' && normalized.startsWith('/admin/tickets')) return true;
  return false;
}

export function assertRequestAccess(user, path, method) {
  if (user.role === 'SUPER_ADMIN') return { subscriptionExpired: false };

  const access = getInstituteAccessState({
    status: user.instituteStatus,
    expiryDate: user.subscriptionExpiry,
  });

  if (access.blocked) {
    throw Object.assign(new Error('Institute account is blocked.'), { statusCode: 403 });
  }

  if (access.suspended) {
    throw Object.assign(new Error('Institute account is suspended.'), { statusCode: 403 });
  }

  if (!access.expired) return { subscriptionExpired: false };

  if (user.role === 'INSTITUTE_ADMIN' && isExpiredAdminAllowedPath(path, method)) {
    return { subscriptionExpired: true };
  }

  if (user.role === 'INSTITUTE_ADMIN') {
    return { subscriptionExpired: true };
  }

  throw Object.assign(
    new Error('Subscription expired. Contact your institute administrator.'),
    { statusCode: 402 }
  );
}
