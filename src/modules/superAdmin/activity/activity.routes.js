import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.instituteId) where.instituteId = req.query.instituteId;
    if (req.query.entity) where.entity = req.query.entity;
    if (req.query.search) {
      where.OR = [
        { action: { contains: req.query.search, mode: 'insensitive' } },
        { entity: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          institute: { select: { id: true, name: true, instituteCode: true } },
          user: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginated(res, logs, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

export default router;
