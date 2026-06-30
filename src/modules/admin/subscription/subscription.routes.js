import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { isSubscriptionExpired } from '../../../utils/instituteAccess.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const institute = await prisma.institute.findUnique({
      where: { id: req.user.instituteId },
      include: { plan: true },
    });

    if (!institute) {
      return res.status(404).json({ success: false, message: 'Institute not found' });
    }

    const expired = isSubscriptionExpired(institute);

    return success(res, {
      id: institute.id,
      name: institute.name,
      code: institute.instituteCode,
      status: expired && institute.status === 'ACTIVE' ? 'EXPIRED' : institute.status,
      plan: institute.plan?.name ?? null,
      expiryDate: institute.expiryDate,
      activeModules: institute.activeModules,
      storageQuotaMB: institute.storageQuotaMB,
      storageUsedMB: institute.storageUsedMB,
      daysRemaining: institute.expiryDate
        ? Math.max(0, Math.ceil((new Date(institute.expiryDate) - new Date()) / 86400000))
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
