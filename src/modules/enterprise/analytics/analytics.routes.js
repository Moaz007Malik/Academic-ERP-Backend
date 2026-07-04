import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { getAnalyticsDashboard } from '../../../analytics/analyticsEngine.js';
import { prisma } from '../../../config/database.js';

const router = Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await getAnalyticsDashboard(req.user.instituteId);
    return success(res, data);
  } catch (err) { next(err); }
});

router.get('/snapshots', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.metricKey) where.metricKey = req.query.metricKey;
    const snapshots = await prisma.analyticsSnapshot.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: 50,
    });
    return success(res, snapshots);
  } catch (err) { next(err); }
});

export default router;
