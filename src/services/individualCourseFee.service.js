import { getOrCreateFeeStructure } from './fee.service.js';

function monthsBetween(start, end) {
  if (!start || !end) return 1;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return 1;
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.min(Math.max(months, 1), 24);
}

/**
 * Auto-assign finance fees based on course paymentType.
 * MONTHLY → admission (if any) + monthly installments
 * ONE_TIME → admission (if any) + one-time fee only (no monthly dues)
 * Skips if fees were already assigned for this enrollment (idempotent, like the Degree/Academic
 * equivalents — this used to be missing here, allowing double-creation on repeat calls).
 */
export async function assignIndividualCourseFees(tx, {
  instituteId, course, enrollment, studentId,
}) {
  const alreadyAssigned = await tx.fee.count({ where: { individualCourseEnrollmentId: enrollment.id } });
  if (alreadyAssigned > 0) return [];

  const paymentType = course.paymentType === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME';
  const totalDiscount = Number(course.discountAmount || 0) + Number(course.scholarshipAmount || 0);
  let discountLeft = totalDiscount;
  const created = [];
  const noteBase = `Individual course: ${course.name} (${course.code}) [${paymentType}]`;

  const addFee = async (structure, notesExtra = '') => {
    if (!structure) return;
    const original = Number(structure.amount);
    const discount = Math.min(discountLeft, original);
    discountLeft = Math.max(0, discountLeft - discount);
    const payable = Math.max(0, original - discount);
    if (payable <= 0 && original <= 0) return;
    const fee = await tx.fee.create({
      data: {
        instituteId,
        track: 'INDIVIDUAL_COURSE',
        studentId,
        feeStructureId: structure.id,
        amount: original,
        discount,
        status: 'PENDING',
        assignmentScope: 'INDIVIDUAL',
        individualCourseEnrollmentId: enrollment.id,
        notes: `${noteBase}${notesExtra} — Original: ${original}, Discount: ${discount}, Payable: ${payable}`,
      },
    });
    created.push(fee);
  };

  // Admission fee applies to both payment types when configured
  const admission = await getOrCreateFeeStructure(tx, {
    instituteId, name: `IC ${course.code} - Admission`, amount: course.admissionFee, frequency: 'ONE_TIME',
  });
  await addFee(admission, ' — Admission');

  if (paymentType === 'ONE_TIME') {
    const oneTimeAmt = Number(course.oneTimeFee || 0) > 0
      ? course.oneTimeFee
      : (Number(course.monthlyFee || 0) > 0 ? course.monthlyFee : 0);
    const oneTime = await getOrCreateFeeStructure(tx, {
      instituteId, name: `IC ${course.code} - One Time`, amount: oneTimeAmt, frequency: 'ONE_TIME',
    });
    await addFee(oneTime, ' — One-Time');
  } else {
    // MONTHLY: generate monthly fee records; do not assign one-time course fee
    const monthlyAmt = Number(course.monthlyFee || 0);
    if (monthlyAmt > 0) {
      const monthlyStructure = await getOrCreateFeeStructure(tx, {
        instituteId, name: `IC ${course.code} - Monthly`, amount: monthlyAmt, frequency: 'MONTHLY',
      });
      const monthCount = monthsBetween(course.startDate, course.endDate);
      for (let i = 0; i < monthCount; i++) {
        const due = course.startDate ? new Date(course.startDate) : new Date();
        due.setMonth(due.getMonth() + i);
        const discount = i === 0 ? Math.min(discountLeft, monthlyAmt) : 0;
        if (i === 0) discountLeft = Math.max(0, discountLeft - discount);
        const payable = Math.max(0, monthlyAmt - discount);
        const fee = await tx.fee.create({
          data: {
            instituteId,
            track: 'INDIVIDUAL_COURSE',
            studentId,
            feeStructureId: monthlyStructure.id,
            amount: monthlyAmt,
            discount,
            dueDate: due,
            status: 'PENDING',
            assignmentScope: 'INDIVIDUAL',
            individualCourseEnrollmentId: enrollment.id,
            notes: `${noteBase} — Month ${i + 1} — Original: ${monthlyAmt}, Discount: ${discount}, Payable: ${payable}`,
          },
        });
        created.push(fee);
      }
    }
  }

  return created;
}

export function calculateEnrollmentFeeDue(course) {
  const paymentType = course.paymentType === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME';
  const admission = Number(course.admissionFee || 0);
  const discount = Number(course.discountAmount || 0) + Number(course.scholarshipAmount || 0);

  if (paymentType === 'ONE_TIME') {
    const oneTime = Number(course.oneTimeFee || 0) > 0
      ? Number(course.oneTimeFee)
      : Number(course.monthlyFee || 0);
    return Math.max(0, admission + oneTime - discount);
  }

  const monthly = Number(course.monthlyFee || 0);
  const months = monthsBetween(course.startDate, course.endDate);
  return Math.max(0, admission + monthly * months - discount);
}
