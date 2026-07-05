import { prisma } from '../config/database.js';

export async function getStudentProfile(studentId, instituteId) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, instituteId },
    include: {
      user: { select: { email: true, portalPassword: true, lastLoginAt: true } },
      currentBatch: { include: { session: true } },
      currentSection: true,
      documents: { orderBy: { createdAt: 'desc' }, take: 20 },
      promotions: { orderBy: { promotedAt: 'desc' }, take: 20 },
      studentNotes: { orderBy: { createdAt: 'desc' }, take: 30 },
      courseEnrollments: {
        include: { course: true },
        orderBy: { enrolledAt: 'desc' },
      },
    },
  });
  if (!student) return null;

  const [fees, attendance, results] = await Promise.all([
    prisma.fee.findMany({
      where: { studentId, instituteId },
      include: { feeStructure: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.attendance.findMany({
      where: { studentId, instituteId },
      include: { subject: true },
      orderBy: { date: 'desc' },
      take: 100,
    }),
    prisma.result.findMany({
      where: { studentId, instituteId },
      include: { exam: true, subject: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const feeSummary = fees.reduce(
    (acc, f) => {
      const amt = Number(f.amount || 0) + Number(f.fine || 0) - Number(f.discount || 0);
      acc.total += amt;
      if (f.status === 'PAID') {
        acc.paid += amt;
      } else if (f.status === 'PARTIAL') {
        acc.paid += amt * 0.5;
        acc.remaining += amt * 0.5;
      } else {
        acc.remaining += amt;
        acc.dueCount += 1;
      }
      return acc;
    },
    { total: 0, paid: 0, remaining: 0, dueCount: 0 },
  );

  const attSummary = attendance.reduce(
    (acc, a) => {
      acc.total += 1;
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    },
    { total: 0, PRESENT: 0, ABSENT: 0, LEAVE: 0, LATE: 0 },
  );
  attSummary.percentage = attSummary.total
    ? Math.round(((attSummary.PRESENT + attSummary.LATE) / attSummary.total) * 100)
    : 0;

  const examSummary = {};
  for (const r of results) {
    const key = r.examId;
    if (!examSummary[key]) {
      examSummary[key] = {
        examId: r.examId,
        examName: r.exam?.name,
        subjects: [],
        totalMarks: 0,
        obtainedMarks: 0,
      };
    }
    examSummary[key].subjects.push({
      subject: r.subject?.name,
      marks: r.totalMarks,
      grade: r.grade,
      position: r.position,
      remarks: r.remarks,
    });
    examSummary[key].totalMarks += Number(r.totalMarks || 0);
    examSummary[key].obtainedMarks += Number(r.totalMarks || 0);
  }

  const timeline = [
    ...student.promotions.map((p) => ({
      type: 'promotion',
      date: p.promotedAt,
      text: `Promoted${p.sessionName ? ` (${p.sessionName})` : ''}`,
    })),
    ...student.studentNotes.map((n) => ({
      type: 'note',
      date: n.createdAt,
      text: n.content,
    })),
    ...fees.filter((f) => f.status === 'PAID').slice(0, 5).map((f) => ({
      type: 'fee',
      date: f.paidDate || f.createdAt,
      text: `Fee paid: ${Number(f.amount || 0).toLocaleString()} PKR`,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    student,
    feeSummary,
    fees,
    attendanceSummary: attSummary,
    attendanceHistory: attendance,
    results,
    examSummary: Object.values(examSummary),
    timeline,
  };
}

export async function getTeacherProfile(teacherId, instituteId) {
  const teacher = await prisma.teacher.findFirst({
    where: { id: teacherId, instituteId },
    include: {
      user: { select: { email: true, portalPassword: true, lastLoginAt: true } },
      department: true,
      assignments: {
        include: {
          subject: true,
          section: { include: { batch: true } },
        },
      },
      salaries: { orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 24 },
      leaveRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
      documents: { orderBy: { createdAt: 'desc' }, take: 20 },
      individualCourses: { include: { course: true } },
    },
  });
  if (!teacher) return null;

  const timeline = [
    ...teacher.leaveRequests.map((l) => ({
      type: 'leave',
      date: l.createdAt,
      text: `Leave request: ${l.status}`,
    })),
    ...teacher.salaries.slice(0, 5).map((s) => ({
      type: 'salary',
      date: new Date(s.year, s.month - 1, 1),
      text: `Salary ${Number(s.netAmount || s.amount || 0).toLocaleString()} PKR`,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return { teacher, timeline };
}
