import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.RESULTS_EXAMS));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.sectionId) where.sectionId = req.query.sectionId;
    if (req.query.semesterId) where.semesterId = req.query.semesterId;

    const exams = await prisma.exam.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        section: { include: { batch: true } },
        semester: true,
        _count: { select: { results: true } },
      },
    });
    return success(res, exams);
  } catch (err) { next(err); }
});

router.get('/:id/analytics', async (req, res, next) => {
  try {
    const exam = await prisma.exam.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: { section: { include: { batch: { include: { session: true } } } }, semester: true },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const results = await prisma.result.findMany({
      where: { examId: exam.id, instituteId: req.user.instituteId },
      include: { student: true, subject: true },
    });

    const byStudent = {};
    for (const r of results) {
      if (!byStudent[r.studentId]) {
        byStudent[r.studentId] = {
          student: r.student,
          subjects: [],
          totalObtained: 0,
          totalMax: 0,
        };
      }
      const obtained = Number(r.totalMarks || 0);
      const max = Number(r.maxMarks || 0);
      byStudent[r.studentId].subjects.push({
        subject: r.subject?.name,
        obtained,
        max,
        grade: r.grade,
        position: r.position,
        isPassed: r.isPassed,
      });
      byStudent[r.studentId].totalObtained += obtained;
      byStudent[r.studentId].totalMax += max;
    }

    const studentResults = Object.values(byStudent).map((s) => ({
      ...s,
      percentage: s.totalMax ? Math.round((s.totalObtained / s.totalMax) * 100) : 0,
    })).sort((a, b) => b.totalObtained - a.totalObtained);

    studentResults.forEach((s, i) => { s.rank = i + 1; });

    const marks = studentResults.map((s) => s.totalObtained).filter(Boolean);
    const stats = {
      totalStudents: studentResults.length,
      passed: studentResults.filter((s) => s.percentage >= (exam.passPercentage || 33)).length,
      failed: studentResults.filter((s) => s.percentage < (exam.passPercentage || 33)).length,
      highest: marks.length ? Math.max(...marks) : 0,
      lowest: marks.length ? Math.min(...marks) : 0,
      average: marks.length ? Math.round(marks.reduce((a, b) => a + b, 0) / marks.length) : 0,
    };

    return success(res, { exam, studentResults, stats });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const exam = await prisma.exam.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: { section: { include: { batch: true } }, semester: true },
    });
    if (!exam) throw new AppError('Exam not found', 404);
    return success(res, exam);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      name, examType, sectionId, semesterId, startDate, endDate,
      theoryMax, practicalMax, internalMax, passPercentage,
    } = req.body;
    if (!name) throw new AppError('Exam name is required', 400);

    const dupWhere = {
      instituteId: req.user.instituteId,
      name: name.trim(),
      examType: examType || 'FINAL',
      sectionId: sectionId || null,
    };
    const existing = await prisma.exam.findFirst({ where: dupWhere });
    if (existing) throw new AppError('An exam with this name already exists for this class', 409);

    const exam = await prisma.exam.create({
      data: {
        instituteId: req.user.instituteId,
        name: name.trim(),
        examType: examType || 'FINAL',
        sectionId: sectionId || null,
        semesterId: semesterId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        theoryMax: theoryMax ?? 75,
        practicalMax: practicalMax ?? 15,
        internalMax: internalMax ?? 10,
        passPercentage: passPercentage ?? 33,
      },
      include: { section: true, semester: true },
    });
    return success(res, exam, 'Exam created', 201);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.exam.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Exam not found', 404);

    const { name, examType, sectionId, semesterId, startDate, endDate, theoryMax, practicalMax, internalMax, passPercentage } = req.body;
    const exam = await prisma.exam.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(examType !== undefined && { examType }),
        ...(sectionId !== undefined && { sectionId: sectionId || null }),
        ...(semesterId !== undefined && { semesterId: semesterId || null }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(theoryMax !== undefined && { theoryMax }),
        ...(practicalMax !== undefined && { practicalMax }),
        ...(internalMax !== undefined && { internalMax }),
        ...(passPercentage !== undefined && { passPercentage }),
      },
    });
    return success(res, exam, 'Exam updated');
  } catch (err) { next(err); }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const exam = await prisma.exam.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    await prisma.$transaction([
      prisma.exam.update({ where: { id: exam.id }, data: { isPublished: true } }),
      prisma.result.updateMany({
        where: { examId: exam.id, instituteId: req.user.instituteId },
        data: { publishedAt: new Date() },
      }),
    ]);
    return success(res, { isPublished: true }, 'Results published');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const exam = await prisma.exam.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);
    if (exam.isPublished) throw new AppError('Cannot delete a published exam', 400);

    await prisma.$transaction([
      prisma.result.deleteMany({ where: { examId: exam.id, instituteId: req.user.instituteId } }),
      prisma.exam.delete({ where: { id: exam.id } }),
    ]);
    return success(res, null, 'Exam deleted');
  } catch (err) { next(err); }
});

export default router;
