import { AppError } from '../utils/AppError.js';
import { assertRequestAccess } from '../utils/instituteAccess.js';

export function subscriptionGuard(req, res, next) {
  if (!req.user) return next();

  try {
    const result = assertRequestAccess(req.user, req.path, req.method);
    if (result.subscriptionExpired) {
      req.subscriptionExpired = true;
    }
    next();
  } catch (err) {
    next(new AppError(err.message, err.statusCode || 403));
  }
}

export function blockExpiredModuleAccess(req, res, next) {
  if (req.subscriptionExpired) {
    return next(new AppError('Subscription expired. Please renew to access this module.', 402));
  }
  next();
}
