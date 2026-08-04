/** Shared Fee primitives used by all 3 tracks' fee-assignment services
 * (studentClassFee.service.js, degreeFee.service.js, individualCourseFee.service.js)
 * and by fees.routes.js. Mirrors the "one shared engine, track-specific callers" pattern
 * established by attendance.service.js / teacherAssignment.service.js. */

/** Race-safe get-or-create: FeeStructure has a unique (instituteId, name) constraint, so a
 * concurrent create is caught and resolved by re-fetching rather than producing a duplicate. */
export async function getOrCreateFeeStructure(tx, { instituteId, name, amount, frequency }) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return null;
  const existing = await tx.feeStructure.findFirst({ where: { instituteId, name } });
  if (existing) return existing;
  try {
    return await tx.feeStructure.create({
      data: { instituteId, name, amount: amt, frequency: frequency || 'ONE_TIME' },
    });
  } catch (err) {
    if (err.code === 'P2002') return tx.feeStructure.findFirst({ where: { instituteId, name } });
    throw err;
  }
}

/** Splits a Fee into 1-6 installment child rows (self-referencing via parentFeeId), carrying
 * the parent's track/scope FKs forward so each installment stays correctly attributed. */
export async function createInstallments(tx, { instituteId, parentFee, installmentCount, firstDueDate }) {
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
        track: parentFee.track,
        studentId: parentFee.studentId,
        feeStructureId: parentFee.feeStructureId,
        amount,
        parentFeeId: parentFee.id,
        installmentNo: i,
        dueDate: due,
        status: 'PENDING',
        assignmentScope: parentFee.assignmentScope,
        degreeStudentId: parentFee.degreeStudentId,
        individualCourseEnrollmentId: parentFee.individualCourseEnrollmentId,
        notes: `Installment ${i} of ${count}`,
      },
    }));
  }

  return installments;
}

/** Cross-track summary: total/paid/remaining (fine-inclusive, discount-net) plus installment
 * plan breakdowns. The one formula every list/detail view should use — don't reimplement. */
export function summarizeFees(fees) {
  let paid = 0;
  let remaining = 0;
  const installmentPlans = [];

  for (const f of fees) {
    const amt = Number(f.amount || 0) + Number(f.fine || 0) - Number(f.discount || 0);
    if (f.status === 'PAID') paid += amt;
    else remaining += amt;
    if (f.installments?.length) {
      installmentPlans.push({
        parentFee: f,
        installments: f.installments,
        paidInstallments: f.installments.filter((i) => i.status === 'PAID').length,
        remainingInstallments: f.installments.filter((i) => i.status !== 'PAID').length,
        remainingBalance: f.installments
          .filter((i) => i.status !== 'PAID')
          .reduce((s, i) => s + Number(i.amount) + Number(i.fine || 0) - Number(i.discount || 0), 0),
      });
    }
  }

  return {
    total: paid + remaining,
    paid,
    remaining,
    installmentPlans,
    paymentHistory: fees.filter((f) => f.status === 'PAID'),
  };
}

/** Net paid/due for a flat list of { status, amount, discount, fine } — the exact formula
 * summarizeFees uses, factored out so list-view aggregations (financeHub.routes.js) can't drift. */
export function aggregateFeeTotals(fees) {
  const pending = fees.filter((f) => f.status === 'PENDING' || f.status === 'PARTIAL');
  const paid = fees.filter((f) => f.status === 'PAID');
  const net = (list) => list.reduce((s, f) => s + Number(f.amount) - Number(f.discount || 0) + Number(f.fine || 0), 0);
  return { paidAmount: net(paid), dueAmount: net(pending) };
}
