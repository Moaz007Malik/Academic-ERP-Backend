import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.TEACHER_PORTAL));
router.use(blockExpiredModuleAccess);

async function getTeacher(req) {
  const teacher = await prisma.teacher.findFirst({
    where: { userId: req.user.id, instituteId: req.user.instituteId },
    include: {
      assignments: {
        include: {
          subject: true,
          section: { include: { batch: true, students: { where: { status: 'ACTIVE' } } } },
        },
      },
      individualCourses: {
        include: {
          course: {
            include: {
              enrollments: {
                where: { status: 'ENROLLED' },
                include: { student: true },
              },
            },
          },
        },
      },
      degreeCourseTeachers: {
        include: {
          course: {
            include: {
              semester: { include: { batch: { include: { degree: true } } } },
            },
          },
        },
      },
    },
  });
  if (!teacher) throw new AppError('Teacher profile not found', 404);
  return teacher;
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.assignments.map((a) => a.sectionId))];
    const studentCount = await prisma.student.count({
      where: { instituteId: req.user.instituteId, currentSectionId: { in: sectionIds }, status: 'ACTIVE' },
    });
    const upcomingExams = await prisma.exam.findMany({
      where: {
        instituteId: req.user.instituteId,
        sectionId: { in: sectionIds },
        isPublished: false,
      },
      take: 5,
      orderBy: { startDate: 'asc' },
    });
    const icCount = teacher.individualCourses?.length || 0;
    const degreeCount = teacher.degreeCourseTeachers?.length || 0;
    return success(res, {
      teacher: { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName, employeeCode: teacher.employeeCode },
      assignments: teacher.assignments,
      individualCourses: teacher.individualCourses?.map((ic) => ic.course) || [],
      degreeCourses: teacher.degreeCourseTeachers?.map((d) => d.course) || [],
      stats: {
        classesCount: sectionIds.length,
        subjectsCount: teacher.assignments.length,
        studentCount,
        individualCoursesCount: icCount,
        degreeCoursesCount: degreeCount,
      },
      upcomingExams,
    });
  } catch (err) { next(err); }
});

router.get('/classes', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionsMap = new Map();
    for (const a of teacher.assignments) {
      if (!sectionsMap.has(a.sectionId)) {
        sectionsMap.set(a.sectionId, {
          section: a.section,
          subjects: [],
        });
      }
      sectionsMap.get(a.sectionId).subjects.push(a.subject);
    }
    return success(res, [...sectionsMap.values()]);
  } catch (err) { next(err); }
});

router.get('/students', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.assignments.map((a) => a.sectionId))];
    const students = await prisma.student.findMany({
      where: { instituteId: req.user.instituteId, currentSectionId: { in: sectionIds }, status: 'ACTIVE' },
      include: { currentBatch: true, currentSection: true },
      orderBy: { rollNumber: 'asc' },
    });
    return success(res, students);
  } catch (err) { next(err); }
});

router.post('/attendance/mark', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const { date, subjectId, sectionId, records } = req.body;
    const allowed = teacher.assignments.some((a) => a.subjectId === subjectId && a.sectionId === sectionId);
    if (!allowed) throw new AppError('Not assigned to this class/subject', 403);

    const saved = [];
    for (const rec of records || []) {
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
        update: { status: rec.status || 'PRESENT', markedById: req.user.id },
      });
      saved.push(attendance);
    }
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const subjectIds = teacher.assignments.map((a) => a.subjectId);
    const records = await prisma.attendance.findMany({
      where: {
        instituteId: req.user.instituteId,
        subjectId: { in: subjectIds },
        ...(req.query.date && { date: new Date(req.query.date) }),
      },
      include: {
        student: { select: { firstName: true, lastName: true, rollNumber: true } },
        subject: true,
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
    return success(res, records);
  } catch (err) { next(err); }
});

router.post('/marks', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const { examId, subjectId, sectionId, entries } = req.body;
    const allowed = teacher.assignments.some((a) => a.subjectId === subjectId && a.sectionId === sectionId);
    if (!allowed) throw new AppError('Not assigned to this class/subject', 403);

    const exam = await prisma.exam.findFirst({ where: { id: examId, instituteId: req.user.instituteId } });
    if (!exam) throw new AppError('Exam not found', 404);

    const { computeResult } = await import('../../../utils/grading.js');
    const saved = [];
    for (const entry of entries || []) {
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
    return success(res, saved, 'Marks saved');
  } catch (err) { next(err); }
});

router.get('/exams', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.assignments.map((a) => a.sectionId))];
    const exams = await prisma.exam.findMany({
      where: { instituteId: req.user.instituteId, sectionId: { in: sectionIds } },
      include: { section: { include: { batch: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, exams);
  } catch (err) { next(err); }
});

router.get('/timetable', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.assignments.map((a) => a.sectionId))];
    const timetable = await prisma.timetable.findMany({
      where: {
        instituteId: req.user.instituteId,
        OR: [
          { teacherId: teacher.id },
          { sectionId: { in: sectionIds } },
        ],
      },
      include: { subject: true, section: { include: { batch: true } } },
      orderBy: [{ dayOfWeek: 'asc' }],
    });
    return success(res, timetable);
  } catch (err) { next(err); }
});

router.get('/salary', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const salaries = await prisma.salary.findMany({
      where: { teacherId: teacher.id, instituteId: req.user.instituteId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return success(res, salaries);
  } catch (err) { next(err); }
});

router.get('/leave', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const leaves = await prisma.leaveRequest.findMany({
      where: { teacherId: teacher.id, instituteId: req.user.instituteId },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, leaves);
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

router.post('/leave', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const { leaveType, startDate, endDate, reason } = req.body;
    if (!leaveType || !startDate || !endDate) throw new AppError('leaveType, startDate, endDate required', 400);
    const leave = await prisma.leaveRequest.create({
      data: {
        instituteId: req.user.instituteId,
        userId: req.user.id,
        teacherId: teacher.id,
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason: reason || null,
      },
    });
    return success(res, leave, 'Leave request submitted', 201);
  } catch (err) { next(err); }
});

router.get('/attendance/self', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const records = await prisma.attendance.findMany({
      where: {
        instituteId: req.user.instituteId,
        markedById: req.user.id,
      },
      distinct: ['date'],
      orderBy: { date: 'desc' },
      take: 30,
    });
    return success(res, { teacherId: teacher.id, recentMarkingDays: records.length });
  } catch (err) { next(err); }
});

router.get('/degree-courses/:courseId/students', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const courseId = req.params.courseId;
    const allowed = teacher.degreeCourseTeachers?.some((d) => d.courseId === courseId);
    if (!allowed) throw new AppError('Not assigned to this degree course', 403);

    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: courseId, instituteId: req.user.instituteId },
      include: { semester: true },
    });
    if (!course) throw new AppError('Course not found', 404);

    const students = await prisma.degreeStudent.findMany({
      where: {
        batchId: course.semester.batchId,
        currentSemesterNumber: course.semester.number,
        status: 'ACTIVE',
      },
      include: { student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } } },
    });
    return success(res, students);
  } catch (err) { next(err); }
});

router.post('/individual-courses/:courseId/attendance/mark', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const courseId = req.params.courseId;
    const allowed = teacher.individualCourses?.some((ic) => ic.courseId === courseId);
    if (!allowed) throw new AppError('Not assigned to this individual course', 403);

    const { date, records } = req.body;
    const saved = [];
    for (const rec of records || []) {
      const row = await prisma.individualCourseAttendance.upsert({
        where: {
          instituteId_courseId_studentId_date_lectureNumber: {
            instituteId: req.user.instituteId,
            courseId,
            studentId: rec.studentId,
            date: new Date(date),
            lectureNumber: rec.lectureNumber || 1,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          courseId,
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

router.post('/degree-courses/:courseId/attendance/mark', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const courseId = req.params.courseId;
    const allowed = teacher.degreeCourseTeachers?.some((d) => d.courseId === courseId);
    if (!allowed) throw new AppError('Not assigned to this degree course', 403);

    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: courseId, instituteId: req.user.instituteId },
      include: { semester: true },
    });
    if (!course) throw new AppError('Course not found', 404);

    const { date, records } = req.body;
    const enrolled = await prisma.degreeStudent.findMany({
      where: {
        batchId: course.semester.batchId,
        currentSemesterNumber: course.semester.number,
        status: 'ACTIVE',
      },
    });
    const byStudent = new Map(enrolled.map((e) => [e.studentId, e.id]));
    const saved = [];

    for (const rec of records || []) {
      const degreeStudentId = byStudent.get(rec.studentId);
      if (!degreeStudentId) continue;
      const row = await prisma.degreeAttendance.upsert({
        where: {
          instituteId_courseId_studentId_date_lectureNumber: {
            instituteId: req.user.instituteId,
            courseId,
            studentId: rec.studentId,
            date: new Date(date),
            lectureNumber: rec.lectureNumber || 1,
          },
        },
        create: {
          instituteId: req.user.instituteId,
          courseId,
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

export default router;
