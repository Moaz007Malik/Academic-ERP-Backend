import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.TICKETS));

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

router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { repliedBy: { select: { id: true, firstName: true, lastName: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    return success(res, ticket);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reply', async (req, res, next) => {
  try {
    const { message, attachments, status } = req.body;
    if (!message?.trim()) throw new AppError('message is required', 400);

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!ticket) throw new AppError('Ticket not found', 404);

    const reply = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketReply.create({
        data: {
          ticketId: ticket.id,
          repliedById: req.user.id,
          message: message.trim(),
          attachments: attachments || [],
        },
        include: { repliedBy: { select: { firstName: true, lastName: true, role: true } } },
      });
      if (status) {
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status,
            ...(status === 'RESOLVED' || status === 'CLOSED' ? { closedAt: new Date() } : {}),
          },
        });
      }
      return created;
    });

    return success(res, reply, 'Reply added', 201);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) throw new AppError('status is required', 400);
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(status === 'RESOLVED' || status === 'CLOSED' ? { closedAt: new Date() } : {}),
      },
    });
    return success(res, ticket, 'Status updated');
  } catch (err) {
    next(err);
  }
});

export default router;
