import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { createPortalUser, generateRollNumber } from '../../../utils/portalUser.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.INDIVIDUAL_COURSES));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { code: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }
    const [courses, total] = await Promise.all([
      prisma.individualCourse.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          teachers: { include: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
          _count: { select: { enrollments: true } },
        },
      }),
      prisma.individualCourse.count({ where }),
    ]);
    return paginated(res, courses, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const course = await prisma.individualCourse.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: {
        teachers: { include: { teacher: true } },
        enrollments: {
          include: { student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } } },
          orderBy: { enrolledAt: 'desc' },
        },
      },
    });
    if (!course) throw new AppError('Course not found', 404);
    return success(res, course);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      name, code, duration, startDate, endDate, capacity, description, status,
      admissionFee, monthlyFee, oneTimeFee, discountAmount, scholarshipAmount, teacherIds = [],
    } = req.body;
    if (!name || !code) throw new AppError('Name and code are required', 400);

    const instituteId = req.user.instituteId;
    const dup = await prisma.individualCourse.findFirst({ where: { instituteId, code } });
    if (dup) throw new AppError('Course code already exists', 409);

    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.individualCourse.create({
        data: {
          instituteId, name, code, duration, description,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          capacity: capacity || 30,
          status: status || 'ACTIVE',
          admissionFee: admissionFee ?? 0,
          monthlyFee: monthlyFee ?? 0,
          oneTimeFee: oneTimeFee ?? 0,
          discountAmount: discountAmount ?? 0,
          scholarshipAmount: scholarshipAmount ?? 0,
        },
      });
      if (teacherIds.length) {
        await tx.individualCourseTeacher.createMany({
          data: teacherIds.map((teacherId) => ({ courseId: c.id, teacherId })),
        });
      }
      return c;
    });
    return success(res, course, 'Course created', 201);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.individualCourse.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Course not found', 404);

    const { teacherIds, ...data } = req.body;
    const course = await prisma.$transaction(async (tx) => {
      const updated = await tx.individualCourse.update({
        where: { id: req.params.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.duration !== undefined && { duration: data.duration }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
          ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
          ...(data.capacity !== undefined && { capacity: data.capacity }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.admissionFee !== undefined && { admissionFee: data.admissionFee }),
          ...(data.monthlyFee !== undefined && { monthlyFee: data.monthlyFee }),
          ...(data.oneTimeFee !== undefined && { oneTimeFee: data.oneTimeFee }),
          ...(data.discountAmount !== undefined && { discountAmount: data.discountAmount }),
          ...(data.scholarshipAmount !== undefined && { scholarshipAmount: data.scholarshipAmount }),
        },
      });
      if (teacherIds) {
        await tx.individualCourseTeacher.deleteMany({ where: { courseId: req.params.id } });
        if (teacherIds.length) {
          await tx.individualCourseTeacher.createMany({
            data: teacherIds.map((teacherId) => ({ courseId: req.params.id, teacherId })),
          });
        }
      }
      return updated;
    });
    return success(res, course, 'Course updated');
  } catch (err) { next(err); }
});

router.post('/:id/enroll', async (req, res, next) => {
  try {
    const course = await prisma.individualCourse.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);

    const { studentId, newStudent, notes } = req.body;
    const instituteId = req.user.instituteId;
    const totalFee = Number(course.admissionFee) + Number(course.oneTimeFee) + Number(course.monthlyFee)
      - Number(course.discountAmount) - Number(course.scholarshipAmount);

    const enrollment = await prisma.$transaction(async (tx) => {
      let sid = studentId;
      if (!sid && newStudent) {
        const { firstName, lastName, email, password, phone } = newStudent;
        if (!firstName || !lastName) throw new AppError('Student name required', 400);
        const count = await tx.student.count({ where: { instituteId } });
        const institute = await tx.institute.findUnique({ where: { id: instituteId } });
        const prefix = institute?.instituteCode?.slice(0, 3) || 'STU';
        let userId = null;
        if (email) {
          const user = await createPortalUser(tx, {
            email, password, role: 'STUDENT', instituteId, firstName, lastName,
          });
          userId = user.id;
        }
        const st = await tx.student.create({
          data: {
            instituteId, userId, firstName, lastName, phone: phone || null,
            rollNumber: generateRollNumber(prefix, count + 1),
            enrollmentDate: new Date(), status: 'ACTIVE',
          },
        });
        sid = st.id;
      }
      if (!sid) throw new AppError('Student or new student data required', 400);

      const dup = await tx.individualCourseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: sid } },
      });
      if (dup) throw new AppError('Student already enrolled', 409);

      return tx.individualCourseEnrollment.create({
        data: {
          instituteId, courseId: course.id, studentId: sid,
          feeDue: totalFee, notes: notes || null,
        },
        include: { student: true },
      });
    });
    return success(res, enrollment, 'Enrolled', 201);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.individualCourse.deleteMany({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    return success(res, null, 'Course deleted');
  } catch (err) { next(err); }
});

export default router;
