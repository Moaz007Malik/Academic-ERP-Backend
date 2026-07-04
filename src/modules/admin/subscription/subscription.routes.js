import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { isSubscriptionExpired } from '../../../utils/instituteAccess.js';
import { summarizeModules } from '../../../utils/moduleCatalog.js';
import { getInstituteSubscriptionSummary } from '../../../services/subscription.service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const summary = await getInstituteSubscriptionSummary(req.user.instituteId);
    if (!summary) {
      return res.status(404).json({ success: false, message: 'Institute not found' });
    }

    const { institute, plan, pendingInvoice, recentInvoices, warning, daysRemaining } = summary;
    const expired = isSubscriptionExpired(institute);

    return success(res, {
      id: institute.id,
      name: institute.name,
      code: institute.instituteCode,
      logo: institute.logo,
      email: institute.email,
      phone: institute.phone,
      address: institute.address,
      status: expired && institute.status === 'ACTIVE' ? 'EXPIRED' : institute.status,
      plan: plan?.name ?? null,
      planId: institute.planId,
      billingCycle: plan?.billingCycle ?? null,
      expiryDate: institute.expiryDate,
      activeModules: institute.activeModules,
      moduleSummary: summarizeModules(institute.activeModules),
      storageQuotaMB: institute.storageQuotaMB,
      storageUsedMB: institute.storageUsedMB,
      createdAt: institute.createdAt,
      daysRemaining,
      pendingInvoice,
      recentInvoices,
      warning,
      warningMessage: buildWarningMessage(warning, pendingInvoice),
      dueAmount: pendingInvoice?.status === 'PENDING' ? Number(pendingInvoice.amount) : 0,
    });
  } catch (err) {
    next(err);
  }
});

function buildWarningMessage(warning, invoice) {
  if (!warning || !invoice) return null;
  const amt = Number(invoice.amount || 0).toLocaleString();
  const map = {
    DUE_3_DAYS: `Payment of ${amt} PKR due in 3 days`,
    DUE_2_DAYS: `Payment of ${amt} PKR due in 2 days`,
    DUE_1_DAY: `Payment of ${amt} PKR due tomorrow`,
    DUE_TODAY: `Payment of ${amt} PKR due today`,
    OVERDUE_GRACE: `Payment overdue — institute will be blocked if not paid within grace period`,
    OVERDUE_BLOCKED: `Payment overdue — institute blocked`,
    PENDING: `Invoice pending: ${amt} PKR`,
  };
  return map[warning] || null;
}

export default router;
