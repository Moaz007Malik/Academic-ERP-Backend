import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.PROFILE_SETTINGS));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const institute = await prisma.institute.findUnique({
      where: { id: req.user.instituteId },
      include: { plan: true },
    });
    if (!institute) throw new AppError('Institute not found', 404);
    return success(res, institute);
  } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, logo, address, phone, email, settings } = req.body;
    const institute = await prisma.institute.update({
      where: { id: instituteId },
      data: {
        ...(name !== undefined && { name }),
        ...(logo !== undefined && { logo }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(settings !== undefined && { settings }),
      },
      include: { plan: true },
    });
    return success(res, institute, 'Profile updated');
  } catch (err) { next(err); }
});

export default router;
