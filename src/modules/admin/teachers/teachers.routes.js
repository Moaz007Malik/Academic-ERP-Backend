import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { createPortalUser, generateEmployeeCode } from '../../../utils/portalUser.js';
import { getTeacherProfile } from '../../../services/profile.service.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.TEACHER_MANAGEMENT));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { firstName: { contains: req.query.search, mode: 'insensitive' } },
        { lastName: { contains: req.query.search, mode: 'insensitive' } },
        { employeeCode: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }

    const [teachers, total] = await Promise.all([
      prisma.teacher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true, portalPassword: true } },
          assignments: { include: { subject: true, section: { include: { batch: true } } } },
        },
      }),
      prisma.teacher.count({ where }),
    ]);
    return paginated(res, teachers, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id/profile', async (req, res, next) => {
  try {
    const profile = await getTeacherProfile(req.params.id, req.user.instituteId);
    if (!profile) throw new AppError('Teacher not found', 404);
    return success(res, profile);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: {
        user: { select: { email: true } },
        assignments: { include: { subject: true, section: { include: { batch: true } } } },
      },
    });
    if (!teacher) throw new AppError('Teacher not found', 404);
    return success(res, teacher);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      firstName, lastName, email, password, employeeCode,
      qualification, specialization, joiningDate, salary, createPortalAccount,
    } = req.body;
    if (!firstName || !lastName) throw new AppError('First and last name are required', 400);

    const instituteId = req.user.instituteId;
    const count = await prisma.teacher.count({ where: { instituteId } });
    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    const prefix = institute?.instituteCode?.slice(0, 3) || 'TCH';
    const finalCode = employeeCode || generateEmployeeCode(prefix, count + 1);

    if (employeeCode) {
      const dup = await prisma.teacher.findFirst({ where: { instituteId, employeeCode: finalCode } });
      if (dup) throw new AppError('A teacher with this employee code already exists', 409);
    }

    const teacher = await prisma.$transaction(async (tx) => {
      let userId = null;
      if (createPortalAccount !== false && email) {
        const existing = await tx.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existing) throw new AppError('Email already in use', 409);
        const user = await createPortalUser(tx, {
          email, password: password || 'Teacher@123', role: 'TEACHER',
          instituteId, firstName, lastName,
        });
        userId = user.id;
      }
      return tx.teacher.create({
        data: {
          instituteId, userId, firstName, lastName, employeeCode: finalCode,
          qualification: qualification || null, specialization: specialization || null,
          joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
          salary: salary != null ? salary : null,
          status: 'ACTIVE',
        },
        include: { user: { select: { email: true, portalPassword: true } } },
      });
    });
    const portalCreds = teacher.user
      ? { email: teacher.user.email, password: password || 'Teacher@123' }
      : null;
    return success(res, { teacher, portalCredentials: portalCreds }, 'Teacher created', 201);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.teacher.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Teacher not found', 404);

    const { firstName, lastName, employeeCode, qualification, specialization, joiningDate, salary, status } = req.body;

    if (employeeCode && employeeCode !== existing.employeeCode) {
      const dup = await prisma.teacher.findFirst({
        where: { instituteId: req.user.instituteId, employeeCode, NOT: { id: req.params.id } },
      });
      if (dup) throw new AppError('A teacher with this employee code already exists', 409);
    }

    const teacher = await prisma.teacher.update({
      where: { id: req.params.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(employeeCode !== undefined && { employeeCode }),
        ...(qualification !== undefined && { qualification }),
        ...(specialization !== undefined && { specialization }),
        ...(joiningDate !== undefined && { joiningDate: joiningDate ? new Date(joiningDate) : null }),
        ...(salary !== undefined && { salary }),
        ...(status !== undefined && { status }),
      },
      include: { assignments: { include: { subject: true, section: true } } },
    });
    return success(res, teacher, 'Teacher updated');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const teacher = await prisma.teacher.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!teacher) throw new AppError('Teacher not found', 404);

    await prisma.$transaction(async (tx) => {
      await tx.teacherAssignment.deleteMany({ where: { teacherId: teacher.id } });
      await tx.timetable.updateMany({ where: { teacherId: teacher.id }, data: { teacherId: null } });
      await tx.teacher.delete({ where: { id: teacher.id } });
      if (teacher.userId) {
        await tx.user.delete({ where: { id: teacher.userId } }).catch(() => {});
      }
    });

    return success(res, null, 'Teacher deleted');
  } catch (err) { next(err); }
});

router.post('/:id/assignments', async (req, res, next) => {
  try {
    const { subjectId, sectionId } = req.body;
    if (!subjectId || !sectionId) throw new AppError('Subject and section are required', 400);

    const teacher = await prisma.teacher.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!teacher) throw new AppError('Teacher not found', 404);

    const assignment = await prisma.teacherAssignment.create({
      data: {
        instituteId: req.user.instituteId,
        teacherId: teacher.id,
        subjectId,
        sectionId,
      },
      include: { subject: true, section: { include: { batch: true } } },
    });
    return success(res, assignment, 'Assignment created', 201);
  } catch (err) {
    if (err.code === 'P2002') return next(new AppError('Teacher already assigned to this subject/section', 409));
    next(err);
  }
});

router.delete('/assignments/:assignmentId', async (req, res, next) => {
  try {
    const assignment = await prisma.teacherAssignment.findFirst({
      where: { id: req.params.assignmentId, instituteId: req.user.instituteId },
    });
    if (!assignment) throw new AppError('Assignment not found', 404);
    await prisma.teacherAssignment.delete({ where: { id: assignment.id } });
    return success(res, null, 'Assignment removed');
  } catch (err) { next(err); }
});

export default router;
