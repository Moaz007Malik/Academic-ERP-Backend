import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';
import { createPortalUser, generateRollNumber } from '../../../utils/portalUser.js';
import {
  assignDegreeStudentFees, calcNetSemesterFee, createSemesterInstallments,
  getEffectiveSemesterFee, assignFeesOnBatchPromote,
} from '../../../services/degreeFee.service.js';
import { getDegreeStudentProfile } from '../../../services/degreeProfile.service.js';
import { computeResult, calculateCGPA, calculateSemesterGPA } from '../../../utils/grading.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.DEGREE));
router.use(blockExpiredModuleAccess);

// ─── Degrees ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId };
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { code: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }
    const [degrees, total] = await Promise.all([
      prisma.degree.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { _count: { select: { batches: true } } },
      }),
      prisma.degree.count({ where }),
    ]);
    return paginated(res, degrees, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, code, description, status } = req.body;
    if (!name || !code) throw new AppError('Name and code required', 400);
    const dup = await prisma.degree.findFirst({ where: { instituteId, code } });
    if (dup) throw new AppError('Degree code already exists', 409);
    const degree = await prisma.degree.create({
      data: { instituteId, name, code, description, status: status || 'ACTIVE' },
    });
    return success(res, degree, 'Degree created', 201);
  } catch (err) { next(err); }
});

router.get('/batches/:batchId', async (req, res, next) => {
  try {
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.params.batchId, instituteId: req.user.instituteId },
      include: {
        degree: true,
        semesters: {
          orderBy: { number: 'asc' },
          include: {
            courses: { include: { teachers: { include: { teacher: true } } } },
          },
        },
        students: {
          include: { student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } } },
          orderBy: { admittedAt: 'desc' },
        },
        _count: { select: { students: true } },
      },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    const enriched = {
      ...batch,
      semesters: batch.semesters.map((s) => ({
        ...s,
        effectiveFee: getEffectiveSemesterFee(batch, s),
      })),
    };
    return success(res, enriched);
  } catch (err) { next(err); }
});

router.get('/:degreeId', async (req, res, next) => {
  try {
    const degree = await prisma.degree.findFirst({
      where: { id: req.params.degreeId, instituteId: req.user.instituteId },
      include: {
        batches: {
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { students: true } } },
        },
      },
    });
    if (!degree) throw new AppError('Degree not found', 404);
    return success(res, degree);
  } catch (err) { next(err); }
});

router.put('/:degreeId', async (req, res, next) => {
  try {
    const existing = await prisma.degree.findFirst({
      where: { id: req.params.degreeId, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Degree not found', 404);
    const { name, code, description, status } = req.body;
    const degree = await prisma.degree.update({
      where: { id: req.params.degreeId },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
      },
    });
    return success(res, degree, 'Degree updated');
  } catch (err) { next(err); }
});

router.delete('/:degreeId', async (req, res, next) => {
  try {
    const degree = await prisma.degree.findFirst({
      where: { id: req.params.degreeId, instituteId: req.user.instituteId },
      include: { _count: { select: { batches: true } } },
    });
    if (!degree) throw new AppError('Degree not found', 404);
    if (degree._count.batches) throw new AppError('Delete batches first', 400);
    await prisma.degree.delete({ where: { id: degree.id } });
    return success(res, null, 'Degree deleted');
  } catch (err) { next(err); }
});

// ─── Batches ─────────────────────────────────────────────────────────────────

router.post('/:degreeId/batches', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const degree = await prisma.degree.findFirst({
      where: { id: req.params.degreeId, instituteId },
    });
    if (!degree) throw new AppError('Degree not found', 404);

    const { name, maxStudents, totalSemesters, registrationFee, defaultSemesterFee } = req.body;
    if (!name) throw new AppError('Batch name required', 400);
    const semestersCount = Number(totalSemesters) || 8;
    const defaultFee = defaultSemesterFee ?? 0;

    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.degreeBatch.create({
        data: {
          instituteId,
          degreeId: degree.id,
          name,
          maxStudents: maxStudents || 50,
          totalSemesters: semestersCount,
          registrationFee: registrationFee ?? 0,
          defaultSemesterFee: defaultFee,
        },
      });
      const semesterRows = Array.from({ length: semestersCount }, (_, i) => ({
        instituteId,
        batchId: b.id,
        number: i + 1,
        name: `Semester ${i + 1}`,
        semesterFee: null,
      }));
      await tx.degreeSemester.createMany({ data: semesterRows });
      return b;
    });

    return success(res, batch, 'Batch created with semesters', 201);
  } catch (err) { next(err); }
});

router.put('/batches/:batchId', async (req, res, next) => {
  try {
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.params.batchId, instituteId: req.user.instituteId },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    const { name, maxStudents, registrationFee, defaultSemesterFee, status } = req.body;
    const updated = await prisma.degreeBatch.update({
      where: { id: batch.id },
      data: {
        ...(name !== undefined && { name }),
        ...(maxStudents !== undefined && { maxStudents }),
        ...(registrationFee !== undefined && { registrationFee }),
        ...(defaultSemesterFee !== undefined && { defaultSemesterFee }),
        ...(status !== undefined && { status }),
      },
    });
    return success(res, updated, 'Batch updated');
  } catch (err) { next(err); }
});

router.delete('/batches/:batchId', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const batchId = req.params.batchId;
    const batch = await prisma.degreeBatch.findFirst({ where: { id: batchId, instituteId } });
    if (!batch) throw new AppError('Batch not found', 404);

    await prisma.$transaction(async (tx) => {
      const degreeStudents = await tx.degreeStudent.findMany({ where: { batchId }, select: { id: true, studentId: true } });
      const dsIds = degreeStudents.map((d) => d.id);
      if (dsIds.length) {
        await tx.fee.deleteMany({ where: { degreeStudentId: { in: dsIds }, instituteId } });
        await tx.degreeAttendance.deleteMany({ where: { degreeStudentId: { in: dsIds }, instituteId } });
        await tx.degreeResult.deleteMany({ where: { degreeStudentId: { in: dsIds }, instituteId } });
        await tx.degreeStudent.deleteMany({ where: { batchId, instituteId } });
      }
      await tx.degreeBatch.delete({ where: { id: batchId } });
    });
    return success(res, null, 'Batch and all related data deleted');
  } catch (err) { next(err); }
});

router.post('/batches/:batchId/promote', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.params.batchId, instituteId },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    if (batch.currentSemester >= batch.totalSemesters) {
      throw new AppError('Batch is already on the final semester', 400);
    }
    const nextSem = batch.currentSemester + 1;

    const result = await prisma.$transaction(async (tx) => {
      const updatedBatch = await tx.degreeBatch.update({
        where: { id: batch.id },
        data: { currentSemester: nextSem },
      });
      await tx.degreeStudent.updateMany({
        where: { batchId: batch.id, instituteId, status: 'ACTIVE' },
        data: { currentSemesterNumber: nextSem },
      });
      const semester = await tx.degreeSemester.findFirst({
        where: { batchId: batch.id, number: nextSem },
      });
      const feesAssigned = await assignFeesOnBatchPromote(tx, {
        instituteId, batch: updatedBatch, semester,
      });
      const count = await tx.degreeStudent.count({
        where: { batchId: batch.id, instituteId, status: 'ACTIVE' },
      });
      return { promotedStudents: count, currentSemester: nextSem, feesAssigned };
    });
    return success(res, result, `Batch promoted to semester ${nextSem}`);
  } catch (err) { next(err); }
});

// ─── Semesters ───────────────────────────────────────────────────────────────

router.put('/semesters/:semesterId', async (req, res, next) => {
  try {
    const semester = await prisma.degreeSemester.findFirst({
      where: { id: req.params.semesterId, instituteId: req.user.instituteId },
      include: { batch: true },
    });
    if (!semester) throw new AppError('Semester not found', 404);
    const { name, semesterFee, useDefaultFee, startDate, endDate } = req.body;

    let feeValue = semester.semesterFee;
    if (useDefaultFee === true) feeValue = null;
    else if (semesterFee !== undefined) feeValue = semesterFee === null || semesterFee === '' ? null : semesterFee;

    const updated = await prisma.degreeSemester.update({
      where: { id: semester.id },
      data: {
        ...(name !== undefined && { name }),
        ...(feeValue !== undefined && { semesterFee: feeValue }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      },
      include: { batch: true },
    });
    const effectiveFee = getEffectiveSemesterFee(updated.batch, updated);
    return success(res, { ...updated, effectiveFee }, 'Semester updated');
  } catch (err) { next(err); }
});

// ─── Semester courses ────────────────────────────────────────────────────────

router.post('/semesters/:semesterId/courses', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const semester = await prisma.degreeSemester.findFirst({
      where: { id: req.params.semesterId, instituteId },
    });
    if (!semester) throw new AppError('Semester not found', 404);
    const { name, code, creditHours, teacherIds = [] } = req.body;
    if (!name || !code) throw new AppError('Name and code required', 400);

    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.degreeSemesterCourse.create({
        data: { instituteId, semesterId: semester.id, name, code, creditHours: creditHours || 3 },
      });
      if (teacherIds.length) {
        await tx.degreeCourseTeacher.createMany({
          data: teacherIds.map((teacherId) => ({ courseId: c.id, teacherId })),
        });
      }
      return c;
    });
    return success(res, course, 'Course created', 201);
  } catch (err) { next(err); }
});

router.put('/courses/:courseId', async (req, res, next) => {
  try {
    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: req.params.courseId, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);
    const { name, code, creditHours, teacherIds } = req.body;
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.degreeSemesterCourse.update({
        where: { id: course.id },
        data: {
          ...(name !== undefined && { name }),
          ...(code !== undefined && { code }),
          ...(creditHours !== undefined && { creditHours }),
        },
      });
      if (teacherIds) {
        await tx.degreeCourseTeacher.deleteMany({ where: { courseId: course.id } });
        if (teacherIds.length) {
          await tx.degreeCourseTeacher.createMany({
            data: teacherIds.map((teacherId) => ({ courseId: course.id, teacherId })),
          });
        }
      }
      return c;
    });
    return success(res, updated, 'Course updated');
  } catch (err) { next(err); }
});

router.delete('/courses/:courseId', async (req, res, next) => {
  try {
    await prisma.degreeSemesterCourse.deleteMany({
      where: { id: req.params.courseId, instituteId: req.user.instituteId },
    });
    return success(res, null, 'Course deleted');
  } catch (err) { next(err); }
});

// ─── Students ────────────────────────────────────────────────────────────────

async function admitDegreeStudent(tx, instituteId, batch, payload) {
  const {
    studentId, newStudent,
    discount, scholarship, installmentEnabled, installmentCount,
  } = payload;

  const activeCount = await tx.degreeStudent.count({
    where: { batchId: batch.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
  });
  if (activeCount >= batch.maxStudents) throw new AppError('Batch capacity full', 400);

  let sid = studentId;
  let portalCreds = null;
  if (!sid && newStudent) {
    const { firstName, lastName, email, password, phone } = newStudent;
    if (!firstName || !lastName) throw new AppError('Student name required', 400);
    if (!email?.trim()) throw new AppError('Email required for student portal access', 400);
    const count = await tx.student.count({ where: { instituteId } });
    const institute = await tx.institute.findUnique({ where: { id: instituteId } });
    const prefix = institute?.instituteCode?.slice(0, 3) || 'STU';
    const existing = await tx.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new AppError('Email already in use', 409);
    const plainPassword = password || 'Student@123';
    const user = await createPortalUser(tx, {
      email, password: plainPassword, role: 'STUDENT', instituteId, firstName, lastName,
    });
    const st = await tx.student.create({
      data: {
        instituteId, userId: user.id, firstName, lastName, phone: phone || null,
        rollNumber: generateRollNumber(prefix, count + 1),
        enrollmentDate: new Date(), status: 'ACTIVE',
        dateOfBirth: newStudent.dateOfBirth ? new Date(newStudent.dateOfBirth) : null,
        gender: newStudent.gender || null,
        cnic: newStudent.cnic || null,
        address: newStudent.address || null,
        guardianName: newStudent.guardianName || null,
        guardianPhone: newStudent.guardianPhone || null,
        fatherName: newStudent.fatherName || null,
        motherName: newStudent.motherName || null,
      },
    });
    sid = st.id;
    portalCreds = { email: user.email, password: plainPassword };
  }
  if (!sid) throw new AppError('Student or new student data required', 400);

  const dup = await tx.degreeStudent.findUnique({
    where: { batchId_studentId: { batchId: batch.id, studentId: sid } },
  });
  if (dup) throw new AppError('Student already in this batch', 409);

  const semester = await tx.degreeSemester.findFirst({
    where: { batchId: batch.id, number: batch.currentSemester },
  });
  const semFee = getEffectiveSemesterFee(batch, semester);
  const regFee = batch.registrationFee ?? 0;
  const disc = discount ?? 0;
  const schol = scholarship ?? 0;
  const netFee = calcNetSemesterFee(semFee, disc, schol);
  const instEnabled = installmentEnabled === true || installmentEnabled === 'true';
  const instCount = instEnabled ? Math.min(Math.max(Number(installmentCount) || 1, 1), 6) : null;

  const degreeStudent = await tx.degreeStudent.create({
    data: {
      instituteId,
      batchId: batch.id,
      studentId: sid,
      currentSemesterNumber: batch.currentSemester,
      registrationFee: regFee,
      semesterFee: semFee,
      discount: disc,
      scholarship: schol,
      netSemesterFee: netFee,
      installmentEnabled: instEnabled,
      installmentCount: instCount,
    },
    include: { student: { include: { user: { select: { email: true, portalPassword: true } } } } },
  });

  const fees = await assignDegreeStudentFees(tx, {
    instituteId, degreeStudent, batch, semester, semesterNumber: batch.currentSemester,
  });

  if (instEnabled && instCount > 1 && fees.length) {
    const semFeeRecord = fees.find((f) => (f.notes || '').includes('Semester'));
    if (semFeeRecord) {
      await createSemesterInstallments(tx, {
        instituteId,
        parentFee: semFeeRecord,
        installmentCount: instCount,
        firstDueDate: semester?.startDate,
      });
    }
  }

  return { degreeStudent, feesAssigned: fees.length, portalCredentials: portalCreds };
}

router.post('/batches/:batchId/students', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.params.batchId, instituteId },
    });
    if (!batch) throw new AppError('Batch not found', 404);

    const result = await prisma.$transaction((tx) => admitDegreeStudent(tx, instituteId, batch, req.body));
    return success(res, result, 'Student admitted with fees', 201);
  } catch (err) { next(err); }
});

router.post('/batches/:batchId/students/bulk', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.params.batchId, instituteId },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    const { students = [] } = req.body;
    if (!students.length) throw new AppError('students array required', 400);

    const admitted = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const s of students) {
        rows.push(await admitDegreeStudent(tx, instituteId, batch, s));
      }
      return rows;
    });
    return success(res, { admitted: admitted.length, rows: admitted }, 'Bulk admission complete', 201);
  } catch (err) { next(err); }
});

router.put('/students/:degreeStudentId', async (req, res, next) => {
  try {
    const ds = await prisma.degreeStudent.findFirst({
      where: { id: req.params.degreeStudentId, instituteId: req.user.instituteId },
      include: { batch: true },
    });
    if (!ds) throw new AppError('Degree student not found', 404);
    const {
      status, discount, scholarship, currentSemesterNumber,
      installmentEnabled, installmentCount,
    } = req.body;
    const disc = discount !== undefined ? discount : ds.discount;
    const schol = scholarship !== undefined ? scholarship : ds.scholarship;
    const updated = await prisma.degreeStudent.update({
      where: { id: ds.id },
      data: {
        ...(status !== undefined && { status }),
        ...(currentSemesterNumber !== undefined && { currentSemesterNumber }),
        ...(discount !== undefined && { discount: disc }),
        ...(scholarship !== undefined && { scholarship: schol }),
        ...((discount !== undefined || scholarship !== undefined) && {
          netSemesterFee: calcNetSemesterFee(ds.semesterFee, disc, schol),
        }),
        ...(installmentEnabled !== undefined && { installmentEnabled: !!installmentEnabled }),
        ...(installmentCount !== undefined && { installmentCount: installmentCount || null }),
      },
      include: { student: true, batch: { include: { degree: true } } },
    });
    return success(res, updated, 'Student updated');
  } catch (err) { next(err); }
});

router.get('/students/:degreeStudentId/profile', async (req, res, next) => {
  try {
    const profile = await getDegreeStudentProfile(req.params.degreeStudentId, req.user.instituteId);
    if (!profile) throw new AppError('Degree student not found', 404);
    return success(res, profile);
  } catch (err) { next(err); }
});

router.get('/students/:degreeStudentId/attendance', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const ds = await prisma.degreeStudent.findFirst({
      where: { id: req.params.degreeStudentId, instituteId },
      include: { batch: { include: { semesters: true } } },
    });
    if (!ds) throw new AppError('Degree student not found', 404);

    const where = { degreeStudentId: ds.id, instituteId };
    if (req.query.semesterId) {
      const courseIds = await prisma.degreeSemesterCourse.findMany({
        where: { semesterId: req.query.semesterId, instituteId },
        select: { id: true },
      });
      where.courseId = { in: courseIds.map((c) => c.id) };
    } else if (req.query.semesterNumber) {
      const sem = ds.batch.semesters.find((s) => s.number === Number(req.query.semesterNumber));
      if (sem) {
        const courseIds = await prisma.degreeSemesterCourse.findMany({
          where: { semesterId: sem.id, instituteId },
          select: { id: true },
        });
        where.courseId = { in: courseIds.map((c) => c.id) };
      }
    }

    const records = await prisma.degreeAttendance.findMany({
      where,
      include: { course: { include: { semester: true } } },
      orderBy: { date: 'desc' },
    });
    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    return success(res, {
      records,
      summary: { total, present, percentage: total ? Math.round((present / total) * 10000) / 100 : 0 },
    });
  } catch (err) { next(err); }
});

router.get('/students/:degreeStudentId/results', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const ds = await prisma.degreeStudent.findFirst({
      where: { id: req.params.degreeStudentId, instituteId },
      include: { batch: { include: { degree: true, semesters: { orderBy: { number: 'asc' } } } }, student: true },
    });
    if (!ds) throw new AppError('Degree student not found', 404);

    const where = { degreeStudentId: ds.id, instituteId };
    if (req.query.semesterId) where.semesterId = req.query.semesterId;

    const results = await prisma.degreeResult.findMany({
      where,
      include: { course: true, semester: true },
      orderBy: [{ semester: { number: 'asc' } }, { course: { name: 'asc' } }],
    });

    const bySemester = {};
    for (const r of results) {
      const key = r.semesterId;
      if (!bySemester[key]) {
        bySemester[key] = {
          semester: r.semester,
          effectiveFee: getEffectiveSemesterFee(ds.batch, r.semester),
          results: [],
          gpa: 0,
        };
      }
      bySemester[key].results.push(r);
    }
    Object.values(bySemester).forEach((s) => {
      s.gpa = calculateSemesterGPA(s.results.map((r) => ({
        gradePoints: r.gradePoints, creditHours: r.course.creditHours, isPassed: r.isPassed,
      })));
    });

    return success(res, {
      student: ds,
      semesterResults: Object.values(bySemester).sort((a, b) => a.semester.number - b.semester.number),
      cgpa: calculateCGPA(results.filter((r) => r.isPassed)),
    });
  } catch (err) { next(err); }
});

router.post('/batches/:batchId/students/bulk-status', async (req, res, next) => {
  try {
    const { degreeStudentIds, status } = req.body;
    if (!status || !degreeStudentIds?.length) throw new AppError('status and degreeStudentIds required', 400);
    const result = await prisma.degreeStudent.updateMany({
      where: { id: { in: degreeStudentIds }, instituteId: req.user.instituteId, batchId: req.params.batchId },
      data: { status },
    });
    return success(res, { updated: result.count }, 'Status updated');
  } catch (err) { next(err); }
});

// ─── Attendance ──────────────────────────────────────────────────────────────

router.get('/courses/:courseId/attendance', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: req.params.courseId, instituteId },
      include: { semester: true },
    });
    if (!course) throw new AppError('Course not found', 404);

    const where = {
      instituteId,
      courseId: req.params.courseId,
      ...(req.query.date && { date: new Date(req.query.date) }),
    };
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date.gte = new Date(req.query.from);
      if (req.query.to) where.date.lte = new Date(req.query.to);
    }

    const records = await prisma.degreeAttendance.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
        degreeStudent: { select: { id: true, currentSemesterNumber: true } },
      },
      orderBy: { date: 'desc' },
    });

    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === 'PRESENT').length,
      absent: records.filter((r) => r.status === 'ABSENT').length,
      late: records.filter((r) => r.status === 'LATE').length,
      leave: records.filter((r) => r.status === 'LEAVE').length,
    };
    summary.percentage = summary.total
      ? Math.round(((summary.present + summary.late) / summary.total) * 10000) / 100
      : 0;

    return success(res, { course, semester: course.semester, records, summary });
  } catch (err) { next(err); }
});

router.post('/courses/:courseId/attendance/mark', async (req, res, next) => {
  try {
    const { date, records } = req.body;
    if (!date || !Array.isArray(records)) throw new AppError('date and records required', 400);

    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: req.params.courseId, instituteId: req.user.instituteId },
      include: { semester: { include: { batch: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);

    const enrolled = await prisma.degreeStudent.findMany({
      where: {
        batchId: course.semester.batchId,
        status: 'ACTIVE',
        currentSemesterNumber: { gte: course.semester.number },
      },
    });
    const byStudent = new Map(enrolled.map((e) => [e.studentId, e.id]));
    const saved = [];

    for (const rec of records) {
      const degreeStudentId = byStudent.get(rec.studentId);
      if (!degreeStudentId) continue;
      const row = await prisma.degreeAttendance.upsert({
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
          degreeStudentId,
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

// ─── Results ─────────────────────────────────────────────────────────────────

router.post('/results/entry', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const {
      degreeStudentId, semesterId, courseId,
      theoryMarks, practicalMarks, internalMarks, remarks,
      theoryMax = 75, practicalMax = 15, internalMax = 10, passPercentage = 33,
      publish,
    } = req.body;
    if (!degreeStudentId || !semesterId || !courseId) {
      throw new AppError('degreeStudentId, semesterId, courseId required', 400);
    }

    const computed = computeResult({
      theoryMarks, practicalMarks, internalMarks, theoryMax, practicalMax, internalMax, passPercentage,
    });

    const result = await prisma.degreeResult.upsert({
      where: {
        degreeStudentId_courseId_semesterId: { degreeStudentId, courseId, semesterId },
      },
      create: {
        instituteId,
        degreeStudentId,
        semesterId,
        courseId,
        theoryMarks,
        practicalMarks,
        internalMarks,
        totalMarks: computed.totalMarks,
        maxMarks: computed.maxMarks,
        grade: computed.grade,
        gradePoints: computed.gradePoints,
        percentage: computed.percentage,
        passPercentage,
        remarks: remarks || null,
        isPassed: computed.isPassed,
        ...(publish && { publishedAt: new Date() }),
      },
      update: {
        theoryMarks, practicalMarks, internalMarks,
        totalMarks: computed.totalMarks,
        maxMarks: computed.maxMarks,
        grade: computed.grade,
        gradePoints: computed.gradePoints,
        percentage: computed.percentage,
        passPercentage,
        remarks: remarks !== undefined ? remarks : undefined,
        isPassed: computed.isPassed,
        ...(publish && { publishedAt: new Date() }),
      },
      include: { course: true },
    });
    return success(res, result, 'Result saved');
  } catch (err) { next(err); }
});

router.post('/results/bulk', async (req, res, next) => {
  try {
    const { semesterId, courseId, entries = [], theoryMax, practicalMax, internalMax, passPercentage, publish } = req.body;
    if (!semesterId || !courseId || !entries.length) {
      throw new AppError('semesterId, courseId and entries required', 400);
    }
    const saved = [];
    for (const e of entries) {
      const computed = computeResult({
        theoryMarks: e.theoryMarks,
        practicalMarks: e.practicalMarks,
        internalMarks: e.internalMarks,
        theoryMax, practicalMax, internalMax, passPercentage,
      });
      const row = await prisma.degreeResult.upsert({
        where: {
          degreeStudentId_courseId_semesterId: {
            degreeStudentId: e.degreeStudentId,
            courseId,
            semesterId,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          degreeStudentId: e.degreeStudentId,
          semesterId,
          courseId,
          theoryMarks: e.theoryMarks,
          practicalMarks: e.practicalMarks,
          internalMarks: e.internalMarks,
          totalMarks: computed.totalMarks,
          maxMarks: computed.maxMarks,
          grade: computed.grade,
          gradePoints: computed.gradePoints,
          percentage: computed.percentage,
          passPercentage: passPercentage ?? 33,
          remarks: e.remarks || null,
          isPassed: computed.isPassed,
          ...(publish && { publishedAt: new Date() }),
        },
        update: {
          theoryMarks: e.theoryMarks,
          practicalMarks: e.practicalMarks,
          internalMarks: e.internalMarks,
          totalMarks: computed.totalMarks,
          maxMarks: computed.maxMarks,
          grade: computed.grade,
          gradePoints: computed.gradePoints,
          percentage: computed.percentage,
          passPercentage: passPercentage ?? 33,
          remarks: e.remarks !== undefined ? e.remarks : undefined,
          isPassed: computed.isPassed,
          ...(publish && { publishedAt: new Date() }),
        },
      });
      saved.push(row);
    }
    return success(res, saved, `Saved ${saved.length} results`);
  } catch (err) { next(err); }
});

router.get('/students/:degreeStudentId/transcript', async (req, res, next) => {
  try {
    const ds = await prisma.degreeStudent.findFirst({
      where: { id: req.params.degreeStudentId, instituteId: req.user.instituteId },
      include: {
        student: true,
        batch: { include: { degree: true } },
        results: { include: { course: true, semester: true }, orderBy: { semester: { number: 'asc' } } },
      },
    });
    if (!ds) throw new AppError('Student not found', 404);

    const bySemester = {};
    for (const r of ds.results) {
      const key = r.semester.number;
      if (!bySemester[key]) bySemester[key] = [];
      bySemester[key].push(r);
    }

    const semesterSummaries = Object.entries(bySemester).map(([num, results]) => ({
      semester: Number(num),
      gpa: calculateSemesterGPA(results.map((r) => ({ gradePoints: r.gradePoints, creditHours: r.course.creditHours }))),
      results,
    }));

    const cgpa = calculateCGPA(ds.results.filter((r) => r.isPassed));
    return success(res, { student: ds, semesterSummaries, cgpa });
  } catch (err) { next(err); }
});

router.get('/batches/:batchId/dashboard', async (req, res, next) => {
  try {
    const batchId = req.params.batchId;
    const instituteId = req.user.instituteId;
    const [batch, students, courses, attendanceCount, resultsCount] = await Promise.all([
      prisma.degreeBatch.findFirst({ where: { id: batchId, instituteId }, include: { degree: true } }),
      prisma.degreeStudent.count({ where: { batchId, instituteId } }),
      prisma.degreeSemesterCourse.count({
        where: { semester: { batchId }, instituteId },
      }),
      prisma.degreeAttendance.count({ where: { course: { semester: { batchId } }, instituteId } }),
      prisma.degreeResult.count({ where: { degreeStudent: { batchId }, instituteId } }),
    ]);
    if (!batch) throw new AppError('Batch not found', 404);
    return success(res, {
      batch,
      stats: { students, courses, attendanceCount, resultsCount },
    });
  } catch (err) { next(err); }
});

export default router;
