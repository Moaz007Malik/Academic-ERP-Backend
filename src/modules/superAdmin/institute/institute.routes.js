import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { hashPassword } from '../../auth/auth.service.js';
import { CORE_MODULES } from '../../../utils/constants.js';
import { MODULE_CATALOG, summarizeModules, ALL_MODULE_KEYS } from '../../../utils/moduleCatalog.js';
import { generateTempPassword } from '../../../utils/portalUser.js';
import { AppError } from '../../../utils/AppError.js';

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

    const [institutes, total] = await Promise.all([
      prisma.institute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }),
      prisma.institute.count({ where }),
    ]);

    return paginated(res, institutes, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const institute = await prisma.institute.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        plan: true,
        subscriptionInvoices: { take: 10, orderBy: { issuedAt: 'desc' } },
        users: {
          where: { role: 'INSTITUTE_ADMIN', isActive: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            portalPassword: true,
            mustChangePass: true,
            lastLoginAt: true,
          },
        },
        _count: { select: { students: true, teachers: true, users: true } },
      },
    });
    if (!institute) throw new AppError('Institute not found', 404);
    const moduleSummary = summarizeModules(institute.activeModules);
    const adminUser = institute.users?.[0] || null;
    const { users, ...rest } = institute;
    return success(res, {
      ...rest,
      moduleSummary,
      adminUser,
      adminCredentials: adminUser
        ? { email: adminUser.email, password: adminUser.portalPassword }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      name, instituteCode, planId, adminEmail, adminFirstName, adminLastName,
      activeModules, storageQuotaMB, expiryDate,
    } = req.body;

    if (!name || !instituteCode || !adminEmail) {
      throw new AppError('name, instituteCode, and adminEmail are required', 400);
    }

    const existing = await prisma.institute.findUnique({ where: { instituteCode } });
    if (existing) throw new AppError('Institute code already exists', 409);

    const tempPassword = `Temp@${Math.random().toString(36).slice(2, 10)}`;
    const passwordHash = await hashPassword(tempPassword);

    const plan = planId
      ? await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
      : null;

    const modulesFromPlan = plan?.allowedModules?.length ? plan.allowedModules : CORE_MODULES;
    const resolvedModules = activeModules?.length ? activeModules : modulesFromPlan;

    const institute = await prisma.$transaction(async (tx) => {
      const inst = await tx.institute.create({
        data: {
          name,
          instituteCode,
          planId: planId || null,
          activeModules: resolvedModules,
          storageQuotaMB: storageQuotaMB || 5120,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          email: adminEmail,
        },
      });

      await tx.user.create({
        data: {
          email: adminEmail.toLowerCase(),
          passwordHash,
          portalPassword: tempPassword,
          firstName: adminFirstName || 'Admin',
          lastName: adminLastName || '',
          role: 'INSTITUTE_ADMIN',
          instituteId: inst.id,
          mustChangePass: true,
        },
      });

      return inst;
    });

    return success(res, {
      institute,
      adminCredentials: { email: adminEmail, tempPassword },
    }, 'Institute created', 201);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/suspend', async (req, res, next) => {
  try {
    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: { status: 'SUSPENDED' },
    });
    return success(res, institute, 'Institute suspended');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activate', async (req, res, next) => {
  try {
    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' },
    });
    return success(res, institute, 'Institute activated');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/block', async (req, res, next) => {
  try {
    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: { status: 'BLOCKED' },
    });
    return success(res, institute, 'Institute blocked');
  } catch (err) {
    next(err);
  }
});

router.put('/:id/renew', async (req, res, next) => {
  try {
    const { expiryDate, planId, activeModules, storageQuotaMB, paymentRef, notes } = req.body;
    if (!expiryDate) throw new AppError('expiryDate is required', 400);

    const plan = planId
      ? await prisma.subscriptionPlan.findUnique({ where: { id: planId } })
      : null;

    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: {
        status: 'ACTIVE',
        expiryDate: new Date(expiryDate),
        ...(planId && { planId }),
        ...(activeModules && { activeModules }),
        ...(storageQuotaMB && { storageQuotaMB }),
      },
      include: { plan: true },
    });

    if (planId) {
      await prisma.subscriptionInvoice.create({
        data: {
          invoiceNumber: `INV-${Date.now()}`,
          instituteId: institute.id,
          planId,
          type: 'RENEWAL',
          amount: plan?.price ?? 0,
          status: 'PAID',
          paidAt: new Date(),
          paymentRef: paymentRef || null,
          periodFrom: new Date(),
          periodTo: new Date(expiryDate),
          notes: notes || null,
          createdById: req.user.id,
        },
      });
    }

    return success(res, institute, 'Subscription renewed — institute access restored');
  } catch (err) {
    next(err);
  }
});

router.put('/:id/modules', async (req, res, next) => {
  try {
    const { activeModules } = req.body;
    if (!Array.isArray(activeModules)) {
      throw new AppError('activeModules array is required', 400);
    }
    const invalid = activeModules.filter((m) => !ALL_MODULE_KEYS.includes(m));
    if (invalid.length) throw new AppError(`Unknown modules: ${invalid.join(', ')}`, 400);

    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: { activeModules },
      include: { plan: true },
    });
    return success(res, { ...institute, moduleSummary: summarizeModules(institute.activeModules) }, 'Modules updated');
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, planId, activeModules, storageQuotaMB, expiryDate, status, email, phone, address } = req.body;
    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(planId && { planId }),
        ...(activeModules && { activeModules }),
        ...(storageQuotaMB && { storageQuotaMB }),
        ...(expiryDate && { expiryDate: new Date(expiryDate) }),
        ...(status && { status }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
      },
      include: { plan: true },
    });
    return success(res, institute, 'Institute updated');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-admin-password', async (req, res, next) => {
  try {
    const admin = await prisma.user.findFirst({
      where: {
        instituteId: req.params.id,
        role: 'INSTITUTE_ADMIN',
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new AppError('Institute admin account not found', 404);

    const newPassword = req.body.password?.trim() || generateTempPassword();
    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        portalPassword: newPassword,
        mustChangePass: true,
      },
    });

    return success(res, {
      email: admin.email,
      password: newPassword,
      name: `${admin.firstName || ''} ${admin.lastName || ''}`.trim(),
    }, 'Institute admin password reset');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), status: 'SUSPENDED' },
    });
    return success(res, institute, 'Institute soft-deleted');
  } catch (err) {
    next(err);
  }
});

export default router;
