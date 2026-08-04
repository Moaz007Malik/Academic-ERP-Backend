import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.role) where.role = req.query.role;
    if (req.query.search) {
      where.OR = [
        { firstName: { contains: req.query.search, mode: 'insensitive' } },
        { lastName: { contains: req.query.search, mode: 'insensitive' } },
        { email: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, firstName: true, lastName: true, role: true,
          isActive: true, lastLoginAt: true, createdAt: true,
          institute: { select: { id: true, name: true, instituteCode: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return paginated(res, users, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/toggle-active', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError('User not found', 404);
    if (user.role === 'SUPER_ADMIN') throw new AppError('Cannot deactivate a super admin account', 400);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: !user.isActive },
    });
    return success(res, updated, updated.isActive ? 'User activated' : 'User deactivated');
  } catch (err) {
    next(err);
  }
});

export default router;
