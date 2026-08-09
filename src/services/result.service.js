import { prisma } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { computeResult, PAKISTANI_GRADE_SCALE } from '../utils/grading.js';

function buildComputed(entry, maxes, scale) {
  return computeResult({
    theoryMarks: entry.theoryMarks,
    practicalMarks: entry.practicalMarks,
    internalMarks: entry.internalMarks,
    theoryMax: maxes.theoryMax,
    practicalMax: maxes.practicalMax,
    internalMax: maxes.internalMax,
    passPercentage: maxes.passPercentage,
    scale,
  });
}

/** Rejects negative marks or marks exceeding their component's max, before anything is persisted. */
function validateMarks({ theoryMarks, practicalMarks, internalMarks }, maxes) {
  const checks = [
    ['Theory', theoryMarks, maxes.theoryMax],
    ['Practical', practicalMarks, maxes.practicalMax],
    ['Internal', internalMarks, maxes.internalMax],
  ];
  for (const [label, value, max] of checks) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new AppError(`${label} marks must be a non-negative number`, 400);
    }
    if (max != null && n > Number(max)) {
      throw new AppError(`${label} marks (${n}) cannot exceed the maximum (${max})`, 400);
    }
  }
}

/** An institute's custom grade bands (GradingPolicy.bands), or null to use PAKISTANI_GRADE_SCALE. */
export async function resolveGradeScale(instituteId) {
  const policy = await prisma.gradingPolicy.findUnique({ where: { instituteId } });
  return policy?.bands || null;
}

export async function enterResult({
  instituteId, track = 'ACADEMIC', studentId,
  examId, subjectId,
  degreeStudentId, semesterId, degreeCourseId,
  theoryMarks, practicalMarks, internalMarks, remarks,
  maxes, publish, scale,
}) {
  validateMarks({ theoryMarks, practicalMarks, internalMarks }, maxes);
  const effectiveScale = scale || (await resolveGradeScale(instituteId)) || PAKISTANI_GRADE_SCALE;
  const computed = buildComputed({ theoryMarks, practicalMarks, internalMarks }, maxes, effectiveScale);

  if (track === 'DEGREE') {
    if (!degreeStudentId || !semesterId || !degreeCourseId) {
      throw new AppError('degreeStudentId, semesterId and degreeCourseId are required', 400);
    }
    return prisma.result.upsert({
      where: { instituteId_degreeStudentId_degreeCourseId_semesterId: { instituteId, degreeStudentId, degreeCourseId, semesterId } },
      create: {
        instituteId, track: 'DEGREE', studentId, degreeStudentId, semesterId, degreeCourseId,
        theoryMarks, practicalMarks, internalMarks,
        totalMarks: computed.totalMarks, maxMarks: computed.maxMarks, grade: computed.grade,
        gradePoints: computed.gradePoints, percentage: computed.percentage, passPercentage: maxes.passPercentage,
        remarks: remarks || null, isPassed: computed.isPassed,
        ...(publish && { publishedAt: new Date() }),
      },
      update: {
        theoryMarks, practicalMarks, internalMarks,
        totalMarks: computed.totalMarks, maxMarks: computed.maxMarks, grade: computed.grade,
        gradePoints: computed.gradePoints, percentage: computed.percentage, passPercentage: maxes.passPercentage,
        remarks: remarks !== undefined ? remarks : undefined, isPassed: computed.isPassed,
        ...(publish && { publishedAt: new Date() }),
      },
      include: { degreeCourse: true },
    });
  }

  if (!examId || !subjectId) throw new AppError('examId and subjectId are required', 400);
  return prisma.result.upsert({
    where: { instituteId_studentId_subjectId_examId: { instituteId, studentId, subjectId, examId } },
    create: {
      instituteId, track: 'ACADEMIC', studentId, subjectId, examId,
      theoryMarks: computed.theoryMarks, practicalMarks: computed.practicalMarks, internalMarks: computed.internalMarks,
      totalMarks: computed.totalMarks, maxMarks: computed.maxMarks, grade: computed.grade,
      gradePoints: computed.gradePoints, isPassed: computed.isPassed,
      ...(publish && { publishedAt: new Date() }),
    },
    update: {
      theoryMarks: computed.theoryMarks, practicalMarks: computed.practicalMarks, internalMarks: computed.internalMarks,
      totalMarks: computed.totalMarks, maxMarks: computed.maxMarks, grade: computed.grade,
      gradePoints: computed.gradePoints, isPassed: computed.isPassed,
      ...(publish && { publishedAt: new Date() }),
    },
    include: {
      student: { select: { firstName: true, lastName: true, rollNumber: true } },
      subject: true,
    },
  });
}

export async function bulkEnterResults({ instituteId, track = 'ACADEMIC', entries, examId, subjectId, semesterId, degreeCourseId, maxes, publish }) {
  const scale = (await resolveGradeScale(instituteId)) || PAKISTANI_GRADE_SCALE;
  const saved = [];
  for (const entry of entries) {
    const row = await enterResult({
      instituteId, track,
      studentId: entry.studentId,
      examId, subjectId,
      degreeStudentId: entry.degreeStudentId, semesterId, degreeCourseId,
      theoryMarks: entry.theoryMarks, practicalMarks: entry.practicalMarks, internalMarks: entry.internalMarks,
      remarks: entry.remarks, maxes, publish, scale,
    });
    saved.push(row);
  }
  return saved;
}

export async function getStudentResults({ instituteId, studentId, track, publishedOnly = true }) {
  const where = { instituteId, studentId };
  if (track) where.track = track;
  if (publishedOnly) where.publishedAt = { not: null };
  return prisma.result.findMany({
    where,
    include: { exam: true, subject: true, degreeCourse: true, semester: true },
    orderBy: { createdAt: 'desc' },
  });
}

function buildExamAnalytics(exam, results) {
  const byStudent = {};
  for (const r of results) {
    if (!byStudent[r.studentId]) {
      byStudent[r.studentId] = { student: r.student, subjects: [], totalObtained: 0, totalMax: 0 };
    }
    const obtained = Number(r.totalMarks || 0);
    const max = Number(r.maxMarks || 0);
    byStudent[r.studentId].subjects.push({
      subject: r.subject?.name, obtained, max, grade: r.grade, position: r.position, isPassed: r.isPassed,
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

  return { exam, studentResults, stats };
}

export async function getExamAnalytics({ instituteId, examId }) {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, instituteId },
    include: { section: { include: { batch: { include: { session: true } } } }, semester: true },
  });
  if (!exam) throw new AppError('Exam not found', 404);

  const results = await prisma.result.findMany({
    where: { examId: exam.id, instituteId, track: 'ACADEMIC' },
    include: { student: true, subject: true },
  });
  return buildExamAnalytics(exam, results);
}

export async function publishResults({ instituteId, track = 'ACADEMIC', examId, semesterId, degreeCourseId }) {
  if (track === 'DEGREE') {
    if (!semesterId || !degreeCourseId) throw new AppError('semesterId and degreeCourseId are required', 400);
    return prisma.result.updateMany({
      where: { instituteId, track: 'DEGREE', semesterId, degreeCourseId },
      data: { publishedAt: new Date() },
    });
  }
  if (!examId) throw new AppError('examId is required', 400);
  return prisma.result.updateMany({
    where: { instituteId, track: 'ACADEMIC', examId },
    data: { publishedAt: new Date() },
  });
}
