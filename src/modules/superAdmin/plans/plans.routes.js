import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
    return success(res, plans);
  } catch (err) {
    next(err);
  }
});

export default router;
