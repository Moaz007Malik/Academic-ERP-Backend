import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { isSubscriptionExpired } from '../../../utils/instituteAccess.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalStudents,
      totalTeachers,
      todayAttendance,
      feesCollected,
      outstandingFees,
      upcomingExams,
      institute,
      openTickets,
    ] = await Promise.all([
      prisma.student.count({ where: { instituteId, status: 'ACTIVE' } }),
      prisma.teacher.count({ where: { instituteId, status: 'ACTIVE' } }),
      prisma.attendance.count({
        where: { instituteId, date: { gte: today, lt: tomorrow }, status: 'PRESENT' },
      }),
      prisma.fee.aggregate({
        where: { instituteId, status: 'PAID', paidDate: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.fee.aggregate({
        where: { instituteId, status: { in: ['PENDING', 'PARTIAL'] } },
        _sum: { amount: true },
      }),
      prisma.exam.count({
        where: { instituteId, startDate: { gte: today, lte: new Date(Date.now() + 7 * 86400000) } },
      }),
      prisma.institute.findUnique({
        where: { id: instituteId },
        include: { plan: true },
      }),
      prisma.supportTicket.count({ where: { instituteId, status: 'OPEN' } }),
    ]);

    const expired = institute ? isSubscriptionExpired(institute) : false;

    return success(res, {
      totalStudents,
      totalTeachers,
      todayAttendance,
      feesCollectedMonth: Number(feesCollected._sum.amount || 0),
      outstandingFees: Number(outstandingFees._sum.amount || 0),
      upcomingExams,
      openTickets,
      subscription: institute
        ? {
            status: expired && institute.status === 'ACTIVE' ? 'EXPIRED' : institute.status,
            plan: institute.plan?.name,
            expiryDate: institute.expiryDate,
            daysRemaining: institute.expiryDate
              ? Math.max(0, Math.ceil((new Date(institute.expiryDate) - new Date()) / 86400000))
              : null,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
