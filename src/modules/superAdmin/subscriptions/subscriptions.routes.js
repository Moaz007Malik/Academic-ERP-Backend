import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { deletedAt: null };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { instituteCode: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [institutes, total, summaryCounts] = await Promise.all([
      prisma.institute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expiryDate: 'asc' },
        include: { plan: { select: { id: true, name: true, price: true, billingCycle: true } } },
      }),
      prisma.institute.count({ where }),
      Promise.all([
        prisma.institute.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        prisma.institute.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
        prisma.institute.count({ where: { status: 'EXPIRED', deletedAt: null } }),
        prisma.institute.count({
          where: {
            status: 'ACTIVE', deletedAt: null,
            expiryDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) },
          },
        }),
      ]),
    ]);

    const now = Date.now();
    const rows = institutes.map((inst) => ({
      ...inst,
      daysLeft: inst.expiryDate ? Math.ceil((new Date(inst.expiryDate).getTime() - now) / 86400000) : null,
    }));

    const [active, suspended, expired, expiringSoon] = summaryCounts;

    return paginated(res, rows, {
      ...buildPaginationMeta(total, page, limit),
      summary: { active, suspended, expired, expiringSoon },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
