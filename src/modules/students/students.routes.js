import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { success, paginated } from '../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { requirePermission } from '../../middleware/rbac.js';
import { requireModule } from '../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../middleware/subscriptionGuard.js';
import { createPortalUser, generateRollNumber } from '../../utils/portalUser.js';
import { AppError } from '../../utils/AppError.js';

const router = Router();

router.use(requireModule(MODULE_KEYS.STUDENT_MANAGEMENT));
router.use(blockExpiredModuleAccess);

router.get('/', requirePermission('MANAGE_STUDENTS'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId: req.user.instituteId };

    if (req.query.status) where.status = req.query.status;
    if (req.query.batchId) where.currentBatchId = req.query.batchId;
    if (req.query.sectionId) where.currentSectionId = req.query.sectionId;
    if (req.query.search) {
      where.OR = [
        { firstName: { contains: req.query.search, mode: 'insensitive' } },
        { lastName: { contains: req.query.search, mode: 'insensitive' } },
        { rollNumber: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          currentBatch: true,
          currentSection: true,
          user: { select: { email: true, id: true, portalPassword: true } },
        },
      }),
      prisma.student.count({ where }),
    ]);

    return paginated(res, students, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('MANAGE_STUDENTS'), async (req, res, next) => {
  try {
    const student = await prisma.student.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: {
        currentBatch: true,
        currentSection: true,
        user: { select: { email: true, id: true, portalPassword: true } },
      },
    });
    if (!student) throw new AppError('Student not found', 404);
    return success(res, student);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('MANAGE_STUDENTS'), async (req, res, next) => {
  try {
    const {
      firstName, lastName, email, password, rollNumber,
      dateOfBirth, gender, cnic, phone, address,
      guardianName, guardianPhone, currentBatchId, currentSectionId,
      createPortalAccount,
    } = req.body;

    if (!firstName || !lastName) throw new AppError('First and last name are required', 400);

    const instituteId = req.user.instituteId;
    const count = await prisma.student.count({ where: { instituteId } });
    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    const prefix = institute?.instituteCode?.slice(0, 3) || 'STU';
    const finalRoll = rollNumber || generateRollNumber(prefix, count + 1);

    if (rollNumber) {
      const dup = await prisma.student.findFirst({ where: { instituteId, rollNumber: finalRoll } });
      if (dup) throw new AppError('A student with this roll number already exists', 409);
    }

    const student = await prisma.$transaction(async (tx) => {
      let userId = null;
      if (createPortalAccount !== false && email) {
        const existing = await tx.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existing) throw new AppError('Email already in use', 409);
        const user = await createPortalUser(tx, {
          email,
          password: password || 'Student@123',
          role: 'STUDENT',
          instituteId,
          firstName,
          lastName,
        });
        userId = user.id;
      }

      return tx.student.create({
        data: {
          instituteId,
          userId,
          firstName,
          lastName,
          rollNumber: finalRoll,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          gender: gender || null,
          cnic: cnic || null,
          phone: phone || null,
          address: address || null,
          guardianName: guardianName || null,
          guardianPhone: guardianPhone || null,
          currentBatchId: currentBatchId || null,
          currentSectionId: currentSectionId || null,
          enrollmentDate: new Date(),
          status: 'ACTIVE',
        },
        include: { currentBatch: true, currentSection: true, user: { select: { email: true, portalPassword: true } } },
      });
    });

    const portalCreds = student.user
      ? { email: student.user.email, password: password || 'Student@123' }
      : null;

    return success(res, { student, portalCredentials: portalCreds }, 'Student created', 201);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('MANAGE_STUDENTS'), async (req, res, next) => {
  try {
    const existing = await prisma.student.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Student not found', 404);

    const {
      firstName, lastName, rollNumber, dateOfBirth, gender, cnic, phone, address,
      guardianName, guardianPhone, currentBatchId, currentSectionId, status,
    } = req.body;

    if (rollNumber && rollNumber !== existing.rollNumber) {
      const dup = await prisma.student.findFirst({
        where: { instituteId: req.user.instituteId, rollNumber, NOT: { id: req.params.id } },
      });
      if (dup) throw new AppError('A student with this roll number already exists', 409);
    }

    const student = await prisma.student.update({
      where: { id: req.params.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(rollNumber !== undefined && { rollNumber }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(gender !== undefined && { gender }),
        ...(cnic !== undefined && { cnic }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(guardianName !== undefined && { guardianName }),
        ...(guardianPhone !== undefined && { guardianPhone }),
        ...(currentBatchId !== undefined && { currentBatchId: currentBatchId || null }),
        ...(currentSectionId !== undefined && { currentSectionId: currentSectionId || null }),
        ...(status !== undefined && { status }),
      },
      include: { currentBatch: true, currentSection: true, user: { select: { email: true, portalPassword: true } } },
    });

    return success(res, student, 'Student updated');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('MANAGE_STUDENTS'), async (req, res, next) => {
  try {
    const student = await prisma.student.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!student) throw new AppError('Student not found', 404);

    await prisma.$transaction(async (tx) => {
      await tx.attendance.deleteMany({ where: { studentId: student.id } });
      await tx.result.deleteMany({ where: { studentId: student.id } });
      await tx.fee.deleteMany({ where: { studentId: student.id } });
      await tx.student.delete({ where: { id: student.id } });
      if (student.userId) {
        await tx.user.delete({ where: { id: student.userId } }).catch(() => {});
      }
    });

    return success(res, null, 'Student deleted');
  } catch (err) {
    next(err);
  }
});

export default router;
