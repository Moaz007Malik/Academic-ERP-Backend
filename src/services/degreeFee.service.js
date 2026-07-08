/** Effective semester fee: custom semester fee or batch default */
export function getEffectiveSemesterFee(batch, semester) {
  if (semester?.semesterFee != null) return Number(semester.semesterFee);
  return Number(batch?.defaultSemesterFee || 0);
}

export function calcNetSemesterFee(semesterFee, discount, scholarship = 0) {
  return Math.max(0, Number(semesterFee || 0) - Number(discount || 0) - Number(scholarship || 0));
}

async function getOrCreateStructure(tx, instituteId, name, amount, frequency) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  let structure = await tx.feeStructure.findFirst({ where: { instituteId, name } });
  if (!structure) {
    structure = await tx.feeStructure.create({
      data: { instituteId, name, amount: amt, frequency: frequency || 'ONE_TIME' },
    });
  }
  return structure;
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

  const regStructure = await getOrCreateStructure(
    tx, instituteId, `Degree ${batch.name} - Registration`, degreeStudent.registrationFee, 'ONE_TIME',
  );
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
    const semStructure = await getOrCreateStructure(
      tx, instituteId, `Degree ${batch.name} - ${semLabel}`, semFee, 'SEMESTER',
    );
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

/**
 * Split semester fee into up to 6 installments using parent/child Fee rows.
 */
export async function createSemesterInstallments(tx, {
  instituteId, parentFee, installmentCount, firstDueDate,
}) {
  const count = Math.min(Math.max(Number(installmentCount) || 1, 1), 6);
  if (count <= 1) return [parentFee];

  const total = Number(parentFee.amount) - Number(parentFee.discount || 0);
  const perInstallment = Math.round((total / count) * 100) / 100;
  const remainder = Math.round((total - perInstallment * count) * 100) / 100;

  await tx.fee.update({
    where: { id: parentFee.id },
    data: { status: 'PARTIAL', notes: `${parentFee.notes || ''} — Parent (installment plan)`.trim() },
  });

  const installments = [];
  for (let i = 1; i <= count; i++) {
    const extra = i === count ? remainder : 0;
    const amount = perInstallment + extra;
    const due = firstDueDate ? new Date(firstDueDate) : new Date();
    due.setMonth(due.getMonth() + (i - 1));
    installments.push(await tx.fee.create({
      data: {
        instituteId,
        studentId: parentFee.studentId,
        feeStructureId: parentFee.feeStructureId,
        amount,
        parentFeeId: parentFee.id,
        installmentNo: i,
        dueDate: due,
        status: 'PENDING',
        assignmentScope: parentFee.assignmentScope,
        degreeStudentId: parentFee.degreeStudentId,
        notes: `Installment ${i} of ${count}`,
      },
    }));
  }

  return installments;
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
