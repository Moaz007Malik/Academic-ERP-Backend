import { MODULE_KEYS } from '../utils/constants.js';
import { AppError } from '../utils/AppError.js';

export function requireModule(moduleKey) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));

    if (req.user.role === 'SUPER_ADMIN') return next();

    // Allow support tickets when subscription expired (renewal support path)
    if (
      moduleKey === MODULE_KEYS.TICKETS
      && req.subscriptionExpired
      && req.user.role === 'INSTITUTE_ADMIN'
    ) {
      return next();
    }

    const modules = req.user.activeModules || [];
    if (!modules.includes(moduleKey)) {
      return next(new AppError('Module not enabled for your subscription', 403));
    }
    next();
  };
}

export function requireAnyModule(...moduleKeys) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (req.user.role === 'SUPER_ADMIN') return next();

    const modules = req.user.activeModules || [];
    const hasAccess = moduleKeys.some((key) => modules.includes(key));
    if (!hasAccess) {
      return next(new AppError('Module not enabled for your subscription', 403));
    }
    next();
  };
}

export { MODULE_KEYS };
