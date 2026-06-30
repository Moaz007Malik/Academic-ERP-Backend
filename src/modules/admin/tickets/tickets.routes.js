import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId: req.user.instituteId };

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
          replies: { orderBy: { createdAt: 'asc' }, take: 5 },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return paginated(res, tickets, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { subject, category, description, priority } = req.body;
    if (!subject || !category || !description) {
      throw new AppError('subject, category, and description are required', 400);
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        instituteId: req.user.instituteId,
        createdById: req.user.id,
        subject,
        category,
        description,
        priority: priority || 'MEDIUM',
      },
    });

    return success(res, ticket, 'Ticket submitted', 201);
  } catch (err) {
    next(err);
  }
});

export default router;
