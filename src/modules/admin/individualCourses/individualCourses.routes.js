import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { createPortalUser, generateRollNumber } from '../../../utils/portalUser.js';
import { AppError } from '../../../utils/AppError.js';
import { assignIndividualCourseFees, calculateEnrollmentFeeDue } from '../../../services/individualCourseFee.service.js';

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

function toDecimal(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

router.post('/', async (req, res, next) => {
  try {
    const {
      name, code, duration, startDate, endDate, capacity, description, status,
      admissionFee, monthlyFee, oneTimeFee, discountAmount, scholarshipAmount, teacherIds = [],
    } = req.body;
    if (!name?.trim() || !code?.trim()) throw new AppError('Name and code are required', 400);

    const instituteId = req.user.instituteId;
    const normalizedCode = String(code).trim().toUpperCase();
    const dup = await prisma.individualCourse.findFirst({ where: { instituteId, code: normalizedCode } });
    if (dup) throw new AppError('Course code already exists', 409);

    const validStatuses = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
    const courseStatus = validStatuses.includes(status) ? status : 'ACTIVE';
    const teacherIdList = Array.isArray(teacherIds) ? teacherIds.filter(Boolean) : [];

    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.individualCourse.create({
        data: {
          instituteId,
          name: name.trim(),
          code: normalizedCode,
          duration: duration?.trim() || null,
          description: description?.trim() || null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          capacity: toInt(capacity, 30),
          status: courseStatus,
          admissionFee: toDecimal(admissionFee),
          monthlyFee: toDecimal(monthlyFee),
          oneTimeFee: toDecimal(oneTimeFee),
          discountAmount: toDecimal(discountAmount),
          scholarshipAmount: toDecimal(scholarshipAmount),
        },
      });
      if (teacherIdList.length) {
        await tx.individualCourseTeacher.createMany({
          data: teacherIdList.map((teacherId) => ({ courseId: c.id, teacherId })),
          skipDuplicates: true,
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
          ...(data.name !== undefined && { name: String(data.name).trim() }),
          ...(data.duration !== undefined && { duration: data.duration?.trim() || null }),
          ...(data.description !== undefined && { description: data.description?.trim() || null }),
          ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
          ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
          ...(data.capacity !== undefined && { capacity: toInt(data.capacity, existing.capacity) }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.admissionFee !== undefined && { admissionFee: toDecimal(data.admissionFee) }),
          ...(data.monthlyFee !== undefined && { monthlyFee: toDecimal(data.monthlyFee) }),
          ...(data.oneTimeFee !== undefined && { oneTimeFee: toDecimal(data.oneTimeFee) }),
          ...(data.discountAmount !== undefined && { discountAmount: toDecimal(data.discountAmount) }),
          ...(data.scholarshipAmount !== undefined && { scholarshipAmount: toDecimal(data.scholarshipAmount) }),
        },
      });
      if (teacherIds) {
        await tx.individualCourseTeacher.deleteMany({ where: { courseId: req.params.id } });
        const teacherIdList = Array.isArray(teacherIds) ? teacherIds.filter(Boolean) : [];
        if (teacherIdList.length) {
          await tx.individualCourseTeacher.createMany({
            data: teacherIdList.map((teacherId) => ({ courseId: req.params.id, teacherId })),
            skipDuplicates: true,
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
    const totalFee = calculateEnrollmentFeeDue(course);

    const enrollmentCount = await prisma.individualCourseEnrollment.count({
      where: { courseId: course.id, status: { not: 'DROPPED' } },
    });
    if (enrollmentCount >= course.capacity) throw new AppError('Course capacity is full', 400);

    const result = await prisma.$transaction(async (tx) => {
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
            ...(newStudent.dateOfBirth && { dateOfBirth: new Date(newStudent.dateOfBirth) }),
            ...(newStudent.gender && { gender: newStudent.gender }),
            ...(newStudent.guardianName && { guardianName: newStudent.guardianName }),
            ...(newStudent.guardianPhone && { guardianPhone: newStudent.guardianPhone }),
          },
        });
        sid = st.id;
      }
      if (!sid) throw new AppError('Student or new student data required', 400);

      const dup = await tx.individualCourseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: sid } },
      });
      if (dup) throw new AppError('Student already enrolled', 409);

      const enrollment = await tx.individualCourseEnrollment.create({
        data: {
          instituteId, courseId: course.id, studentId: sid,
          feeDue: totalFee, notes: notes || null,
        },
        include: { student: true },
      });

      const fees = await assignIndividualCourseFees(tx, {
        instituteId, course, enrollment, studentId: sid,
      });

      return { enrollment, feesAssigned: fees.length };
    });
    return success(res, result, 'Enrolled with fees assigned', 201);
  } catch (err) { next(err); }
});

router.post('/:id/teachers', async (req, res, next) => {
  try {
    const { teacherId } = req.body;
    if (!teacherId) throw new AppError('teacherId required', 400);
    const course = await prisma.individualCourse.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);
    const link = await prisma.individualCourseTeacher.upsert({
      where: { courseId_teacherId: { courseId: course.id, teacherId } },
      create: { courseId: course.id, teacherId },
      update: {},
      include: { teacher: { select: { id: true, firstName: true, lastName: true } } },
    });
    return success(res, link, 'Teacher assigned', 201);
  } catch (err) { next(err); }
});

router.delete('/:id/teachers/:teacherId', async (req, res, next) => {
  try {
    await prisma.individualCourseTeacher.deleteMany({
      where: { courseId: req.params.id, teacherId: req.params.teacherId },
    });
    return success(res, null, 'Teacher removed');
  } catch (err) { next(err); }
});

router.get('/:id/attendance', async (req, res, next) => {
  try {
    const where = {
      instituteId: req.user.instituteId,
      courseId: req.params.id,
      ...(req.query.date && { date: new Date(req.query.date) }),
    };
    const records = await prisma.individualCourseAttendance.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
      },
      orderBy: { date: 'desc' },
    });
    return success(res, records);
  } catch (err) { next(err); }
});

router.post('/:id/attendance/mark', async (req, res, next) => {
  try {
    const { date, records } = req.body;
    if (!date || !Array.isArray(records)) throw new AppError('date and records required', 400);

    const course = await prisma.individualCourse.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);

    const enrolled = await prisma.individualCourseEnrollment.findMany({
      where: { courseId: course.id, status: 'ENROLLED' },
      select: { studentId: true },
    });
    const allowed = new Set(enrolled.map((e) => e.studentId));
    const saved = [];

    for (const rec of records) {
      if (!allowed.has(rec.studentId)) continue;
      const row = await prisma.individualCourseAttendance.upsert({
        where: {
          instituteId_courseId_studentId_date_lectureNumber: {
            instituteId: req.user.instituteId,
            courseId: course.id,
            studentId: rec.studentId,
            date: new Date(date),
            lectureNumber: rec.lectureNumber || 1,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          courseId: course.id,
          studentId: rec.studentId,
          date: new Date(date),
          lectureNumber: rec.lectureNumber || 1,
          status: rec.status || 'PRESENT',
          markedById: req.user.id,
        },
        update: { status: rec.status || 'PRESENT', markedById: req.user.id },
      });
      saved.push(row);
    }
    return success(res, saved, `Attendance marked for ${saved.length} students`);
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
