import { prisma } from '../config/database.js';
import { getEffectiveSemesterFee } from './degreeFee.service.js';
import { summarizeFees } from './fee.service.js';

export { summarizeFees };

export async function getAcademicStudentFees(studentId, instituteId) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, instituteId },
    include: {
      currentBatch: { include: { session: true } },
      currentSection: true,
    },
  });
  if (!student) return null;

  const fees = await prisma.fee.findMany({
    where: { studentId, instituteId, track: 'ACADEMIC' },
    include: {
      feeStructure: true,
      installments: { orderBy: { installmentNo: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return { student, fees, summary: summarizeFees(fees) };
}

export async function getDegreeStudentFees(degreeStudentId, instituteId) {
  const ds = await prisma.degreeStudent.findFirst({
    where: { id: degreeStudentId, instituteId },
    include: {
      student: true,
      batch: { include: { degree: true, semesters: true } },
    },
  });
  if (!ds) return null;

  const semester = ds.batch.semesters.find((s) => s.number === ds.currentSemesterNumber);
  const assignedSemesterFee = semester
    ? getEffectiveSemesterFee(ds.batch, semester)
    : Number(ds.semesterFee);

  const fees = await prisma.fee.findMany({
    where: { degreeStudentId: ds.id, instituteId },
    include: {
      feeStructure: true,
      installments: { orderBy: { installmentNo: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    degreeStudent: ds,
    assignedSemesterFee,
    discount: ds.discount,
    scholarship: ds.scholarship,
    netSemesterFee: ds.netSemesterFee,
    installmentEnabled: ds.installmentEnabled,
    installmentCount: ds.installmentCount,
    fees,
    summary: summarizeFees(fees),
  };
}

export async function getIndividualCourseStudentFees(enrollmentId, instituteId) {
  const enrollment = await prisma.individualCourseEnrollment.findFirst({
    where: { id: enrollmentId, instituteId },
    include: { student: true, course: true },
  });
  if (!enrollment) return null;

  const fees = await prisma.fee.findMany({
    where: { individualCourseEnrollmentId: enrollment.id, instituteId },
    include: {
      feeStructure: true,
      installments: { orderBy: { installmentNo: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    enrollment,
    assignedCourseFee: enrollment.feeDue,
    fees,
    summary: summarizeFees(fees),
  };
}
