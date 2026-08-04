import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { sendCsv } from '../../../utils/csvExport.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const institutes = await prisma.institute.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        plan: { select: { name: true } },
        _count: { select: { students: true, teachers: true } },
        subscriptionInvoices: { where: { status: 'PAID' }, select: { amount: true } },
      },
    });

    const rows = institutes.map((inst) => ({
      name: inst.name,
      code: inst.instituteCode,
      plan: inst.plan?.name || '—',
      status: inst.status,
      students: inst._count.students,
      teachers: inst._count.teachers,
      revenue: inst.subscriptionInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0),
    }));

    const totals = {
      totalInstitutes: rows.length,
      totalStudents: rows.reduce((s, r) => s + r.students, 0),
      totalTeachers: rows.reduce((s, r) => s + r.teachers, 0),
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    };

    if (req.query.format === 'csv') {
      return sendCsv(res, 'platform-report.csv', [
        { key: 'name', label: 'Institute' }, { key: 'code', label: 'Code' },
        { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Status' },
        { key: 'students', label: 'Students' }, { key: 'teachers', label: 'Teachers' },
        { key: 'revenue', label: 'Revenue (PKR)' },
      ], rows);
    }

    return success(res, { rows, totals });
  } catch (err) {
    next(err);
  }
});

export default router;
