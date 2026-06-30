import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.ATTENDANCE));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { date, sectionId, subjectId, studentId } = req.query;
    const where = { instituteId: req.user.instituteId };
    if (date) where.date = new Date(date);
    if (subjectId) where.subjectId = subjectId;
    if (studentId) where.studentId = studentId;

    const records = await prisma.attendance.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true, currentSectionId: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: { date: 'desc' },
    });

    let filtered = records;
    if (sectionId) {
      filtered = records.filter((r) => r.student.currentSectionId === sectionId);
    }
    return success(res, filtered);
  } catch (err) { next(err); }
});

router.get('/summary/:studentId', async (req, res, next) => {
  try {
    const records = await prisma.attendance.findMany({
      where: { studentId: req.params.studentId, instituteId: req.user.instituteId },
    });
    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT').length;
    const absent = records.filter((r) => r.status === 'ABSENT').length;
    const late = records.filter((r) => r.status === 'LATE').length;
    const percentage = total ? Math.round((present / total) * 10000) / 100 : 0;
    return success(res, { total, present, absent, late, percentage });
  } catch (err) { next(err); }
});

router.post('/mark', async (req, res, next) => {
  try {
    const { date, subjectId, sectionId, records } = req.body;
    if (!date || !subjectId || !Array.isArray(records)) {
      throw new AppError('date, subjectId and records required', 400);
    }

    const students = sectionId
      ? await prisma.student.findMany({
        where: { instituteId: req.user.instituteId, currentSectionId: sectionId, status: 'ACTIVE' },
      })
      : [];

    const studentIds = new Set(students.map((s) => s.id));
    const saved = [];

    for (const rec of records) {
      if (sectionId && !studentIds.has(rec.studentId)) continue;
      const attendance = await prisma.attendance.upsert({
        where: {
          instituteId_studentId_subjectId_date_lectureNumber: {
            instituteId: req.user.instituteId,
            studentId: rec.studentId,
            subjectId,
            date: new Date(date),
            lectureNumber: rec.lectureNumber || 1,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          studentId: rec.studentId,
          subjectId,
          date: new Date(date),
          lectureNumber: rec.lectureNumber || 1,
          status: rec.status || 'PRESENT',
          markedById: req.user.id,
        },
        update: {
          status: rec.status || 'PRESENT',
          markedById: req.user.id,
        },
      });
      saved.push(attendance);
    }
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

export default router;
