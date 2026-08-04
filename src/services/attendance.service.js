import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';

/** Resolves which students are eligible to be marked for a given track+scope, and (for
 * Degree) the studentId -> degreeStudentId map needed to populate Attendance.degreeStudentId. */
export async function resolveEligibleStudents({ instituteId, track, sectionId, degreeCourseId, individualCourseId }) {
  if (track === 'DEGREE') {
    const course = await prisma.degreeSemesterCourse.findFirst({
      where: { id: degreeCourseId, instituteId },
      include: { semester: true },
    });
    if (!course) throw new AppError('Course not found', 404);
    const enrolled = await prisma.degreeStudent.findMany({
      where: {
        batchId: course.semester.batchId,
        instituteId,
        status: 'ACTIVE',
        currentSemesterNumber: { gte: course.semester.number },
      },
    });
    return { course, degreeStudentIdByStudentId: new Map(enrolled.map((e) => [e.studentId, e.id])) };
  }
  if (track === 'INDIVIDUAL_COURSE') {
    const course = await prisma.individualCourse.findFirst({ where: { id: individualCourseId, instituteId } });
    if (!course) throw new AppError('Course not found', 404);
    const enrolled = await prisma.individualCourseEnrollment.findMany({
      where: { courseId: individualCourseId, status: 'ENROLLED' },
      select: { studentId: true },
    });
    return { course, eligibleStudentIds: new Set(enrolled.map((e) => e.studentId)) };
  }
  // ACADEMIC
  if (!sectionId) return { course: null, eligibleStudentIds: null };
  const students = await prisma.student.findMany({
    where: { instituteId, currentSectionId: sectionId, status: 'ACTIVE' },
  });
  return { course: null, eligibleStudentIds: new Set(students.map((s) => s.id)) };
}

export async function markAttendance({
  instituteId, track = 'ACADEMIC', date, records, markedById,
  subjectId, sectionId, degreeCourseId, individualCourseId,
}) {
  if (!date || !Array.isArray(records)) throw new AppError('date and records required', 400);
  if (track === 'ACADEMIC' && !subjectId) throw new AppError('subjectId is required for academic attendance', 400);
  if (track === 'DEGREE' && !degreeCourseId) throw new AppError('degreeCourseId is required for degree attendance', 400);
  if (track === 'INDIVIDUAL_COURSE' && !individualCourseId) throw new AppError('individualCourseId is required', 400);

  const { degreeStudentIdByStudentId, eligibleStudentIds } = await resolveEligibleStudents({
    instituteId, track, sectionId, degreeCourseId, individualCourseId,
  });

  const saved = [];
  for (const rec of records) {
    let degreeStudentId;
    if (track === 'DEGREE') {
      degreeStudentId = degreeStudentIdByStudentId.get(rec.studentId);
      if (!degreeStudentId) continue;
    } else if (track === 'INDIVIDUAL_COURSE') {
      if (!eligibleStudentIds.has(rec.studentId)) continue;
    } else if (sectionId && eligibleStudentIds && !eligibleStudentIds.has(rec.studentId)) {
      continue;
    }

    const lectureNumber = rec.lectureNumber || 1;
    const parsedDate = new Date(date);
    const scopedWhere = {
      instituteId,
      studentId: rec.studentId,
      date: parsedDate,
      lectureNumber,
      ...(track === 'ACADEMIC' && { subjectId }),
      ...(track === 'DEGREE' && { degreeCourseId }),
      ...(track === 'INDIVIDUAL_COURSE' && { individualCourseId }),
    };

    const existing = await prisma.attendance.findFirst({ where: scopedWhere });
    const attendance = existing
      ? await prisma.attendance.update({
        where: { id: existing.id },
        data: { status: rec.status || 'PRESENT', markedById },
      })
      : await prisma.attendance.create({
        data: {
          instituteId, track, studentId: rec.studentId, date: parsedDate, lectureNumber,
          status: rec.status || 'PRESENT', markedById,
          ...(track === 'ACADEMIC' && { subjectId }),
          ...(track === 'DEGREE' && { degreeCourseId, degreeStudentId }),
          ...(track === 'INDIVIDUAL_COURSE' && { individualCourseId }),
        },
      });
    saved.push(attendance);
  }

  if (saved.length) {
    const { events } = await import('../events/eventBus.js');
    await events.attendanceMarked({
      instituteId,
      payload: { track, markedCount: saved.length, date, actorId: markedById },
    }).catch(() => {});
  }

  return saved;
}

export async function getAttendanceRecords({ instituteId, track = 'ACADEMIC', subjectId, degreeCourseId, individualCourseId, studentId, date, from, to }) {
  const where = { instituteId, track };
  if (track === 'ACADEMIC' && subjectId) where.subjectId = subjectId;
  if (track === 'DEGREE' && degreeCourseId) where.degreeCourseId = degreeCourseId;
  if (track === 'INDIVIDUAL_COURSE' && individualCourseId) where.individualCourseId = individualCourseId;
  if (studentId) where.studentId = studentId;
  if (date) where.date = new Date(date);
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  return prisma.attendance.findMany({
    where,
    include: {
      student: { select: { id: true, firstName: true, lastName: true, rollNumber: true, currentSectionId: true } },
      ...(track === 'ACADEMIC' && { subject: { select: { id: true, name: true, code: true } } }),
      ...(track === 'DEGREE' && { degreeStudent: { select: { id: true, currentSemesterNumber: true } } }),
    },
    orderBy: { date: 'desc' },
  });
}

/** includeLateInPresent matches each original route's own percentage formula
 * (Academic student-summary counts PRESENT only; Degree course-attendance counts PRESENT+LATE). */
export function summarizeAttendance(records, { includeLateInPresent = false } = {}) {
  const total = records.length;
  const present = records.filter((r) => r.status === 'PRESENT').length;
  const absent = records.filter((r) => r.status === 'ABSENT').length;
  const late = records.filter((r) => r.status === 'LATE').length;
  const leave = records.filter((r) => r.status === 'LEAVE').length;
  const presentEquivalent = includeLateInPresent ? present + late : present;
  const percentage = total ? Math.round((presentEquivalent / total) * 10000) / 100 : 0;
  return { total, present, absent, late, leave, percentage };
}

export async function getAttendanceSummary({ instituteId, studentId, track, includeLateInPresent }) {
  const where = { instituteId, studentId };
  if (track) where.track = track;
  const records = await prisma.attendance.findMany({ where });
  return summarizeAttendance(records, { includeLateInPresent });
}

/** CLASS/SECTION precedence resolver for the Academic track's TeacherAssignment engine:
 * a SECTION-scope override always wins over the class-wide CLASS-scope default. */
export async function resolveEffectiveTeacherAssignment({ instituteId, sectionId, subjectId }) {
  const sectionOverride = await prisma.teacherAssignment.findFirst({
    where: { instituteId, track: 'ACADEMIC', scope: 'SECTION', sectionId, subjectId },
    include: { teacher: true },
  });
  if (sectionOverride) return sectionOverride;

  const section = await prisma.section.findFirst({ where: { id: sectionId, instituteId }, include: { batch: true } });
  if (!section?.batch?.classId) return null;

  return prisma.teacherAssignment.findFirst({
    where: { instituteId, track: 'ACADEMIC', scope: 'CLASS', classId: section.batch.classId, subjectId },
    include: { teacher: true },
  });
}
