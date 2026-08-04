import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';

const router = Router();

router.put('/', async (req, res, next) => {
  try {
    const { firstName, lastName } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    return success(res, user, 'Profile updated');
  } catch (err) {
    next(err);
  }
});

export default router;
