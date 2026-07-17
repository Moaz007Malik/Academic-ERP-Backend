/** Assign Registration + Monthly fees from Academic Class for a student */
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

export function calcNetFee(amount, discount = 0) {
  return Math.max(0, Number(amount || 0) - Number(discount || 0));
}

/**
 * Resolve class fees for a batch (via AcademicClass).
 */
export async function getClassFeesForBatch(tx, batchId, instituteId) {
  const batch = await tx.batch.findFirst({
    where: { id: batchId, instituteId },
    include: { academicClass: true },
  });
  if (!batch?.academicClass) {
    return { registrationFee: 0, monthlyFee: 0, academicClass: null, batch };
  }
  return {
    registrationFee: Number(batch.academicClass.registrationFee || 0),
    monthlyFee: Number(batch.academicClass.monthlyFee || 0),
    academicClass: batch.academicClass,
    batch,
  };
}

/**
 * Create Fee records from student fee snapshot (class fees − discounts).
 * Skips if already assigned.
 */
export async function assignStudentClassFees(tx, {
  instituteId, student, registrationFee, monthlyFee, registrationDiscount = 0, monthlyDiscount = 0,
}) {
  const created = [];
  const className = student.currentBatch?.academicClass?.name
    || student.currentBatch?.name
    || 'Class';

  const origReg = Number(registrationFee) || 0;
  const regDisc = Math.min(Number(registrationDiscount) || 0, origReg);
  const netReg = calcNetFee(origReg, regDisc);

  const regStructure = await getOrCreateStructure(
    tx, instituteId, `${className} - Registration Fee`, origReg || netReg, 'ONE_TIME',
  );
  if (regStructure && netReg > 0) {
    const dup = await tx.fee.findFirst({
      where: {
        instituteId,
        studentId: student.id,
        feeStructureId: regStructure.id,
        degreeStudentId: null,
        individualCourseEnrollmentId: null,
        status: { in: ['PENDING', 'PARTIAL', 'PAID'] },
      },
    });
    if (!dup) {
      created.push(await tx.fee.create({
        data: {
          instituteId,
          studentId: student.id,
          feeStructureId: regStructure.id,
          amount: origReg,
          discount: regDisc,
          status: 'PENDING',
          assignmentScope: 'INDIVIDUAL',
          notes: `Registration — Original: ${origReg}, Discount: ${regDisc}, Payable: ${netReg}`,
        },
      }));
    }
  }

  const origMonthly = Number(monthlyFee) || 0;
  const monthDisc = Math.min(Number(monthlyDiscount) || 0, origMonthly);
  const netMonthly = calcNetFee(origMonthly, monthDisc);

  const monthlyStructure = await getOrCreateStructure(
    tx, instituteId, `${className} - Monthly Fee`, origMonthly || netMonthly, 'MONTHLY',
  );
  if (monthlyStructure && netMonthly > 0) {
    const dup = await tx.fee.findFirst({
      where: {
        instituteId,
        studentId: student.id,
        feeStructureId: monthlyStructure.id,
        degreeStudentId: null,
        individualCourseEnrollmentId: null,
        status: { in: ['PENDING', 'PARTIAL'] },
      },
    });
    if (!dup) {
      created.push(await tx.fee.create({
        data: {
          instituteId,
          studentId: student.id,
          feeStructureId: monthlyStructure.id,
          amount: origMonthly,
          discount: monthDisc,
          status: 'PENDING',
          assignmentScope: 'INDIVIDUAL',
          notes: `Monthly — Original: ${origMonthly}, Discount: ${monthDisc}, Payable: ${netMonthly}`,
        },
      }));
    }
  }

  return created;
}
