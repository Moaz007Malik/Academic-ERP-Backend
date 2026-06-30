import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { calculateCGPA } from '../../../utils/grading.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(blockExpiredModuleAccess);

async function getStudent(req) {
  const student = await prisma.student.findFirst({
    where: { userId: req.user.id, instituteId: req.user.instituteId },
    include: { currentBatch: true, currentSection: true, institute: { select: { name: true } } },
  });
  if (!student) throw new AppError('Student profile not found', 404);
  return student;
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const attendance = await prisma.attendance.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId },
    });
    const total = attendance.length;
    const present = attendance.filter((a) => a.status === 'PRESENT').length;
    const attendancePct = total ? Math.round((present / total) * 10000) / 100 : 0;

    const recentResults = await prisma.result.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId, publishedAt: { not: null } },
      include: { exam: true, subject: true },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });

    const pendingFees = await prisma.fee.count({
      where: { studentId: student.id, instituteId: req.user.instituteId, status: 'PENDING' },
    });

    return success(res, {
      student,
      stats: { attendancePct, recentResultsCount: recentResults.length, pendingFees },
      recentResults,
    });
  } catch (err) { next(err); }
});

router.get('/profile', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    return success(res, student);
  } catch (err) { next(err); }
});

router.get('/results', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const results = await prisma.result.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId, publishedAt: { not: null } },
      include: { exam: true, subject: true },
      orderBy: [{ exam: { startDate: 'desc' } }, { subject: { name: 'asc' } }],
    });

    const byExam = {};
    for (const r of results) {
      const key = r.examId;
      if (!byExam[key]) byExam[key] = { exam: r.exam, subjects: [], totalObtained: 0, totalMax: 0 };
      byExam[key].subjects.push(r);
      byExam[key].totalObtained += Number(r.totalMarks) || 0;
      byExam[key].totalMax += Number(r.maxMarks) || 0;
    }

    const cgpa = calculateCGPA(results);
    return success(res, { results, byExam: Object.values(byExam), cgpa });
  } catch (err) { next(err); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const records = await prisma.attendance.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId },
      include: { subject: true },
      orderBy: { date: 'desc' },
    });
    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT').length;
    const absent = records.filter((r) => r.status === 'ABSENT').length;
    const late = records.filter((r) => r.status === 'LATE').length;
    return success(res, {
      records,
      summary: { total, present, absent, late, percentage: total ? Math.round((present / total) * 10000) / 100 : 0 },
    });
  } catch (err) { next(err); }
});

router.get('/fees', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const fees = await prisma.fee.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId },
      include: { feeStructure: true },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, fees);
  } catch (err) { next(err); }
});

router.get('/timetable', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    if (!student.currentSectionId) return success(res, []);

    const timetable = await prisma.timetable.findMany({
      where: { instituteId: req.user.instituteId, sectionId: student.currentSectionId },
      include: { subject: true, teacher: { select: { firstName: true, lastName: true } } },
      orderBy: [{ dayOfWeek: 'asc' }],
    });
    return success(res, timetable);
  } catch (err) { next(err); }
});

export default router;
