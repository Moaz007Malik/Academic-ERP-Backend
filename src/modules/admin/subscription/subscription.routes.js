import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { isSubscriptionExpired } from '../../../utils/instituteAccess.js';
import { summarizeModules } from '../../../utils/moduleCatalog.js';

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
      logo: institute.logo,
      email: institute.email,
      phone: institute.phone,
      address: institute.address,
      status: expired && institute.status === 'ACTIVE' ? 'EXPIRED' : institute.status,
      plan: institute.plan?.name ?? null,
      planId: institute.planId,
      expiryDate: institute.expiryDate,
      activeModules: institute.activeModules,
      moduleSummary: summarizeModules(institute.activeModules),
      storageQuotaMB: institute.storageQuotaMB,
      storageUsedMB: institute.storageUsedMB,
      createdAt: institute.createdAt,
      daysRemaining: institute.expiryDate
        ? Math.max(0, Math.ceil((new Date(institute.expiryDate) - new Date()) / 86400000))
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
