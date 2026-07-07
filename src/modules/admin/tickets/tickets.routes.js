import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { AppError } from '../../../utils/AppError.js';
import { shouldAutoEscalateTicket } from '../../../utils/ticketHelpers.js';

const ticketInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
  escalatedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
};

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
          ...ticketInclude,
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

    const autoEscalate = shouldAutoEscalateTicket(category, req.user.role);

    const ticket = await prisma.supportTicket.create({
      data: {
        instituteId: req.user.instituteId,
        createdById: req.user.id,
        subject,
        category,
        description,
        priority: priority || 'MEDIUM',
        escalatedToSuperAdmin: autoEscalate,
        ...(autoEscalate && { escalatedAt: new Date(), escalatedById: req.user.id }),
      },
      include: ticketInclude,
    });

    return success(res, ticket, autoEscalate ? 'Ticket sent to Super Admin' : 'Ticket submitted', 201);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: {
        ...ticketInclude,
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

router.post('/:id/escalate', async (req, res, next) => {
  try {
    const { message } = req.body;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (ticket.escalatedToSuperAdmin) throw new AppError('Ticket already forwarded to Super Admin', 400);
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new AppError('Cannot escalate a closed ticket', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          escalatedToSuperAdmin: true,
          escalatedAt: new Date(),
          escalatedById: req.user.id,
          status: 'IN_PROGRESS',
        },
        include: ticketInclude,
      });
      if (message?.trim()) {
        await tx.ticketReply.create({
          data: {
            ticketId: ticket.id,
            repliedById: req.user.id,
            message: `[Forwarded to Super Admin] ${message.trim()}`,
            attachments: [],
          },
        });
      }
      return t;
    });

    return success(res, updated, 'Ticket forwarded to Super Admin');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) throw new AppError('status is required', 400);

    const existing = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Ticket not found', 404);
    if (existing.escalatedToSuperAdmin && status === 'RESOLVED') {
      throw new AppError('This ticket was forwarded to Super Admin — they will resolve it', 400);
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(status === 'RESOLVED' || status === 'CLOSED' ? { closedAt: new Date() } : {}),
      },
      include: ticketInclude,
    });
    return success(res, ticket, 'Status updated');
  } catch (err) {
    next(err);
  }
});

export default router;
