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
  instituteId, degreeStudent, batch, semester,
}) {
  const created = [];
  const noteBase = `Degree batch: ${batch.name}`;

  const regStructure = await getOrCreateStructure(
    tx, instituteId, `Degree ${batch.name} - Registration`, degreeStudent.registrationFee, 'ONE_TIME',
  );
  if (regStructure) {
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

  const semFee = Number(degreeStudent.netSemesterFee || 0);
  if (semFee > 0) {
    const semName = semester?.name || `Semester ${degreeStudent.currentSemesterNumber}`;
    const semStructure = await getOrCreateStructure(
      tx, instituteId, `Degree ${batch.name} - ${semName}`, semFee, 'SEMESTER',
    );
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
        notes: `${noteBase} — ${semName} (Original: ${degreeStudent.semesterFee}, Discount: ${degreeStudent.discount})`,
      },
    }));
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
  let remainder = Math.round((total - perInstallment * count) * 100) / 100;

  await tx.fee.update({
    where: { id: parentFee.id },
    data: { notes: `${parentFee.notes || ''} — Parent (installment plan)`.trim() },
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

  await tx.fee.update({ where: { id: parentFee.id }, data: { status: 'PENDING' } });
  return installments;
}

export function calcNetSemesterFee(semesterFee, discount) {
  return Math.max(0, Number(semesterFee || 0) - Number(discount || 0));
}
