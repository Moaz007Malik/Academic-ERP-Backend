import { PERMISSIONS } from '../utils/permissions.js';
import { AppError } from '../utils/AppError.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));

    const rolePermissions = PERMISSIONS[req.user.role] || [];
    if (!rolePermissions.includes(permission) && req.user.role !== 'SUPER_ADMIN') {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Access denied for this portal', 403));
    }
    next();
  };
}

export function requireSuperAdmin(req, res, next) {
  return requireRole('SUPER_ADMIN')(req, res, next);
}
