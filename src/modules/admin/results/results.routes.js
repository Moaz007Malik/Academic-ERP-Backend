import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { calculateCGPA, PAKISTANI_GRADE_SCALE } from '../../../utils/grading.js';
import { AppError } from '../../../utils/AppError.js';
import { enterResult, bulkEnterResults, getStudentResults, resolveGradeScale } from '../../../services/result.service.js';
import { requirePermission } from '../../../middleware/rbac.js';

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
      where: { examId: exam.id, instituteId: req.user.instituteId, track: 'ACADEMIC' },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ student: { rollNumber: 'asc' } }, { subject: { name: 'asc' } }],
    });
    const gradeScale = (await resolveGradeScale(req.user.instituteId)) || PAKISTANI_GRADE_SCALE;
    return success(res, { exam, results, gradeScale });
  } catch (err) { next(err); }
});

router.get('/student/:studentId', async (req, res, next) => {
  try {
    const results = await getStudentResults({
      instituteId: req.user.instituteId, studentId: req.params.studentId, track: 'ACADEMIC', publishedOnly: true,
    });
    const cgpa = calculateCGPA(results);
    return success(res, { results, cgpa });
  } catch (err) { next(err); }
});

router.post('/entry', requirePermission('ENTER_MARKS'), async (req, res, next) => {
  try {
    const { examId, subjectId, studentId, theoryMarks, practicalMarks, internalMarks } = req.body;
    if (!examId || !subjectId || !studentId) {
      throw new AppError('Exam, subject and student are required', 400);
    }

    const exam = await prisma.exam.findFirst({
      where: { id: examId, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const result = await enterResult({
      instituteId: req.user.instituteId, track: 'ACADEMIC', studentId, examId, subjectId,
      theoryMarks, practicalMarks, internalMarks,
      maxes: {
        theoryMax: Number(exam.theoryMax), practicalMax: Number(exam.practicalMax),
        internalMax: Number(exam.internalMax), passPercentage: Number(exam.passPercentage),
      },
      publish: exam.isPublished,
    });
    return success(res, result, 'Marks saved');
  } catch (err) { next(err); }
});

router.post('/bulk', requirePermission('ENTER_MARKS'), async (req, res, next) => {
  try {
    const { examId, subjectId, entries } = req.body;
    if (!examId || !subjectId || !Array.isArray(entries)) {
      throw new AppError('examId, subjectId and entries array required', 400);
    }

    const exam = await prisma.exam.findFirst({
      where: { id: examId, instituteId: req.user.instituteId },
    });
    if (!exam) throw new AppError('Exam not found', 404);

    const saved = await bulkEnterResults({
      instituteId: req.user.instituteId, track: 'ACADEMIC', entries, examId, subjectId,
      maxes: {
        theoryMax: Number(exam.theoryMax), practicalMax: Number(exam.practicalMax),
        internalMax: Number(exam.internalMax), passPercentage: Number(exam.passPercentage),
      },
      publish: exam.isPublished,
    });
    return success(res, saved, `${saved.length} results saved`);
  } catch (err) { next(err); }
});

export default router;
