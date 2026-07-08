import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { calculateCGPA, calculateSemesterGPA } from '../../../utils/grading.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.STUDENT_PORTAL));
router.use(blockExpiredModuleAccess);

async function getStudent(req) {
  const student = await prisma.student.findFirst({
    where: { userId: req.user.id, instituteId: req.user.instituteId },
    include: {
      currentBatch: { include: { session: true } },
      currentSection: true,
      institute: { select: { name: true } },
      degreeStudents: {
        where: { status: 'ACTIVE' },
        include: { batch: { include: { degree: true } } },
      },
    },
  });
  if (!student) throw new AppError('Student profile not found', 404);
  return student;
}

function attendancePct(records) {
  const total = records.length;
  const present = records.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
  return total ? Math.round((present / total) * 10000) / 100 : 0;
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const instituteId = req.user.instituteId;

    const [academicAttendance, degreeAttendance, recentResults, degreeResults, pendingFees] = await Promise.all([
      prisma.attendance.findMany({ where: { studentId: student.id, instituteId } }),
      prisma.degreeAttendance.findMany({ where: { studentId: student.id, instituteId } }),
      prisma.result.findMany({
        where: { studentId: student.id, instituteId, publishedAt: { not: null } },
        include: { exam: true, subject: true },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      }),
      prisma.degreeResult.findMany({
        where: {
          degreeStudent: { studentId: student.id },
          instituteId,
          publishedAt: { not: null },
        },
        include: { course: true, semester: true },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      }),
      prisma.fee.count({
        where: { studentId: student.id, instituteId, status: { in: ['PENDING', 'PARTIAL'] } },
      }),
    ]);

    const allAttendance = [...academicAttendance, ...degreeAttendance];
    const primaryDegree = student.degreeStudents?.[0];

    return success(res, {
      student,
      programType: student.currentBatchId ? (primaryDegree ? 'BOTH' : 'ACADEMIC') : (primaryDegree ? 'DEGREE' : 'ACADEMIC'),
      degreeEnrollment: primaryDegree || null,
      stats: {
        attendancePct: attendancePct(allAttendance),
        recentResultsCount: recentResults.length + degreeResults.length,
        pendingFees,
      },
      recentResults,
      recentDegreeResults: degreeResults,
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
    const instituteId = req.user.instituteId;

    const [results, degreeResults] = await Promise.all([
      prisma.result.findMany({
        where: { studentId: student.id, instituteId, publishedAt: { not: null } },
        include: { exam: true, subject: true },
        orderBy: [{ exam: { startDate: 'desc' } }, { subject: { name: 'asc' } }],
      }),
      prisma.degreeResult.findMany({
        where: {
          degreeStudent: { studentId: student.id },
          instituteId,
          publishedAt: { not: null },
        },
        include: { course: true, semester: true, degreeStudent: { include: { batch: { include: { degree: true } } } } },
        orderBy: [{ semester: { number: 'asc' } }, { course: { name: 'asc' } }],
      }),
    ]);

    const byExam = {};
    for (const r of results) {
      const key = r.examId;
      if (!byExam[key]) byExam[key] = { exam: r.exam, subjects: [], totalObtained: 0, totalMax: 0 };
      byExam[key].subjects.push(r);
      byExam[key].totalObtained += Number(r.totalMarks) || 0;
      byExam[key].totalMax += Number(r.maxMarks) || 0;
    }

    const bySemester = {};
    for (const r of degreeResults) {
      const key = r.semesterId;
      if (!bySemester[key]) {
        bySemester[key] = {
          semester: r.semester,
          degree: r.degreeStudent?.batch?.degree,
          batch: r.degreeStudent?.batch,
          subjects: [],
          gpa: 0,
        };
      }
      bySemester[key].subjects.push(r);
    }
    Object.values(bySemester).forEach((s) => {
      s.gpa = calculateSemesterGPA(s.subjects.map((r) => ({
        gradePoints: r.gradePoints,
        creditHours: r.course.creditHours,
        isPassed: r.isPassed,
      })));
    });

    const cgpa = calculateCGPA(results);
    const degreeCgpa = calculateCGPA(degreeResults.filter((r) => r.isPassed));
    return success(res, {
      results,
      byExam: Object.values(byExam),
      degreeResults,
      bySemester: Object.values(bySemester).sort((a, b) => a.semester.number - b.semester.number),
      cgpa,
      degreeCgpa,
    });
  } catch (err) { next(err); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const instituteId = req.user.instituteId;

    const degreeWhere = { studentId: student.id, instituteId };
    if (req.query.semesterNumber && student.degreeStudents?.length) {
      const ds = student.degreeStudents[0];
      const sem = await prisma.degreeSemester.findFirst({
        where: { batchId: ds.batchId, number: Number(req.query.semesterNumber) },
      });
      if (sem) {
        const courseIds = await prisma.degreeSemesterCourse.findMany({
          where: { semesterId: sem.id },
          select: { id: true },
        });
        degreeWhere.courseId = { in: courseIds.map((c) => c.id) };
      }
    }

    const [academicRecords, degreeRecords] = await Promise.all([
      prisma.attendance.findMany({
        where: { studentId: student.id, instituteId },
        include: { subject: true },
        orderBy: { date: 'desc' },
      }),
      prisma.degreeAttendance.findMany({
        where: degreeWhere,
        include: { course: { include: { semester: true } } },
        orderBy: { date: 'desc' },
      }),
    ]);

    const records = [
      ...academicRecords.map((r) => ({ ...r, source: 'ACADEMIC' })),
      ...degreeRecords.map((r) => ({ ...r, source: 'DEGREE' })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const absent = records.filter((r) => r.status === 'ABSENT').length;
    const late = records.filter((r) => r.status === 'LATE').length;

    const bySemester = {};
    for (const r of degreeRecords) {
      const n = r.course?.semester?.number || 'unknown';
      if (!bySemester[n]) bySemester[n] = { total: 0, present: 0, records: [] };
      bySemester[n].total += 1;
      if (r.status === 'PRESENT' || r.status === 'LATE') bySemester[n].present += 1;
      bySemester[n].records.push(r);
    }

    return success(res, {
      records,
      academicRecords,
      degreeRecords,
      bySemester,
      summary: {
        total, present, absent, late,
        percentage: total ? Math.round((present / total) * 10000) / 100 : 0,
      },
    });
  } catch (err) { next(err); }
});

router.get('/fees', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const fees = await prisma.fee.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId },
      include: {
        feeStructure: true,
        installments: { orderBy: { installmentNo: 'asc' } },
        degreeStudent: { include: { batch: { include: { degree: true } } } },
        individualCourseEnrollment: { include: { course: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const pending = fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL');
    const paid = fees.filter((f) => f.status === 'PAID');
    const installmentPlans = fees.filter((f) => f.installments?.length > 0).map((f) => ({
      parentFee: f,
      installments: f.installments,
      paidInstallments: f.installments.filter((i) => i.status === 'PAID'),
      remainingInstallments: f.installments.filter((i) => i.status !== 'PAID'),
      remainingBalance: f.installments
        .filter((i) => i.status !== 'PAID')
        .reduce((s, i) => s + Number(i.amount) - Number(i.discount || 0), 0),
    }));
    return success(res, { fees, pending, paid, history: paid, installmentPlans });
  } catch (err) { next(err); }
});

router.post('/fees/requests', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const { feeId, requestType, reason, installmentCount, extensionDays } = req.body;
    if (!requestType || !reason?.trim()) throw new AppError('requestType and reason are required', 400);

    const request = await prisma.feeRequest.create({
      data: {
        instituteId: req.user.instituteId,
        studentId: student.id,
        feeId: feeId || null,
        requestType,
        reason: reason.trim(),
        installmentCount: installmentCount || null,
        extensionDays: extensionDays || null,
      },
    });
    return success(res, request, 'Fee request submitted', 201);
  } catch (err) { next(err); }
});

router.get('/fees/requests', async (req, res, next) => {
  try {
    const student = await getStudent(req);
    const requests = await prisma.feeRequest.findMany({
      where: { studentId: student.id, instituteId: req.user.instituteId },
      include: { fee: { include: { feeStructure: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, requests);
  } catch (err) { next(err); }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const items = await prisma.announcement.findMany({
      where: { instituteId: req.user.instituteId },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    return success(res, items);
  } catch (err) { next(err); }
});

router.get('/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { instituteId: req.user.instituteId, createdById: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, tickets);
  } catch (err) { next(err); }
});

router.post('/tickets', async (req, res, next) => {
  try {
    const { subject, category, description, priority } = req.body;
    if (!subject || !description) throw new AppError('subject and description required', 400);
    const ticket = await prisma.supportTicket.create({
      data: {
        instituteId: req.user.instituteId,
        createdById: req.user.id,
        subject,
        category: category || 'OTHER',
        description,
        priority: priority || 'MEDIUM',
        escalatedToSuperAdmin: false,
      },
    });
    return success(res, ticket, 'Ticket submitted to your institute', 201);
  } catch (err) { next(err); }
});

router.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId, createdById: req.user.id },
      include: {
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { repliedBy: { select: { firstName: true, lastName: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    return success(res, ticket);
  } catch (err) { next(err); }
});

router.post('/tickets/:id/reply', async (req, res, next) => {
  try {
    const { message } = req.body;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId, createdById: req.user.id },
    });
    if (!ticket) throw new AppError('Ticket not found', 404);
    const reply = await prisma.ticketReply.create({
      data: { ticketId: ticket.id, repliedById: req.user.id, message: message.trim(), attachments: [] },
    });
    return success(res, reply, 'Reply sent', 201);
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
