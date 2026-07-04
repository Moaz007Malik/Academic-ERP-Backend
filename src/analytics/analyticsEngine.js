import { prisma } from '../config/database.js';

const METRIC_COMPUTERS = {
  'admission.conversion': computeAdmissionConversion,
  'revenue.trends': computeRevenueTrends,
  'fee.defaulters': computeFeeDefaulters,
  'attendance.trends': computeAttendanceTrends,
  'student.performance': computeStudentPerformance,
  'teacher.performance': computeTeacherPerformance,
  'department.performance': computeDepartmentPerformance,
  'dropout.analysis': computeDropoutAnalysis,
};

export async function computeAnalyticsSnapshot({ eventType, instituteId }) {
  if (!instituteId) return;
  const metricKey = mapEventToMetric(eventType);
  if (!metricKey || !METRIC_COMPUTERS[metricKey]) return;

  const periodStart = startOfMonth(new Date());
  const periodEnd = endOfMonth(new Date());
  const value = await METRIC_COMPUTERS[metricKey](instituteId, periodStart, periodEnd);

  await prisma.analyticsSnapshot.upsert({
    where: {
      instituteId_metricKey_periodType_periodStart: {
        instituteId,
        metricKey,
        periodType: 'MONTHLY',
        periodStart,
      },
    },
    create: {
      instituteId,
      metricKey,
      periodType: 'MONTHLY',
      periodStart,
      periodEnd,
      value,
    },
    update: { value, computedAt: new Date() },
  });
}

function mapEventToMetric(eventType) {
  const map = {
    'fee.collected': 'revenue.trends',
    'attendance.marked': 'attendance.trends',
    'result.published': 'student.performance',
    'student.created': 'admission.conversion',
  };
  return map[eventType];
}

async function computeAdmissionConversion(instituteId, from, to) {
  const [inquiries, enrolled] = await Promise.all([
    prisma.formSubmission.count({
      where: {
        instituteId,
        createdAt: { gte: from, lte: to },
        form: { purpose: 'INQUIRY' },
      },
    }),
    prisma.student.count({
      where: { instituteId, enrollmentDate: { gte: from, lte: to } },
    }),
  ]);
  return { inquiries, enrolled, rate: inquiries ? enrolled / inquiries : 0 };
}

async function computeRevenueTrends(instituteId, from, to) {
  const agg = await prisma.fee.aggregate({
    where: { instituteId, status: 'PAID', paidDate: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
  });
  return { total: Number(agg._sum.amount || 0), count: agg._count };
}

async function computeFeeDefaulters(instituteId) {
  const defaulters = await prisma.fee.groupBy({
    by: ['studentId'],
    where: {
      instituteId,
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: { lt: new Date() },
    },
    _count: true,
  });
  return { count: defaulters.length, studentIds: defaulters.map((d) => d.studentId) };
}

async function computeAttendanceTrends(instituteId, from, to) {
  const records = await prisma.attendance.findMany({
    where: { instituteId, date: { gte: from, lte: to } },
    select: { status: true },
  });
  const total = records.length;
  const present = records.filter((r) => r.status === 'PRESENT').length;
  return { total, present, rate: total ? present / total : 0 };
}

async function computeStudentPerformance(instituteId, from, to) {
  const results = await prisma.result.findMany({
    where: { instituteId, publishedAt: { gte: from, lte: to } },
    select: { totalMarks: true, maxMarks: true, isPassed: true },
  });
  const avg = results.length
    ? results.reduce((s, r) => s + Number(r.totalMarks || 0) / Number(r.maxMarks || 1), 0) / results.length
    : 0;
  const passRate = results.length ? results.filter((r) => r.isPassed).length / results.length : 0;
  return { averagePct: avg * 100, passRate, sampleSize: results.length };
}

async function computeTeacherPerformance(instituteId) {
  const teachers = await prisma.teacher.count({ where: { instituteId, status: 'ACTIVE' } });
  const assignments = await prisma.teacherAssignment.count({ where: { instituteId } });
  return { activeTeachers: teachers, assignments, ratio: teachers ? assignments / teachers : 0 };
}

async function computeDepartmentPerformance(instituteId) {
  const departments = await prisma.department.findMany({
    where: { instituteId },
    include: { courses: { include: { subjects: true } } },
  });
  return departments.map((d) => ({
    departmentId: d.id,
    name: d.name,
    courses: d.courses.length,
    subjects: d.courses.reduce((s, c) => s + c.subjects.length, 0),
  }));
}

async function computeDropoutAnalysis(instituteId, from, to) {
  const [active, left] = await Promise.all([
    prisma.student.count({ where: { instituteId, status: 'ACTIVE' } }),
    prisma.student.count({
      where: {
        instituteId,
        status: { in: ['EXPELLED', 'TRANSFERRED'] },
        updatedAt: { gte: from, lte: to },
      },
    }),
  ]);
  return { active, left, dropoutRate: active + left ? left / (active + left) : 0 };
}

export async function getAnalyticsDashboard(instituteId) {
  const snapshots = await prisma.analyticsSnapshot.findMany({
    where: { instituteId },
    orderBy: { computedAt: 'desc' },
    take: 20,
  });
  const feeDefaulters = await computeFeeDefaulters(instituteId);
  return { snapshots, feeDefaulters };
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}
