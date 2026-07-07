function monthsBetween(start, end) {
  if (!start || !end) return 1;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return 1;
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.min(Math.max(months, 1), 24);
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
 * Auto-assign finance fees when a student enrolls in an individual course.
 */
export async function assignIndividualCourseFees(tx, {
  instituteId, course, enrollment, studentId, markedById,
}) {
  const totalDiscount = Number(course.discountAmount || 0) + Number(course.scholarshipAmount || 0);
  let discountLeft = totalDiscount;
  const created = [];
  const noteBase = `Individual course: ${course.name} (${course.code})`;

  const addFee = async (structure, extraDiscount = 0) => {
    if (!structure) return;
    const discount = Math.min(discountLeft + extraDiscount, Number(structure.amount));
    discountLeft = Math.max(0, discountLeft - discount);
    const fee = await tx.fee.create({
      data: {
        instituteId,
        studentId,
        feeStructureId: structure.id,
        amount: structure.amount,
        discount,
        status: 'PENDING',
        assignmentScope: 'INDIVIDUAL',
        individualCourseEnrollmentId: enrollment.id,
        notes: noteBase,
        ...(markedById && { collectedById: null }),
      },
    });
    created.push(fee);
  };

  const admission = await getOrCreateStructure(
    tx, instituteId, `IC ${course.code} - Admission`, course.admissionFee, 'ONE_TIME',
  );
  await addFee(admission);

  const oneTime = await getOrCreateStructure(
    tx, instituteId, `IC ${course.code} - One Time`, course.oneTimeFee, 'ONE_TIME',
  );
  await addFee(oneTime);

  const monthlyAmt = Number(course.monthlyFee || 0);
  if (monthlyAmt > 0) {
    const monthlyStructure = await getOrCreateStructure(
      tx, instituteId, `IC ${course.code} - Monthly`, monthlyAmt, 'MONTHLY',
    );
    const monthCount = monthsBetween(course.startDate, course.endDate);
    for (let i = 0; i < monthCount; i++) {
      const due = course.startDate ? new Date(course.startDate) : new Date();
      due.setMonth(due.getMonth() + i);
      const discount = i === 0 ? Math.min(discountLeft, monthlyAmt) : 0;
      if (i === 0) discountLeft = Math.max(0, discountLeft - discount);
      const fee = await tx.fee.create({
        data: {
          instituteId,
          studentId,
          feeStructureId: monthlyStructure.id,
          amount: monthlyAmt,
          discount,
          dueDate: due,
          status: 'PENDING',
          assignmentScope: 'INDIVIDUAL',
          individualCourseEnrollmentId: enrollment.id,
          notes: `${noteBase} — Month ${i + 1}`,
        },
      });
      created.push(fee);
    }
  }

  return created;
}

export function calculateEnrollmentFeeDue(course) {
  const oneTime = Number(course.admissionFee || 0) + Number(course.oneTimeFee || 0);
  const monthly = Number(course.monthlyFee || 0);
  const months = monthsBetween(course.startDate, course.endDate);
  const discount = Number(course.discountAmount || 0) + Number(course.scholarshipAmount || 0);
  return Math.max(0, oneTime + monthly * months - discount);
}
