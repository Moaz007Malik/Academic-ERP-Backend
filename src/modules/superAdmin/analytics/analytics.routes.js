import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { MODULE_CATALOG } from '../../../utils/moduleCatalog.js';

const router = Router();

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }) });
  }
  return months;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

router.get('/', async (req, res, next) => {
  try {
    const months = lastNMonths(12);
    const since = new Date();
    since.setMonth(since.getMonth() - 11);
    since.setDate(1);

    const [institutes, paidInvoices] = await Promise.all([
      prisma.institute.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true, activeModules: true },
      }),
      prisma.subscriptionInvoice.findMany({
        where: { status: 'PAID', paidAt: { gte: since } },
        select: { paidAt: true, amount: true },
      }),
    ]);

    const growthByMonth = new Map(months.map((m) => [m.key, 0]));
    institutes.forEach((inst) => {
      const key = monthKey(inst.createdAt);
      if (growthByMonth.has(key)) growthByMonth.set(key, growthByMonth.get(key) + 1);
    });

    const revenueByMonth = new Map(months.map((m) => [m.key, 0]));
    paidInvoices.forEach((inv) => {
      const key = monthKey(inv.paidAt);
      if (revenueByMonth.has(key)) revenueByMonth.set(key, revenueByMonth.get(key) + Number(inv.amount));
    });

    const allInstitutes = await prisma.institute.findMany({
      where: { deletedAt: null },
      select: { activeModules: true },
    });
    const moduleCounts = new Map();
    allInstitutes.forEach((inst) => {
      (inst.activeModules || []).forEach((key) => {
        moduleCounts.set(key, (moduleCounts.get(key) || 0) + 1);
      });
    });
    const moduleAdoption = MODULE_CATALOG
      .map((m) => ({ key: m.key, label: m.label, count: moduleCounts.get(m.key) || 0 }))
      .filter((m) => m.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return success(res, {
      institutesGrowth: months.map((m) => ({ month: m.label, value: growthByMonth.get(m.key) })),
      revenueGrowth: months.map((m) => ({ month: m.label, value: revenueByMonth.get(m.key) })),
      moduleAdoption,
      totalInstitutesTracked: allInstitutes.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
