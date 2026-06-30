import { tenantContext } from '../config/database.js';

export function tenantMiddleware(req, res, next) {
  const bypassTenant = req.user?.role === 'SUPER_ADMIN';
  const instituteId = req.user?.instituteId ?? null;

  tenantContext.run({ instituteId, bypassTenant }, () => next());
}
