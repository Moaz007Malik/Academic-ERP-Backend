import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.STUDENT_MANAGEMENT));
router.use(blockExpiredModuleAccess);

async function owned(model, id, instituteId) {
  const row = await model.findFirst({ where: { id, instituteId } });
  if (!row) throw new AppError('Record not found', 404);
  return row;
}

async function assertUnique(model, where, message) {
  const existing = await model.findFirst({ where });
  if (existing) throw new AppError(message, 409);
}

router.get('/structure', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const [sessions, semesters, departments, batches, sections] = await Promise.all([
      prisma.session.findMany({ where: { instituteId }, orderBy: { startDate: 'desc' } }),
      prisma.semester.findMany({ where: { instituteId }, include: { session: true }, orderBy: { number: 'asc' } }),
      prisma.department.findMany({ where: { instituteId }, include: { courses: { include: { subjects: true } } } }),
      prisma.batch.findMany({ where: { instituteId }, include: { session: true } }),
      prisma.section.findMany({ where: { instituteId }, include: { batch: true } }),
    ]);
    return success(res, { sessions, semesters, departments, batches, sections });
  } catch (err) {
    next(err);
  }
});

// ─── Sessions ────────────────────────────────────────────────────────────────

router.post('/sessions', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, startDate, endDate, isActive } = req.body;
    if (!name?.trim()) throw new AppError('Name is required', 400);
    await assertUnique(prisma.session, { instituteId, name: name.trim() }, 'A session with this name already exists');
    if (isActive) {
      await prisma.session.updateMany({ where: { instituteId }, data: { isActive: false } });
    }
    const session = await prisma.session.create({
      data: { instituteId, name: name.trim(), startDate: new Date(startDate), endDate: new Date(endDate), isActive: !!isActive },
    });
    return success(res, session, 'Session created', 201);
  } catch (err) { next(err); }
});

router.put('/sessions/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.session, req.params.id, instituteId);
    const { name, startDate, endDate, isActive } = req.body;
    if (name) {
      await assertUnique(prisma.session, { instituteId, name: name.trim(), NOT: { id: req.params.id } }, 'A session with this name already exists');
    }
    if (isActive) {
      await prisma.session.updateMany({ where: { instituteId }, data: { isActive: false } });
    }
    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    });
    return success(res, session, 'Session updated');
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.session, req.params.id, instituteId);
    const linked = await prisma.batch.count({ where: { sessionId: req.params.id, instituteId } });
    if (linked) throw new AppError('Cannot delete: session has linked classes/batches', 400);
    await prisma.semester.deleteMany({ where: { sessionId: req.params.id, instituteId } });
    await prisma.session.delete({ where: { id: req.params.id } });
    return success(res, null, 'Session deleted');
  } catch (err) { next(err); }
});

// ─── Semesters ───────────────────────────────────────────────────────────────

router.post('/semesters', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { sessionId, name, number, startDate, endDate } = req.body;
    if (!sessionId || !name?.trim()) throw new AppError('Session and name are required', 400);
    await assertUnique(prisma.semester, { instituteId, sessionId, number: Number(number) }, 'This semester number already exists for the session');
    const semester = await prisma.semester.create({
      data: { instituteId, sessionId, name: name.trim(), number, startDate: new Date(startDate), endDate: new Date(endDate) },
    });
    return success(res, semester, 'Semester created', 201);
  } catch (err) { next(err); }
});

router.put('/semesters/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.semester, req.params.id, instituteId);
    const { sessionId, name, number, startDate, endDate } = req.body;
    const sid = sessionId || existing.sessionId;
    if (number !== undefined) {
      await assertUnique(prisma.semester, { instituteId, sessionId: sid, number: Number(number), NOT: { id: req.params.id } }, 'This semester number already exists for the session');
    }
    const semester = await prisma.semester.update({
      where: { id: req.params.id },
      data: {
        ...(sessionId !== undefined && { sessionId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(number !== undefined && { number }),
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
      },
    });
    return success(res, semester, 'Semester updated');
  } catch (err) { next(err); }
});

router.delete('/semesters/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.semester, req.params.id, instituteId);
    const linked = await prisma.exam.count({ where: { semesterId: req.params.id, instituteId } });
    if (linked) throw new AppError('Cannot delete: semester has linked exams', 400);
    await prisma.semester.delete({ where: { id: req.params.id } });
    return success(res, null, 'Semester deleted');
  } catch (err) { next(err); }
});

// ─── Departments ─────────────────────────────────────────────────────────────

router.post('/departments', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, code } = req.body;
    if (!name?.trim() || !code?.trim()) throw new AppError('Name and code are required', 400);
    await assertUnique(prisma.department, { instituteId, code: code.trim().toUpperCase() }, 'Department code already exists');
    const dept = await prisma.department.create({ data: { instituteId, name: name.trim(), code: code.trim().toUpperCase() } });
    return success(res, dept, 'Department created', 201);
  } catch (err) { next(err); }
});

router.put('/departments/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.department, req.params.id, instituteId);
    const { name, code } = req.body;
    if (code) {
      await assertUnique(prisma.department, { instituteId, code: code.trim().toUpperCase(), NOT: { id: req.params.id } }, 'Department code already exists');
    }
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(code !== undefined && { code: code.trim().toUpperCase() }),
      },
    });
    return success(res, dept, 'Department updated');
  } catch (err) { next(err); }
});

router.delete('/departments/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.department, req.params.id, instituteId);
    const courses = await prisma.course.findMany({ where: { departmentId: req.params.id, instituteId } });
    for (const c of courses) {
      await prisma.subject.deleteMany({ where: { courseId: c.id, instituteId } });
    }
    await prisma.course.deleteMany({ where: { departmentId: req.params.id, instituteId } });
    await prisma.department.delete({ where: { id: req.params.id } });
    return success(res, null, 'Department deleted');
  } catch (err) { next(err); }
});

// ─── Courses ─────────────────────────────────────────────────────────────────

router.post('/courses', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { departmentId, name, code, creditHours } = req.body;
    if (!departmentId || !name?.trim() || !code?.trim()) throw new AppError('Department, name and code are required', 400);
    await assertUnique(prisma.course, { instituteId, departmentId, code: code.trim().toUpperCase() }, 'Course code already exists in this department');
    const course = await prisma.course.create({
      data: { instituteId, departmentId, name: name.trim(), code: code.trim().toUpperCase(), creditHours: creditHours || 3 },
    });
    return success(res, course, 'Course created', 201);
  } catch (err) { next(err); }
});

router.put('/courses/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.course, req.params.id, instituteId);
    const { departmentId, name, code, creditHours } = req.body;
    const deptId = departmentId || existing.departmentId;
    if (code) {
      await assertUnique(prisma.course, { instituteId, departmentId: deptId, code: code.trim().toUpperCase(), NOT: { id: req.params.id } }, 'Course code already exists in this department');
    }
    const course = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        ...(departmentId !== undefined && { departmentId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(code !== undefined && { code: code.trim().toUpperCase() }),
        ...(creditHours !== undefined && { creditHours }),
      },
    });
    return success(res, course, 'Course updated');
  } catch (err) { next(err); }
});

router.delete('/courses/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.course, req.params.id, instituteId);
    await prisma.subject.deleteMany({ where: { courseId: req.params.id, instituteId } });
    await prisma.course.delete({ where: { id: req.params.id } });
    return success(res, null, 'Course deleted');
  } catch (err) { next(err); }
});

// ─── Subjects ────────────────────────────────────────────────────────────────

router.post('/subjects', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { courseId, name, code, creditHours } = req.body;
    if (!courseId || !name?.trim() || !code?.trim()) throw new AppError('Course, name and code are required', 400);
    await assertUnique(prisma.subject, { instituteId, courseId, code: code.trim().toUpperCase() }, 'Subject code already exists in this course');
    const subject = await prisma.subject.create({
      data: { instituteId, courseId, name: name.trim(), code: code.trim().toUpperCase(), creditHours: creditHours || 3 },
    });
    return success(res, subject, 'Subject created', 201);
  } catch (err) { next(err); }
});

router.put('/subjects/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.subject, req.params.id, instituteId);
    const { courseId, name, code, creditHours } = req.body;
    const cid = courseId || existing.courseId;
    if (code) {
      await assertUnique(prisma.subject, { instituteId, courseId: cid, code: code.trim().toUpperCase(), NOT: { id: req.params.id } }, 'Subject code already exists in this course');
    }
    const subject = await prisma.subject.update({
      where: { id: req.params.id },
      data: {
        ...(courseId !== undefined && { courseId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(code !== undefined && { code: code.trim().toUpperCase() }),
        ...(creditHours !== undefined && { creditHours }),
      },
    });
    return success(res, subject, 'Subject updated');
  } catch (err) { next(err); }
});

router.delete('/subjects/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.subject, req.params.id, instituteId);
    const linked = await prisma.teacherAssignment.count({ where: { subjectId: req.params.id, instituteId } });
    if (linked) throw new AppError('Cannot delete: subject is assigned to teachers', 400);
    await prisma.subject.delete({ where: { id: req.params.id } });
    return success(res, null, 'Subject deleted');
  } catch (err) { next(err); }
});

// ─── Batches ─────────────────────────────────────────────────────────────────

router.post('/batches', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, year, sessionId } = req.body;
    if (!name?.trim()) throw new AppError('Name is required', 400);
    await assertUnique(prisma.batch, { instituteId, name: name.trim() }, 'A class/batch with this name already exists');
    const batch = await prisma.batch.create({
      data: { instituteId, name: name.trim(), year, sessionId: sessionId || null },
    });
    return success(res, batch, 'Batch/Class created', 201);
  } catch (err) { next(err); }
});

router.put('/batches/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.batch, req.params.id, instituteId);
    const { name, year, sessionId } = req.body;
    if (name) {
      await assertUnique(prisma.batch, { instituteId, name: name.trim(), NOT: { id: req.params.id } }, 'A class/batch with this name already exists');
    }
    const batch = await prisma.batch.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(year !== undefined && { year }),
        ...(sessionId !== undefined && { sessionId: sessionId || null }),
      },
    });
    return success(res, batch, 'Batch/Class updated');
  } catch (err) { next(err); }
});

router.delete('/batches/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.batch, req.params.id, instituteId);
    const students = await prisma.student.count({ where: { currentBatchId: req.params.id, instituteId } });
    if (students) throw new AppError('Cannot delete: students are enrolled in this class', 400);
    await prisma.section.deleteMany({ where: { batchId: req.params.id, instituteId } });
    await prisma.batch.delete({ where: { id: req.params.id } });
    return success(res, null, 'Batch/Class deleted');
  } catch (err) { next(err); }
});

// ─── Sections ────────────────────────────────────────────────────────────────

router.post('/sections', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { batchId, name, capacity } = req.body;
    if (!batchId || !name?.trim()) throw new AppError('Batch and section name are required', 400);
    await assertUnique(prisma.section, { instituteId, batchId, name: name.trim() }, 'This section already exists for the class');
    const section = await prisma.section.create({
      data: { instituteId, batchId, name: name.trim(), capacity },
    });
    return success(res, section, 'Section created', 201);
  } catch (err) { next(err); }
});

router.put('/sections/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.section, req.params.id, instituteId);
    const { batchId, name, capacity } = req.body;
    const bid = batchId || existing.batchId;
    if (name) {
      await assertUnique(prisma.section, { instituteId, batchId: bid, name: name.trim(), NOT: { id: req.params.id } }, 'This section already exists for the class');
    }
    const section = await prisma.section.update({
      where: { id: req.params.id },
      data: {
        ...(batchId !== undefined && { batchId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(capacity !== undefined && { capacity }),
      },
    });
    return success(res, section, 'Section updated');
  } catch (err) { next(err); }
});

router.delete('/sections/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.section, req.params.id, instituteId);
    const students = await prisma.student.count({ where: { currentSectionId: req.params.id, instituteId } });
    if (students) throw new AppError('Cannot delete: students are enrolled in this section', 400);
    await prisma.teacherAssignment.deleteMany({ where: { sectionId: req.params.id, instituteId } });
    await prisma.section.delete({ where: { id: req.params.id } });
    return success(res, null, 'Section deleted');
  } catch (err) { next(err); }
});

export default router;
