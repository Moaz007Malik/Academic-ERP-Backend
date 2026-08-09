import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';
import { expandAcademicAssignmentsToSections } from '../../../services/teacherAssignment.service.js';
import { markAttendance } from '../../../services/attendance.service.js';
import { bulkEnterResults, resolveGradeScale } from '../../../services/result.service.js';
import { PAKISTANI_GRADE_SCALE } from '../../../utils/grading.js';
import { getScheduleForDate, getEffectiveTeacher } from '../../../services/timetable.service.js';

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
          academicClass: true,
          section: { include: { batch: true, students: { where: { status: 'ACTIVE' } } } },
          degreeCourse: { include: { semester: { include: { batch: { include: { degree: true } } } } } },
          individualCourse: {
            include: { enrollments: { where: { status: 'ENROLLED' }, include: { student: true } } },
          },
        },
      },
    },
  });
  if (!teacher) throw new AppError('Teacher profile not found', 404);

  const academicAssignments = teacher.assignments.filter((a) => a.track === 'ACADEMIC');
  const expandedClasses = await expandAcademicAssignmentsToSections({
    instituteId: req.user.instituteId, assignments: academicAssignments,
  });
  const individualCourseAssignments = teacher.assignments.filter((a) => a.track === 'INDIVIDUAL_COURSE');
  const degreeCourseAssignments = teacher.assignments.filter((a) => a.track === 'DEGREE');

  return { ...teacher, academicAssignments, expandedClasses, individualCourseAssignments, degreeCourseAssignments };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.expandedClasses.map((c) => c.sectionId))];
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
    const todaySchedule = await getScheduleForDate({ instituteId: req.user.instituteId, date: new Date(), teacherId: teacher.id });
    return success(res, {
      teacher: { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName, employeeCode: teacher.employeeCode },
      assignments: teacher.academicAssignments,
      individualCourses: teacher.individualCourseAssignments.map((a) => a.individualCourse),
      degreeCourses: teacher.degreeCourseAssignments.map((a) => a.degreeCourse),
      stats: {
        classesCount: sectionIds.length,
        subjectsCount: teacher.academicAssignments.length,
        studentCount,
        individualCoursesCount: teacher.individualCourseAssignments.length,
        degreeCoursesCount: teacher.degreeCourseAssignments.length,
      },
      upcomingExams,
      todaySchedule,
    });
  } catch (err) { next(err); }
});

router.get('/classes', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionsMap = new Map();
    for (const c of teacher.expandedClasses) {
      if (!sectionsMap.has(c.sectionId)) {
        sectionsMap.set(c.sectionId, { section: c.section, subjects: [] });
      }
      sectionsMap.get(c.sectionId).subjects.push(c.subjectId);
    }
    const subjectIds = [...new Set(teacher.expandedClasses.map((c) => c.subjectId))];
    const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds } } });
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    for (const entry of sectionsMap.values()) {
      entry.subjects = entry.subjects.map((id) => subjectById.get(id)).filter(Boolean);
    }
    return success(res, [...sectionsMap.values()]);
  } catch (err) { next(err); }
});

router.get('/students', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = new Set(teacher.expandedClasses.map((c) => c.sectionId));

    // Also include sections the teacher is substituting in today, so a substitute (who has no
    // permanent TeacherAssignment for that section) still sees the roster when marking attendance.
    const todaySubstitutions = await prisma.timetableSubstitution.findMany({
      where: { instituteId: req.user.instituteId, substituteTeacherId: teacher.id, date: new Date(new Date().toISOString().slice(0, 10)) },
      include: { timetable: { select: { sectionId: true, track: true } } },
    });
    todaySubstitutions
      .filter((s) => s.timetable.track === 'ACADEMIC' && s.timetable.sectionId)
      .forEach((s) => sectionIds.add(s.timetable.sectionId));

    const students = await prisma.student.findMany({
      where: { instituteId: req.user.instituteId, currentSectionId: { in: [...sectionIds] }, status: 'ACTIVE' },
      include: { currentBatch: true, currentSection: true },
      orderBy: { rollNumber: 'asc' },
    });
    return success(res, students);
  } catch (err) { next(err); }
});

router.post('/attendance/mark', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const { date, timetableId, records } = req.body;
    let { subjectId, sectionId } = req.body;

    if (timetableId) {
      // Timetable-driven path: lets a substitute teacher (assigned via TimetableSubstitution,
      // not a permanent TeacherAssignment) mark attendance for the slot they're covering today.
      const slot = await prisma.timetable.findFirst({
        where: { id: timetableId, instituteId: req.user.instituteId, track: 'ACADEMIC' },
      });
      if (!slot) throw new AppError('Timetable slot not found', 404);
      subjectId = slot.subjectId;
      sectionId = slot.sectionId;
      const effective = await getEffectiveTeacher({ instituteId: req.user.instituteId, timetableId, date });
      if (effective?.teacherId !== teacher.id) {
        throw new AppError('You are not the assigned or substitute teacher for this slot today', 403);
      }
    } else {
      const allowed = teacher.expandedClasses.some((c) => c.subjectId === subjectId && c.sectionId === sectionId);
      if (!allowed) throw new AppError('Not assigned to this class/subject', 403);
    }

    const saved = await markAttendance({
      instituteId: req.user.instituteId, track: 'ACADEMIC',
      date, subjectId, sectionId, records: records || [], markedById: req.user.id,
    });
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const subjectIds = [...new Set(teacher.expandedClasses.map((c) => c.subjectId))];
    const records = await prisma.attendance.findMany({
      where: {
        instituteId: req.user.instituteId,
        track: 'ACADEMIC',
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
    const allowed = teacher.expandedClasses.some((c) => c.subjectId === subjectId && c.sectionId === sectionId);
    if (!allowed) throw new AppError('Not assigned to this class/subject', 403);

    const exam = await prisma.exam.findFirst({ where: { id: examId, instituteId: req.user.instituteId } });
    if (!exam) throw new AppError('Exam not found', 404);

    const saved = await bulkEnterResults({
      instituteId: req.user.instituteId, track: 'ACADEMIC', entries: entries || [], examId, subjectId,
      maxes: {
        theoryMax: Number(exam.theoryMax), practicalMax: Number(exam.practicalMax),
        internalMax: Number(exam.internalMax), passPercentage: Number(exam.passPercentage),
      },
      publish: exam.isPublished,
    });
    return success(res, saved, 'Marks saved');
  } catch (err) { next(err); }
});

router.get('/exams', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.expandedClasses.map((c) => c.sectionId))];
    const exams = await prisma.exam.findMany({
      where: { instituteId: req.user.instituteId, sectionId: { in: sectionIds } },
      include: { section: { include: { batch: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const gradeScale = (await resolveGradeScale(req.user.instituteId)) || PAKISTANI_GRADE_SCALE;
    return success(res, { exams, gradeScale });
  } catch (err) { next(err); }
});

router.get('/timetable', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const sectionIds = [...new Set(teacher.expandedClasses.map((c) => c.sectionId))];
    const timetable = await prisma.timetable.findMany({
      where: {
        instituteId: req.user.instituteId,
        OR: [
          { teacherId: teacher.id },
          { sectionId: { in: sectionIds } },
        ],
      },
      include: {
        subject: true,
        section: { include: { batch: true } },
        degreeCourse: { include: { semester: true } },
        individualCourse: true,
      },
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

    const { events } = await import('../../../events/eventBus.js');
    await events.ticketCreated({
      aggregateId: ticket.id,
      instituteId: req.user.instituteId,
      payload: {
        subject, priority: priority || 'MEDIUM',
        createdByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        actorId: req.user.id,
      },
    }).catch(() => {});

    return success(res, ticket, 'Ticket submitted to your institute', 201);
  } catch (err) { next(err); }
});

router.get('/announcements', async (req, res, next) => {
  try {
    const items = await prisma.announcement.findMany({
      where: { instituteId: req.user.instituteId },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    return success(res, items);
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
    const allowed = teacher.degreeCourseAssignments.some((a) => a.degreeCourseId === courseId);
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
    const allowed = teacher.individualCourseAssignments.some((a) => a.individualCourseId === courseId);
    if (!allowed) throw new AppError('Not assigned to this individual course', 403);

    const { date, records } = req.body;
    const saved = await markAttendance({
      instituteId: req.user.instituteId, track: 'INDIVIDUAL_COURSE',
      date, individualCourseId: courseId, records: records || [], markedById: req.user.id,
    });
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

router.post('/degree-courses/:courseId/attendance/mark', async (req, res, next) => {
  try {
    const teacher = await getTeacher(req);
    const courseId = req.params.courseId;
    const allowed = teacher.degreeCourseAssignments.some((a) => a.degreeCourseId === courseId);
    if (!allowed) throw new AppError('Not assigned to this degree course', 403);

    const { date, records } = req.body;
    const saved = await markAttendance({
      instituteId: req.user.instituteId, track: 'DEGREE',
      date, degreeCourseId: courseId, records: records || [], markedById: req.user.id,
    });
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

export default router;
