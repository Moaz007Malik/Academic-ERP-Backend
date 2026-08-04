import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';

const ASSIGNMENT_INCLUDE = {
  teacher: { select: { id: true, firstName: true, lastName: true } },
  subject: true,
  academicClass: true,
  section: { include: { batch: true } },
  degreeCourse: true,
  individualCourse: true,
};

export async function assignTeacher({ instituteId, track = 'ACADEMIC', teacherId, scope, subjectId, classId, sectionId, degreeCourseId, individualCourseId }) {
  if (!teacherId) throw new AppError('teacherId is required', 400);

  const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, instituteId } });
  if (!teacher) throw new AppError('Teacher not found', 404);

  try {
    if (track === 'DEGREE') {
      if (!degreeCourseId) throw new AppError('degreeCourseId is required', 400);
      return await prisma.teacherAssignment.create({
        data: { instituteId, track: 'DEGREE', teacherId, degreeCourseId },
        include: ASSIGNMENT_INCLUDE,
      });
    }
    if (track === 'INDIVIDUAL_COURSE') {
      if (!individualCourseId) throw new AppError('individualCourseId is required', 400);
      return await prisma.teacherAssignment.create({
        data: { instituteId, track: 'INDIVIDUAL_COURSE', teacherId, individualCourseId },
        include: ASSIGNMENT_INCLUDE,
      });
    }

    // ACADEMIC
    if (!subjectId) throw new AppError('subjectId is required', 400);
    if (scope === 'CLASS') {
      if (!classId) throw new AppError('classId is required for a CLASS-scope assignment', 400);
      return await prisma.teacherAssignment.create({
        data: { instituteId, track: 'ACADEMIC', teacherId, scope: 'CLASS', subjectId, classId },
        include: ASSIGNMENT_INCLUDE,
      });
    }
    if (!sectionId) throw new AppError('sectionId is required for a SECTION-scope assignment', 400);
    return await prisma.teacherAssignment.create({
      data: { instituteId, track: 'ACADEMIC', teacherId, scope: 'SECTION', subjectId, sectionId },
      include: ASSIGNMENT_INCLUDE,
    });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError('Teacher is already assigned to this subject/class/course', 409);
    throw err;
  }
}

export async function removeAssignment({ instituteId, assignmentId }) {
  const assignment = await prisma.teacherAssignment.findFirst({ where: { id: assignmentId, instituteId } });
  if (!assignment) throw new AppError('Assignment not found', 404);
  await prisma.teacherAssignment.delete({ where: { id: assignment.id } });
  return assignment;
}

export async function listAssignmentsForTeacher({ instituteId, teacherId, track }) {
  return prisma.teacherAssignment.findMany({
    where: { instituteId, teacherId, ...(track && { track }) },
    include: ASSIGNMENT_INCLUDE,
  });
}

/** CLASS/SECTION precedence: a SECTION-scope row overrides the CLASS-scope default for that
 * one section only. Used by the attendance/timetable/results flows to resolve "who teaches
 * this subject to this section" without requiring one row per section. */
export async function resolveEffectiveTeachersForSection({ instituteId, sectionId, subjectId }) {
  const sectionOverride = await prisma.teacherAssignment.findMany({
    where: { instituteId, track: 'ACADEMIC', scope: 'SECTION', sectionId, ...(subjectId && { subjectId }) },
    include: ASSIGNMENT_INCLUDE,
  });
  if (sectionOverride.length) return sectionOverride;

  const section = await prisma.section.findFirst({ where: { id: sectionId, instituteId }, include: { batch: true } });
  if (!section?.batch?.classId) return [];

  return prisma.teacherAssignment.findMany({
    where: { instituteId, track: 'ACADEMIC', scope: 'CLASS', classId: section.batch.classId, ...(subjectId && { subjectId }) },
    include: ASSIGNMENT_INCLUDE,
  });
}

/** Expands a teacher's ACADEMIC-track assignments into concrete {subjectId, sectionId} pairs —
 * a CLASS-scope assignment expands into one entry per Section of that Class, so a teacher
 * assigned once at the class level is automatically eligible for every section without any
 * per-section rows existing. Used by the teacher portal to compute "my classes/subjects". */
export async function expandAcademicAssignmentsToSections({ instituteId, assignments }) {
  const sectionScoped = assignments.filter((a) => a.track === 'ACADEMIC' && a.scope === 'SECTION');
  const classScoped = assignments.filter((a) => a.track === 'ACADEMIC' && a.scope === 'CLASS');

  const expanded = sectionScoped.map((a) => ({ subjectId: a.subjectId, sectionId: a.sectionId, section: a.section }));
  if (classScoped.length) {
    const classIds = [...new Set(classScoped.map((a) => a.classId))];
    const sections = await prisma.section.findMany({
      where: { instituteId, batch: { classId: { in: classIds } } },
      include: { batch: true },
    });
    for (const a of classScoped) {
      for (const section of sections.filter((s) => s.batch.classId === a.classId)) {
        expanded.push({ subjectId: a.subjectId, sectionId: section.id, section });
      }
    }
  }
  return expanded;
}

export async function bulkSetCourseTeachers({ instituteId, track, degreeCourseId, individualCourseId, teacherIds = [] }) {
  const where = track === 'DEGREE' ? { degreeCourseId } : { individualCourseId };
  await prisma.teacherAssignment.deleteMany({ where: { instituteId, track, ...where } });
  const ids = Array.isArray(teacherIds) ? teacherIds.filter(Boolean) : [];
  if (!ids.length) return [];
  await prisma.teacherAssignment.createMany({
    data: ids.map((teacherId) => ({ instituteId, track, teacherId, ...where })),
    skipDuplicates: true,
  });
  return prisma.teacherAssignment.findMany({ where: { instituteId, track, ...where }, include: ASSIGNMENT_INCLUDE });
}
