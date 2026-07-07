import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { escalatedToSuperAdmin: true };
    if (req.query.status) where.status = req.query.status;

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          institute: { select: { id: true, name: true, instituteCode: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          replies: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { repliedBy: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return paginated(res, tickets, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/close', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status: 'RESOLVED', closedAt: new Date() },
    });
    return success(res, ticket, 'Ticket closed');
  } catch (err) {
    if (err.code === 'P2025') return next(new AppError('Ticket not found', 404));
    next(err);
  }
});

export default router;
