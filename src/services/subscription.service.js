/** Subscription lifecycle: invoices, due dates, auto-block */
import { prisma } from '../config/database.js';

export const PAYMENT_DUE_DAYS = 3;
export const GRACE_DAYS_AFTER_DUE = 3;

export function computeDueDate(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + PAYMENT_DUE_DAYS);
  return d;
}

export function computeGraceEndsAt(dueDate) {
  const d = new Date(dueDate);
  d.setDate(d.getDate() + GRACE_DAYS_AFTER_DUE);
  return d;
}

export async function createInitialSubscriptionInvoice(instituteId, planId, amount, createdById, periodTo) {
  const issuedAt = new Date();
  const dueDate = computeDueDate(issuedAt);
  const graceEndsAt = computeGraceEndsAt(dueDate);
  return prisma.subscriptionInvoice.create({
    data: {
      invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      instituteId,
      planId,
      type: 'INITIAL',
      amount,
      status: 'PENDING',
      issuedAt,
      dueDate,
      graceEndsAt,
      periodFrom: issuedAt,
      periodTo: periodTo ? new Date(periodTo) : null,
      createdById,
    },
  });
}

export async function createMonthlyRenewalInvoice(institute) {
  if (!institute.planId) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const existing = await prisma.subscriptionInvoice.findFirst({
    where: {
      instituteId: institute.id,
      type: 'RENEWAL',
      issuedAt: { gte: monthStart, lte: monthEnd },
      status: { in: ['PENDING', 'PAID'] },
    },
  });
  if (existing) return null;

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: institute.planId } });
  const issuedAt = new Date();
  const dueDate = computeDueDate(issuedAt);
  const graceEndsAt = computeGraceEndsAt(dueDate);

  return prisma.subscriptionInvoice.create({
    data: {
      invoiceNumber: `INV-R-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      instituteId: institute.id,
      planId: institute.planId,
      type: 'RENEWAL',
      amount: plan?.price ?? 0,
      status: 'PENDING',
      issuedAt,
      dueDate,
      graceEndsAt,
      periodFrom: monthStart,
      periodTo: monthEnd,
    },
  });
}

export async function processOverdueInvoices() {
  const now = new Date();
  const overdue = await prisma.subscriptionInvoice.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { graceEndsAt: { lt: now } },
        { graceEndsAt: null, dueDate: { lt: new Date(now.getTime() - GRACE_DAYS_AFTER_DUE * 86400000) } },
      ],
    },
    include: { institute: true },
  });

  let blocked = 0;
  for (const inv of overdue) {
    if (inv.institute.status === 'BLOCKED') continue;
    await prisma.institute.update({
      where: { id: inv.instituteId },
      data: { status: 'BLOCKED' },
    });
    blocked += 1;
  }
  return { blocked, checked: overdue.length };
}

export async function runSubscriptionBillingCycle() {
  const institutes = await prisma.institute.findMany({
    where: { deletedAt: null, status: { in: ['ACTIVE', 'EXPIRED'] }, planId: { not: null } },
  });

  let created = 0;
  for (const inst of institutes) {
    const inv = await createMonthlyRenewalInvoice(inst);
    if (inv) created += 1;
  }

  const blockResult = await processOverdueInvoices();
  return { invoicesCreated: created, ...blockResult };
}

export function getInvoiceWarningLevel(invoice) {
  if (!invoice || invoice.status === 'PAID') return null;
  const now = new Date();
  const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
  if (!due) return null;

  const msPerDay = 86400000;
  const daysUntilDue = Math.ceil((due - now) / msPerDay);

  if (daysUntilDue < 0) {
    const graceEnd = invoice.graceEndsAt ? new Date(invoice.graceEndsAt) : new Date(due.getTime() + GRACE_DAYS_AFTER_DUE * msPerDay);
    if (now > graceEnd) return 'OVERDUE_BLOCKED';
    return 'OVERDUE_GRACE';
  }
  if (daysUntilDue === 0) return 'DUE_TODAY';
  if (daysUntilDue === 1) return 'DUE_1_DAY';
  if (daysUntilDue === 2) return 'DUE_2_DAYS';
  if (daysUntilDue === 3) return 'DUE_3_DAYS';
  return 'PENDING';
}

export async function getInstituteSubscriptionSummary(instituteId) {
  const institute = await prisma.institute.findUnique({
    where: { id: instituteId },
    include: { plan: true },
  });
  if (!institute) return null;

  const pendingInvoice = await prisma.subscriptionInvoice.findFirst({
    where: { instituteId, status: 'PENDING' },
    orderBy: { issuedAt: 'desc' },
  });

  const recentInvoices = await prisma.subscriptionInvoice.findMany({
    where: { instituteId },
    orderBy: { issuedAt: 'desc' },
    take: 12,
    include: { plan: true },
  });

  const warning = getInvoiceWarningLevel(pendingInvoice);

  return {
    institute,
    plan: institute.plan,
    pendingInvoice,
    recentInvoices,
    warning,
    daysRemaining: institute.expiryDate
      ? Math.max(0, Math.ceil((new Date(institute.expiryDate) - new Date()) / 86400000))
      : null,
  };
}
