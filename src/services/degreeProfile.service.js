import { prisma } from '../config/database.js';
import { calculateSemesterGPA } from '../utils/grading.js';
import { getEffectiveSemesterFee } from './degreeFee.service.js';

export async function getDegreeStudentProfile(degreeStudentId, instituteId) {
  const ds = await prisma.degreeStudent.findFirst({
    where: { id: degreeStudentId, instituteId },
    include: {
      student: {
        include: {
          user: { select: { email: true, portalPassword: true, lastLoginAt: true } },
          documents: { orderBy: { createdAt: 'desc' }, take: 30 },
        },
      },
      batch: { include: { degree: true, semesters: { orderBy: { number: 'asc' } } } },
    },
  });
  if (!ds) return null;

  const fees = await prisma.fee.findMany({
    where: { degreeStudentId: ds.id, instituteId },
    include: {
      feeStructure: true,
      installments: { orderBy: { installmentNo: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const results = await prisma.degreeResult.findMany({
    where: { degreeStudentId: ds.id, instituteId },
    include: { course: true, semester: true },
    orderBy: [{ semester: { number: 'asc' } }, { course: { name: 'asc' } }],
  });

  const attendance = await prisma.degreeAttendance.findMany({
    where: { degreeStudentId: ds.id, instituteId },
    include: { course: { include: { semester: true } } },
    orderBy: { date: 'desc' },
    take: 500,
  });

  const paid = fees.filter((f) => f.status === 'PAID').reduce((s, f) => s + Number(f.amount), 0);
  const pending = fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL')
    .reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0), 0);
  const installmentPlans = fees.filter((f) => f.installments?.length > 0);

  const attendanceTotal = attendance.length;
  const attendancePresent = attendance.filter((a) => a.status === 'PRESENT').length;
  const attendancePct = attendanceTotal ? Math.round((attendancePresent / attendanceTotal) * 10000) / 100 : 0;

  const bySemester = {};
  for (const r of results) {
    const n = r.semester.number;
    if (!bySemester[n]) {
      bySemester[n] = {
        semester: r.semester,
        results: [],
        gpa: 0,
        effectiveFee: getEffectiveSemesterFee(ds.batch, r.semester),
      };
    }
    bySemester[n].results.push(r);
  }
  Object.values(bySemester).forEach((s) => {
    s.gpa = calculateSemesterGPA(s.results.map((r) => ({
      gradePoints: r.gradePoints,
      creditHours: r.course.creditHours,
      isPassed: r.isPassed,
    })));
  });

  const attendanceBySemester = {};
  for (const a of attendance) {
    const n = a.course.semester?.number || ds.currentSemesterNumber;
    if (!attendanceBySemester[n]) attendanceBySemester[n] = { total: 0, present: 0, records: [] };
    attendanceBySemester[n].total += 1;
    if (a.status === 'PRESENT') attendanceBySemester[n].present += 1;
    attendanceBySemester[n].records.push(a);
  }

  return {
    degreeStudent: ds,
    feeSummary: { total: paid + pending, paid, remaining: pending },
    fees,
    installmentPlans,
    attendanceSummary: { total: attendanceTotal, present: attendancePresent, percentage: attendancePct },
    attendanceBySemester,
    semesterResults: Object.values(bySemester).sort((a, b) => a.semester.number - b.semester.number),
    academicRecord: Object.values(bySemester),
  };
}
