import { prisma } from '../config/database.js';
import { aggregateFeeTotals } from './fee.service.js';

export async function getOverviewReport(instituteId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    totalStudents, totalTeachers, totalClasses, totalDegreePrograms, totalIndividualCourses,
    todayAttendanceTotal, todayAttendancePresent,
    feesCollectedMonth, feesPending,
    lastExam, openTickets,
  ] = await Promise.all([
    prisma.student.count({ where: { instituteId, status: 'ACTIVE' } }),
    prisma.teacher.count({ where: { instituteId, status: 'ACTIVE' } }),
    prisma.academicClass.count({ where: { instituteId } }),
    prisma.degree.count({ where: { instituteId, status: 'ACTIVE' } }),
    prisma.individualCourse.count({ where: { instituteId, status: { not: 'CANCELLED' } } }),
    prisma.attendance.count({ where: { instituteId, date: { gte: today, lt: tomorrow } } }),
    prisma.attendance.count({ where: { instituteId, date: { gte: today, lt: tomorrow }, status: 'PRESENT' } }),
    prisma.fee.aggregate({ where: { instituteId, status: 'PAID', paidDate: { gte: monthStart } }, _sum: { amount: true, discount: true, fine: true } }),
    prisma.fee.aggregate({ where: { instituteId, status: { in: ['PENDING', 'PARTIAL'] } }, _sum: { amount: true, discount: true, fine: true } }),
    prisma.exam.findFirst({ where: { instituteId, isPublished: true }, orderBy: { createdAt: 'desc' } }),
    prisma.supportTicket.count({ where: { instituteId, status: 'OPEN' } }),
  ]);

  let lastExamPassRate = null;
  if (lastExam) {
    const results = await prisma.result.findMany({ where: { examId: lastExam.id, instituteId }, select: { isPassed: true } });
    if (results.length) {
      lastExamPassRate = Math.round((results.filter((r) => r.isPassed).length / results.length) * 10000) / 100;
    }
  }

  const netSum = (agg) => Number(agg._sum.amount || 0) - Number(agg._sum.discount || 0) + Number(agg._sum.fine || 0);

  return {
    totalStudents,
    totalTeachers,
    totalClasses,
    totalDegreePrograms,
    totalIndividualCourses,
    attendanceTodayPct: todayAttendanceTotal ? Math.round((todayAttendancePresent / todayAttendanceTotal) * 10000) / 100 : null,
    feesCollectedMonth: netSum(feesCollectedMonth),
    feesPending: netSum(feesPending),
    lastExam: lastExam ? { id: lastExam.id, name: lastExam.name, passRate: lastExamPassRate } : null,
    openTickets,
  };
}

export async function getStudentsReport({ instituteId, classId, batchId, sectionId, status }) {
  const where = { instituteId, deletedAt: null };
  if (status) where.status = status;
  if (sectionId) where.currentSectionId = sectionId;
  else if (batchId) where.currentBatchId = batchId;
  else if (classId) where.currentBatch = { classId };

  const students = await prisma.student.findMany({
    where,
    include: { currentBatch: { include: { academicClass: true } }, currentSection: true },
    orderBy: { rollNumber: 'asc' },
  });

  return students.map((s) => ({
    id: s.id,
    rollNumber: s.rollNumber,
    name: `${s.firstName} ${s.lastName}`,
    class: s.currentBatch?.academicClass?.name || '—',
    batch: s.currentBatch?.name || '—',
    section: s.currentSection?.name || '—',
    status: s.status,
    enrollmentDate: s.enrollmentDate,
    guardianName: s.guardianName,
    guardianPhone: s.guardianPhone,
  }));
}

export async function getTeachersReport({ instituteId, departmentId, status }) {
  const where = { instituteId, deletedAt: null };
  if (departmentId) where.departmentId = departmentId;
  if (status) where.status = status;

  const teachers = await prisma.teacher.findMany({
    where,
    include: { department: true, _count: { select: { assignments: true } } },
    orderBy: { firstName: 'asc' },
  });

  return teachers.map((t) => ({
    id: t.id,
    employeeCode: t.employeeCode,
    name: `${t.firstName} ${t.lastName}`,
    department: t.department?.name || '—',
    designation: t.designation || '—',
    status: t.status,
    assignmentsCount: t._count.assignments,
    salary: t.salary != null ? Number(t.salary) : null,
    joiningDate: t.joiningDate,
  }));
}

export async function getAttendanceReport({ instituteId, track, sectionId, degreeCourseId, individualCourseId, dateFrom, dateTo }) {
  const where = { instituteId };
  if (track) where.track = track;
  if (sectionId) where.student = { currentSectionId: sectionId };
  if (degreeCourseId) where.degreeCourseId = degreeCourseId;
  if (individualCourseId) where.individualCourseId = individualCourseId;
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = new Date(dateFrom);
    if (dateTo) where.date.lte = new Date(dateTo);
  }

  const records = await prisma.attendance.findMany({
    where,
    include: { student: { select: { id: true, firstName: true, lastName: true, rollNumber: true } } },
  });

  const byStudent = new Map();
  for (const r of records) {
    if (!byStudent.has(r.studentId)) {
      byStudent.set(r.studentId, { student: r.student, total: 0, present: 0, absent: 0, late: 0, leave: 0 });
    }
    const entry = byStudent.get(r.studentId);
    entry.total += 1;
    if (r.status === 'PRESENT') entry.present += 1;
    else if (r.status === 'ABSENT') entry.absent += 1;
    else if (r.status === 'LATE') entry.late += 1;
    else if (r.status === 'LEAVE') entry.leave += 1;
  }

  return [...byStudent.values()]
    .map((e) => ({
      rollNumber: e.student.rollNumber,
      name: `${e.student.firstName} ${e.student.lastName}`,
      total: e.total,
      present: e.present,
      absent: e.absent,
      late: e.late,
      leave: e.leave,
      percentage: e.total ? Math.round(((e.present + e.late) / e.total) * 10000) / 100 : 0,
    }))
    .sort((a, b) => a.percentage - b.percentage);
}

export async function getFeesReport({ instituteId, track, dateFrom, dateTo }) {
  const where = { instituteId };
  if (track) where.track = track;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const fees = await prisma.fee.findMany({
    where,
    include: {
      student: { select: { firstName: true, lastName: true, rollNumber: true } },
      feeStructure: { select: { name: true } },
      _count: { select: { installments: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const leafFees = fees.filter((f) => f._count.installments === 0);
  const totals = aggregateFeeTotals(leafFees);

  const rows = fees.map((f) => ({
    student: `${f.student.firstName} ${f.student.lastName}`,
    rollNumber: f.student.rollNumber,
    track: f.track,
    fee: f.feeStructure?.name,
    amount: Number(f.amount),
    discount: Number(f.discount || 0),
    fine: Number(f.fine || 0),
    status: f.status,
    dueDate: f.dueDate,
    paidDate: f.paidDate,
    receiptNumber: f.receiptNumber,
  }));

  return { totals, rows };
}

export async function getSalaryReport({ instituteId, month, year }) {
  const where = { instituteId };
  if (month) where.month = Number(month);
  if (year) where.year = Number(year);

  const salaries = await prisma.salary.findMany({
    where,
    include: { teacher: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const totalPayroll = salaries.reduce((s, sal) => s + Number(sal.netAmount), 0);

  const rows = salaries.map((s) => ({
    employeeCode: s.teacher.employeeCode,
    teacher: `${s.teacher.firstName} ${s.teacher.lastName}`,
    month: s.month,
    year: s.year,
    amount: Number(s.amount),
    deductions: Number(s.deductions || 0),
    netAmount: Number(s.netAmount),
  }));

  return { totalPayroll, rows };
}

export async function listExamsForReport(instituteId) {
  return prisma.exam.findMany({
    where: { instituteId },
    select: { id: true, name: true, examType: true, isPublished: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}
