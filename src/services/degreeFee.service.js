import { getOrCreateFeeStructure, createInstallments } from './fee.service.js';

/** Effective semester fee: custom semester fee or batch default */
export function getEffectiveSemesterFee(batch, semester) {
  if (semester?.semesterFee != null) return Number(semester.semesterFee);
  return Number(batch?.defaultSemesterFee || 0);
}

export function calcNetSemesterFee(semesterFee, discount, scholarship = 0) {
  return Math.max(0, Number(semesterFee || 0) - Number(discount || 0) - Number(scholarship || 0));
}

/**
 * Assign registration + semester fees for a degree student via existing Fee module.
 */
export async function assignDegreeStudentFees(tx, {
  instituteId, degreeStudent, batch, semester, semesterNumber,
}) {
  const created = [];
  const noteBase = `Degree batch: ${batch.name}`;
  const semLabel = semester?.name || `Semester ${semesterNumber || degreeStudent.currentSemesterNumber}`;

  const regStructure = await getOrCreateFeeStructure(tx, {
    instituteId, name: `Degree ${batch.name} - Registration`, amount: degreeStudent.registrationFee, frequency: 'ONE_TIME',
  });
  if (regStructure && Number(degreeStudent.registrationFee) > 0) {
    const dup = await tx.fee.findFirst({
      where: {
        instituteId, studentId: degreeStudent.studentId, degreeStudentId: degreeStudent.id,
        feeStructureId: regStructure.id, status: { in: ['PENDING', 'PARTIAL'] },
      },
    });
    if (!dup) {
      created.push(await tx.fee.create({
        data: {
          instituteId,
          track: 'DEGREE',
          studentId: degreeStudent.studentId,
          feeStructureId: regStructure.id,
          amount: degreeStudent.registrationFee,
          status: 'PENDING',
          assignmentScope: 'INDIVIDUAL',
          degreeStudentId: degreeStudent.id,
          notes: `${noteBase} — Registration`,
        },
      }));
    }
  }

  const semFee = Number(degreeStudent.netSemesterFee || 0);
  if (semFee > 0) {
    const semStructure = await getOrCreateFeeStructure(tx, {
      instituteId, name: `Degree ${batch.name} - ${semLabel}`, amount: semFee, frequency: 'SEMESTER',
    });
    const dup = await tx.fee.findFirst({
      where: {
        instituteId, studentId: degreeStudent.studentId, degreeStudentId: degreeStudent.id,
        feeStructureId: semStructure.id, status: { in: ['PENDING', 'PARTIAL'] },
        notes: { contains: semLabel },
      },
    });
    if (!dup) {
      created.push(await tx.fee.create({
        data: {
          instituteId,
          track: 'DEGREE',
          studentId: degreeStudent.studentId,
          feeStructureId: semStructure.id,
          amount: semFee,
          discount: 0,
          status: 'PENDING',
          assignmentScope: 'INDIVIDUAL',
          degreeStudentId: degreeStudent.id,
          notes: `${noteBase} — ${semLabel} (Fee: ${degreeStudent.semesterFee}, Discount: ${degreeStudent.discount}, Scholarship: ${degreeStudent.scholarship || 0})`,
        },
      }));
    }
  }

  return created;
}

/** Split semester fee into up to 6 installments — thin wrapper over the shared primitive. */
export async function createSemesterInstallments(tx, { instituteId, parentFee, installmentCount, firstDueDate }) {
  return createInstallments(tx, { instituteId, parentFee, installmentCount, firstDueDate });
}

/** Assign fees for all active students when batch is promoted to next semester */
export async function assignFeesOnBatchPromote(tx, { instituteId, batch, semester }) {
  const students = await tx.degreeStudent.findMany({
    where: { batchId: batch.id, instituteId, status: 'ACTIVE' },
  });
  let assigned = 0;
  for (const ds of students) {
    const semFee = getEffectiveSemesterFee(batch, semester);
    const net = calcNetSemesterFee(semFee, ds.discount, ds.scholarship);
    const updated = await tx.degreeStudent.update({
      where: { id: ds.id },
      data: { semesterFee: semFee, netSemesterFee: net, currentSemesterNumber: batch.currentSemester },
    });
    const fees = await assignDegreeStudentFees(tx, {
      instituteId, degreeStudent: updated, batch, semester, semesterNumber: batch.currentSemester,
    });
    if (updated.installmentEnabled && updated.installmentCount > 1) {
      const semRecord = fees.find((f) => (f.notes || '').includes('Semester'));
      if (semRecord) {
        await createSemesterInstallments(tx, {
          instituteId,
          parentFee: semRecord,
          installmentCount: updated.installmentCount,
          firstDueDate: semester?.startDate,
        });
      }
    }
    assigned += fees.length;
  }
  return assigned;
}
