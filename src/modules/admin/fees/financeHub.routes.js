import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';
import {
  getAcademicStudentFees,
  getDegreeStudentFees,
  getIndividualCourseStudentFees,
} from '../../../services/financeHub.service.js';
import { getEffectiveSemesterFee } from '../../../services/degreeFee.service.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.FEES_FINANCE));
router.use(blockExpiredModuleAccess);

router.get('/modules', async (req, res, next) => {
  try {
    const enabled = new Set(req.user.activeModules || []);
    const options = [
      { key: 'ACADEMIC', label: 'Academic', enabled: enabled.has(MODULE_KEYS.STUDENT_MANAGEMENT) },
      { key: 'DEGREE', label: 'Degree', enabled: enabled.has(MODULE_KEYS.DEGREE) },
      { key: 'INDIVIDUAL_COURSE', label: 'Individual Course', enabled: enabled.has(MODULE_KEYS.INDIVIDUAL_COURSES) },
    ].filter((o) => o.enabled);
    return success(res, options);
  } catch (err) { next(err); }
});

// ─── Academic ────────────────────────────────────────────────────────────────

router.get('/academic/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { instituteId: req.user.instituteId },
      orderBy: { startDate: 'desc' },
    });
    return success(res, sessions);
  } catch (err) { next(err); }
});

router.get('/academic/batches', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.sessionId) where.sessionId = req.query.sessionId;
    const batches = await prisma.batch.findMany({
      where,
      include: { session: true, _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, batches);
  } catch (err) { next(err); }
});

router.get('/academic/sections', async (req, res, next) => {
  try {
    if (!req.query.batchId) throw new AppError('batchId required', 400);
    const sections = await prisma.section.findMany({
      where: { instituteId: req.user.instituteId, batchId: req.query.batchId },
      include: { _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, sections);
  } catch (err) { next(err); }
});

router.get('/academic/students', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const where = { instituteId, deletedAt: null, status: 'ACTIVE' };
    if (req.query.sectionId) where.currentSectionId = req.query.sectionId;
    else if (req.query.batchId) where.currentBatchId = req.query.batchId;
    else throw new AppError('sectionId or batchId required', 400);

    const students = await prisma.student.findMany({
      where,
      include: {
        currentBatch: { include: { session: true } },
        currentSection: true,
        fees: {
          where: { degreeStudentId: null, individualCourseEnrollmentId: null },
          select: { status: true, amount: true, discount: true, fine: true },
        },
      },
      orderBy: { rollNumber: 'asc' },
    });

    const rows = students.map((s) => {
      const pending = s.fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL');
      const paid = s.fees.filter((f) => f.status === 'PAID');
      const paidAmt = paid.reduce((sum, f) => sum + Number(f.amount) - Number(f.discount || 0) + Number(f.fine || 0), 0);
      const dueAmt = pending.reduce((sum, f) => sum + Number(f.amount) - Number(f.discount || 0) + Number(f.fine || 0), 0);
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        rollNumber: s.rollNumber,
        batch: s.currentBatch,
        section: s.currentSection,
        paidAmount: paidAmt,
        dueAmount: dueAmt,
      };
    });
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/academic/students/:studentId/fees', async (req, res, next) => {
  try {
    const data = await getAcademicStudentFees(req.params.studentId, req.user.instituteId);
    if (!data) throw new AppError('Student not found', 404);
    return success(res, data);
  } catch (err) { next(err); }
});

// ─── Degree ──────────────────────────────────────────────────────────────────

router.get('/degree/programs', async (req, res, next) => {
  try {
    const degrees = await prisma.degree.findMany({
      where: { instituteId: req.user.instituteId, status: 'ACTIVE' },
      include: { _count: { select: { batches: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, degrees);
  } catch (err) { next(err); }
});

router.get('/degree/batches', async (req, res, next) => {
  try {
    if (!req.query.degreeId) throw new AppError('degreeId required', 400);
    const batches = await prisma.degreeBatch.findMany({
      where: { instituteId: req.user.instituteId, degreeId: req.query.degreeId },
      include: { _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, batches);
  } catch (err) { next(err); }
});

router.get('/degree/semesters', async (req, res, next) => {
  try {
    if (!req.query.batchId) throw new AppError('batchId required', 400);
    const batch = await prisma.degreeBatch.findFirst({
      where: { id: req.query.batchId, instituteId: req.user.instituteId },
    });
    if (!batch) throw new AppError('Batch not found', 404);
    const semesters = await prisma.degreeSemester.findMany({
      where: { batchId: batch.id, instituteId: req.user.instituteId },
      orderBy: { number: 'asc' },
    });
    return success(res, semesters.map((s) => ({
      ...s,
      effectiveFee: getEffectiveSemesterFee(batch, s),
    })));
  } catch (err) { next(err); }
});

router.get('/degree/students', async (req, res, next) => {
  try {
    if (!req.query.batchId) throw new AppError('batchId required', 400);
    const where = {
      instituteId: req.user.instituteId,
      batchId: req.query.batchId,
      status: { in: ['ACTIVE', 'SUSPENDED'] },
    };
    if (req.query.semesterNumber) {
      where.currentSemesterNumber = Number(req.query.semesterNumber);
    }

    const students = await prisma.degreeStudent.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
        fees: { select: { status: true, amount: true, discount: true } },
      },
      orderBy: { admittedAt: 'desc' },
    });

    const rows = students.map((ds) => {
      const pending = ds.fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL');
      const paid = ds.fees.filter((f) => f.status === 'PAID');
      return {
        id: ds.id,
        studentId: ds.studentId,
        student: ds.student,
        currentSemesterNumber: ds.currentSemesterNumber,
        netSemesterFee: ds.netSemesterFee,
        discount: ds.discount,
        scholarship: ds.scholarship,
        paidAmount: paid.reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0), 0),
        dueAmount: pending.reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0), 0),
      };
    });
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/degree/students/:degreeStudentId/fees', async (req, res, next) => {
  try {
    const data = await getDegreeStudentFees(req.params.degreeStudentId, req.user.instituteId);
    if (!data) throw new AppError('Degree student not found', 404);
    return success(res, data);
  } catch (err) { next(err); }
});

// ─── Individual Course ───────────────────────────────────────────────────────

router.get('/individual-courses/courses', async (req, res, next) => {
  try {
    const courses = await prisma.individualCourse.findMany({
      where: { instituteId: req.user.instituteId, status: { not: 'CANCELLED' } },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, courses);
  } catch (err) { next(err); }
});

router.get('/individual-courses/students', async (req, res, next) => {
  try {
    if (!req.query.courseId) throw new AppError('courseId required', 400);
    const enrollments = await prisma.individualCourseEnrollment.findMany({
      where: {
        instituteId: req.user.instituteId,
        courseId: req.query.courseId,
        status: { not: 'DROPPED' },
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } },
        fees: { select: { status: true, amount: true, discount: true } },
        course: true,
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const rows = enrollments.map((e) => {
      const pending = e.fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL');
      const paid = e.fees.filter((f) => f.status === 'PAID');
      return {
        id: e.id,
        studentId: e.studentId,
        student: e.student,
        course: e.course,
        feeDue: e.feeDue,
        paidAmount: paid.reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0), 0),
        dueAmount: pending.reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0), 0),
      };
    });
    return success(res, rows);
  } catch (err) { next(err); }
});

router.get('/individual-courses/enrollments/:enrollmentId/fees', async (req, res, next) => {
  try {
    const data = await getIndividualCourseStudentFees(req.params.enrollmentId, req.user.instituteId);
    if (!data) throw new AppError('Enrollment not found', 404);
    return success(res, data);
  } catch (err) { next(err); }
});

export default router;
