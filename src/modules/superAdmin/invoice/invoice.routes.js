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
    if (req.query.status) where.status = req.query.status;

    const [invoices, total] = await Promise.all([
      prisma.subscriptionInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issuedAt: 'desc' },
        include: {
          institute: { select: { id: true, name: true, instituteCode: true } },
          plan: { select: { id: true, name: true } },
        },
      }),
      prisma.subscriptionInvoice.count({ where }),
    ]);

    return paginated(res, invoices, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/mark-paid', async (req, res, next) => {
  try {
    const { paymentRef, notes } = req.body;
    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { id: req.params.id },
      include: { institute: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const [updated] = await prisma.$transaction([
      prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentRef: paymentRef || null,
          notes: notes || invoice.notes,
        },
      }),
      prisma.institute.update({
        where: { id: invoice.instituteId },
        data: {
          status: 'ACTIVE',
          expiryDate: invoice.periodTo || undefined,
          planId: invoice.planId,
        },
      }),
    ]);

    return success(res, updated, 'Invoice marked as paid — institute activated');
  } catch (err) {
    next(err);
  }
});

export default router;
