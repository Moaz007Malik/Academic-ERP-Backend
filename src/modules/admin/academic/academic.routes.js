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

function toDecimal(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

router.get('/structure', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const [sessions, departments, classes, batches, sections] = await Promise.all([
      prisma.session.findMany({ where: { instituteId }, orderBy: { startDate: 'desc' } }),
      prisma.department.findMany({ where: { instituteId }, orderBy: { name: 'asc' } }),
      prisma.academicClass.findMany({
        where: { instituteId },
        include: {
          department: true,
          subjects: { orderBy: { name: 'asc' } },
          _count: { select: { batches: true, subjects: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.batch.findMany({
        where: { instituteId },
        include: {
          session: true,
          academicClass: { include: { department: true, subjects: true } },
          _count: { select: { sections: true, students: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.section.findMany({
        where: { instituteId },
        include: { batch: { include: { academicClass: true, session: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return success(res, { sessions, departments, classes, batches, sections });
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
    if (!startDate || !endDate) throw new AppError('Start and end dates are required', 400);
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
    if (linked) throw new AppError('Cannot delete: session has linked batches', 400);
    await prisma.semester.deleteMany({ where: { sessionId: req.params.id, instituteId } });
    await prisma.session.delete({ where: { id: req.params.id } });
    return success(res, null, 'Session deleted');
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
    const classCount = await prisma.academicClass.count({ where: { departmentId: req.params.id, instituteId } });
    if (classCount) throw new AppError('Cannot delete: department has classes', 400);
    await prisma.course.deleteMany({ where: { departmentId: req.params.id, instituteId } });
    await prisma.department.delete({ where: { id: req.params.id } });
    return success(res, null, 'Department deleted');
  } catch (err) { next(err); }
});

// ─── Academic Classes ────────────────────────────────────────────────────────

router.post('/classes', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { departmentId, name, code, registrationFee, monthlyFee } = req.body;
    if (!departmentId || !name?.trim()) throw new AppError('Department and class name are required', 400);
    await owned(prisma.department, departmentId, instituteId);
    await assertUnique(
      prisma.academicClass,
      { instituteId, departmentId, name: name.trim() },
      'A class with this name already exists in the department',
    );
    const academicClass = await prisma.academicClass.create({
      data: {
        instituteId,
        departmentId,
        name: name.trim(),
        code: code?.trim()?.toUpperCase() || null,
        registrationFee: toDecimal(registrationFee),
        monthlyFee: toDecimal(monthlyFee),
      },
      include: { department: true, subjects: true },
    });
    return success(res, academicClass, 'Class created', 201);
  } catch (err) { next(err); }
});

router.put('/classes/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.academicClass, req.params.id, instituteId);
    const { departmentId, name, code, registrationFee, monthlyFee } = req.body;
    const deptId = departmentId || existing.departmentId;
    if (name) {
      await assertUnique(
        prisma.academicClass,
        { instituteId, departmentId: deptId, name: name.trim(), NOT: { id: req.params.id } },
        'A class with this name already exists in the department',
      );
    }
    const academicClass = await prisma.academicClass.update({
      where: { id: req.params.id },
      data: {
        ...(departmentId !== undefined && { departmentId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(code !== undefined && { code: code?.trim()?.toUpperCase() || null }),
        ...(registrationFee !== undefined && { registrationFee: toDecimal(registrationFee) }),
        ...(monthlyFee !== undefined && { monthlyFee: toDecimal(monthlyFee) }),
      },
      include: { department: true, subjects: true },
    });
    return success(res, academicClass, 'Class updated');
  } catch (err) { next(err); }
});

router.delete('/classes/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.academicClass, req.params.id, instituteId);
    const batches = await prisma.batch.count({ where: { classId: req.params.id, instituteId } });
    if (batches) throw new AppError('Cannot delete: class has batches/sections', 400);
    await prisma.subject.deleteMany({ where: { classId: req.params.id, instituteId } });
    await prisma.academicClass.delete({ where: { id: req.params.id } });
    return success(res, null, 'Class deleted');
  } catch (err) { next(err); }
});

router.get('/classes/:id/subjects', async (req, res, next) => {
  try {
    await owned(prisma.academicClass, req.params.id, req.user.instituteId);
    const subjects = await prisma.subject.findMany({
      where: { classId: req.params.id, instituteId: req.user.instituteId },
      orderBy: { name: 'asc' },
    });
    return success(res, subjects);
  } catch (err) { next(err); }
});

// ─── Subjects (linked to Class) ──────────────────────────────────────────────

router.post('/subjects', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { classId, name, code, creditHours } = req.body;
    if (!classId || !name?.trim() || !code?.trim()) {
      throw new AppError('Class, subject name and code are required', 400);
    }
    await owned(prisma.academicClass, classId, instituteId);
    await assertUnique(
      prisma.subject,
      { instituteId, classId, code: code.trim().toUpperCase() },
      'Subject code already exists in this class',
    );
    const subject = await prisma.subject.create({
      data: {
        instituteId,
        classId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        creditHours: creditHours || 0,
      },
    });
    return success(res, subject, 'Subject created', 201);
  } catch (err) { next(err); }
});

router.put('/subjects/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const existing = await owned(prisma.subject, req.params.id, instituteId);
    const { classId, name, code, creditHours } = req.body;
    const cid = classId || existing.classId;
    if (code && cid) {
      await assertUnique(
        prisma.subject,
        { instituteId, classId: cid, code: code.trim().toUpperCase(), NOT: { id: req.params.id } },
        'Subject code already exists in this class',
      );
    }
    const subject = await prisma.subject.update({
      where: { id: req.params.id },
      data: {
        ...(classId !== undefined && { classId }),
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
    await prisma.teacherAssignment.deleteMany({ where: { subjectId: req.params.id, instituteId } });
    await prisma.attendance.deleteMany({ where: { subjectId: req.params.id, instituteId } });
    await prisma.result.deleteMany({ where: { subjectId: req.params.id, instituteId } });
    await prisma.timetable.deleteMany({ where: { subjectId: req.params.id, instituteId } });
    await prisma.subject.delete({ where: { id: req.params.id } });
    return success(res, null, 'Subject deleted');
  } catch (err) { next(err); }
});

// ─── Batches (linked to Session + Class; subjects inherited via Class) ────────

router.post('/batches', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, year, sessionId, classId, sectionName, capacity } = req.body;
    if (!name?.trim()) throw new AppError('Batch name is required', 400);
    if (!sessionId) throw new AppError('Academic session is required', 400);
    if (!classId) throw new AppError('Class is required', 400);
    await owned(prisma.session, sessionId, instituteId);
    await owned(prisma.academicClass, classId, instituteId);

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({
        data: {
          instituteId,
          name: name.trim(),
          year: year ? Number(year) : null,
          sessionId,
          classId,
        },
        include: {
          session: true,
          academicClass: { include: { department: true, subjects: true } },
        },
      });

      let section = null;
      if (sectionName?.trim()) {
        section = await tx.section.create({
          data: {
            instituteId,
            batchId: batch.id,
            name: sectionName.trim(),
            capacity: capacity != null && capacity !== '' ? Number(capacity) : null,
          },
        });
      }

      return { batch, section, inheritedSubjects: batch.academicClass?.subjects || [] };
    });

    return success(res, result, 'Batch created with class subjects', 201);
  } catch (err) { next(err); }
});

router.put('/batches/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.batch, req.params.id, instituteId);
    const { name, year, sessionId, classId } = req.body;
    if (name) {
      await assertUnique(prisma.batch, { instituteId, name: name.trim(), NOT: { id: req.params.id } }, 'A batch with this name already exists');
    }
    if (classId) await owned(prisma.academicClass, classId, instituteId);
    if (sessionId) await owned(prisma.session, sessionId, instituteId);
    const batch = await prisma.batch.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(year !== undefined && { year: year ? Number(year) : null }),
        ...(sessionId !== undefined && { sessionId: sessionId || null }),
        ...(classId !== undefined && { classId: classId || null }),
      },
      include: {
        session: true,
        academicClass: { include: { department: true, subjects: true } },
      },
    });
    return success(res, batch, 'Batch updated');
  } catch (err) { next(err); }
});

router.delete('/batches/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    await owned(prisma.batch, req.params.id, instituteId);
    const students = await prisma.student.count({ where: { currentBatchId: req.params.id, instituteId } });
    if (students) throw new AppError('Cannot delete: students are enrolled in this batch', 400);
    const sections = await prisma.section.findMany({ where: { batchId: req.params.id, instituteId }, select: { id: true } });
    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length) {
      await prisma.teacherAssignment.deleteMany({ where: { sectionId: { in: sectionIds }, instituteId } });
      await prisma.exam.updateMany({ where: { sectionId: { in: sectionIds }, instituteId }, data: { sectionId: null } });
    }
    await prisma.section.deleteMany({ where: { batchId: req.params.id, instituteId } });
    await prisma.batch.delete({ where: { id: req.params.id } });
    return success(res, null, 'Batch deleted');
  } catch (err) { next(err); }
});

router.get('/batches/:id/subjects', async (req, res, next) => {
  try {
    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: { academicClass: { include: { subjects: { orderBy: { name: 'asc' } } } } },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    return success(res, batch.academicClass?.subjects || []);
  } catch (err) { next(err); }
});

// ─── Sections ────────────────────────────────────────────────────────────────

router.post('/sections', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { batchId, name, capacity } = req.body;
    if (!batchId || !name?.trim()) throw new AppError('Batch and section name are required', 400);
    await owned(prisma.batch, batchId, instituteId);
    await assertUnique(prisma.section, { instituteId, batchId, name: name.trim() }, 'This section already exists for the batch');
    const section = await prisma.section.create({
      data: {
        instituteId,
        batchId,
        name: name.trim(),
        capacity: capacity != null && capacity !== '' ? Number(capacity) : null,
      },
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
      await assertUnique(prisma.section, { instituteId, batchId: bid, name: name.trim(), NOT: { id: req.params.id } }, 'This section already exists for the batch');
    }
    const section = await prisma.section.update({
      where: { id: req.params.id },
      data: {
        ...(batchId !== undefined && { batchId }),
        ...(name !== undefined && { name: name.trim() }),
        ...(capacity !== undefined && { capacity: capacity != null && capacity !== '' ? Number(capacity) : null }),
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
    await prisma.exam.updateMany({ where: { sectionId: req.params.id, instituteId }, data: { sectionId: null } });
    await prisma.section.delete({ where: { id: req.params.id } });
    return success(res, null, 'Section deleted');
  } catch (err) { next(err); }
});

export default router;
