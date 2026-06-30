import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [
      totalInstitutes,
      activeInstitutes,
      expiredInstitutes,
      suspendedInstitutes,
      pendingInvoices,
      openTickets,
    ] = await Promise.all([
      prisma.institute.count({ where: { deletedAt: null } }),
      prisma.institute.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      prisma.institute.count({ where: { status: 'EXPIRED', deletedAt: null } }),
      prisma.institute.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
      prisma.subscriptionInvoice.count({ where: { status: 'PENDING' } }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiringSoon = await prisma.institute.count({
      where: {
        expiryDate: { lte: sevenDaysFromNow, gte: new Date() },
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    return success(res, {
      totalInstitutes,
      activeInstitutes,
      expiringSoon,
      expiredInstitutes,
      suspendedInstitutes,
      pendingInvoices,
      openTickets,
      totalStudents: await prisma.student.count(),
      totalTeachers: await prisma.teacher.count(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
