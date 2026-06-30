import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { computeResult, calculateCGPA } from '../../../utils/grading.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.RESULTS_EXAMS));
router.use(blockExpiredModuleAccess);

router.get('/exam/:examId', async (req, res, next) => {
  try {
    const exam = await prisma.exam.findFirst({
      where: { id: req.params.examId, instituteId: req.user.instituteId },
      include: { section: { include: { batch: true } } },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const results = await prisma.result.findMany({
      where: { examId: exam.id, instituteId: req.user.instituteId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ student: { rollNumber: 'asc' } }, { subject: { name: 'asc' } }],
    });
    return success(res, { exam, results });
  } catch (err) { next(err); }
});

router.get('/student/:studentId', async (req, res, next) => {
  try {
    const results = await prisma.result.findMany({
      where: {
        studentId: req.params.studentId,
        instituteId: req.user.instituteId,
        publishedAt: { not: null },
      },
      include: {
        exam: true,
        subject: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const cgpa = calculateCGPA(results);
    return success(res, { results, cgpa });
  } catch (err) { next(err); }
});

router.post('/entry', async (req, res, next) => {
  try {
    const { examId, subjectId, studentId, theoryMarks, practicalMarks, internalMarks } = req.body;
    if (!examId || !subjectId || !studentId) {
      throw new AppError('Exam, subject and student are required', 400);
    }

    const exam = await prisma.exam.findFirst({
      where: { id: examId, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const computed = computeResult({
      theoryMarks, practicalMarks, internalMarks,
      theoryMax: Number(exam.theoryMax),
      practicalMax: Number(exam.practicalMax),
      internalMax: Number(exam.internalMax),
      passPercentage: Number(exam.passPercentage),
    });

    const result = await prisma.result.upsert({
      where: {
        instituteId_studentId_subjectId_examId: {
          instituteId: req.user.instituteId,
          studentId,
          subjectId,
          examId,
        },
      },
      create: {
        instituteId: req.user.instituteId,
        studentId,
        subjectId,
        examId,
        theoryMarks: computed.theoryMarks,
        practicalMarks: computed.practicalMarks,
        internalMarks: computed.internalMarks,
        totalMarks: computed.totalMarks,
        maxMarks: computed.maxMarks,
        grade: computed.grade,
        gradePoints: computed.gradePoints,
        isPassed: computed.isPassed,
        publishedAt: exam.isPublished ? new Date() : null,
      },
      update: {
        theoryMarks: computed.theoryMarks,
        practicalMarks: computed.practicalMarks,
        internalMarks: computed.internalMarks,
        totalMarks: computed.totalMarks,
        maxMarks: computed.maxMarks,
        grade: computed.grade,
        gradePoints: computed.gradePoints,
        isPassed: computed.isPassed,
      },
      include: {
        student: { select: { firstName: true, lastName: true, rollNumber: true } },
        subject: true,
      },
    });
    return success(res, result, 'Marks saved');
  } catch (err) { next(err); }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const { examId, subjectId, entries } = req.body;
    if (!examId || !subjectId || !Array.isArray(entries)) {
      throw new AppError('examId, subjectId and entries array required', 400);
    }

    const exam = await prisma.exam.findFirst({
      where: { id: examId, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const saved = [];
    for (const entry of entries) {
      const computed = computeResult({
        theoryMarks: entry.theoryMarks,
        practicalMarks: entry.practicalMarks,
        internalMarks: entry.internalMarks,
        theoryMax: Number(exam.theoryMax),
        practicalMax: Number(exam.practicalMax),
        internalMax: Number(exam.internalMax),
        passPercentage: Number(exam.passPercentage),
      });

      const result = await prisma.result.upsert({
        where: {
          instituteId_studentId_subjectId_examId: {
            instituteId: req.user.instituteId,
            studentId: entry.studentId,
            subjectId,
            examId,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          studentId: entry.studentId,
          subjectId,
          examId,
          theoryMarks: computed.theoryMarks,
          practicalMarks: computed.practicalMarks,
          internalMarks: computed.internalMarks,
          totalMarks: computed.totalMarks,
          maxMarks: computed.maxMarks,
          grade: computed.grade,
          gradePoints: computed.gradePoints,
          isPassed: computed.isPassed,
          publishedAt: exam.isPublished ? new Date() : null,
        },
        update: {
          theoryMarks: computed.theoryMarks,
          practicalMarks: computed.practicalMarks,
          internalMarks: computed.internalMarks,
          totalMarks: computed.totalMarks,
          maxMarks: computed.maxMarks,
          grade: computed.grade,
          gradePoints: computed.gradePoints,
          isPassed: computed.isPassed,
        },
      });
      saved.push(result);
    }
    return success(res, saved, `${saved.length} results saved`);
  } catch (err) { next(err); }
});

export default router;
