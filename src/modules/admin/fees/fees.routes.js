import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.FEES_FINANCE));
router.use(blockExpiredModuleAccess);

router.get('/structures', async (req, res, next) => {
  try {
    const structures = await prisma.feeStructure.findMany({
      where: { instituteId: req.user.instituteId },
      orderBy: { name: 'asc' },
    });
    return success(res, structures);
  } catch (err) { next(err); }
});

router.post('/structures', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { name, amount, frequency } = req.body;
    if (!name?.trim() || amount == null) throw new AppError('Name and amount required', 400);
    const existing = await prisma.feeStructure.findFirst({ where: { instituteId, name: name.trim() } });
    if (existing) throw new AppError('A fee structure with this name already exists', 409);
    const structure = await prisma.feeStructure.create({
      data: { instituteId, name: name.trim(), amount, frequency: frequency || 'MONTHLY' },
    });
    return success(res, structure, 'Fee structure created', 201);
  } catch (err) { next(err); }
});

router.put('/structures/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const structure = await prisma.feeStructure.findFirst({ where: { id: req.params.id, instituteId } });
    if (!structure) throw new AppError('Fee structure not found', 404);
    const { name, amount, frequency } = req.body;
    if (name) {
      const dup = await prisma.feeStructure.findFirst({ where: { instituteId, name: name.trim(), NOT: { id: req.params.id } } });
      if (dup) throw new AppError('A fee structure with this name already exists', 409);
    }
    const updated = await prisma.feeStructure.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(amount !== undefined && { amount }),
        ...(frequency !== undefined && { frequency }),
      },
    });
    return success(res, updated, 'Fee structure updated');
  } catch (err) { next(err); }
});

router.delete('/structures/:id', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const structure = await prisma.feeStructure.findFirst({ where: { id: req.params.id, instituteId } });
    if (!structure) throw new AppError('Fee structure not found', 404);
    const paid = await prisma.fee.count({ where: { feeStructureId: req.params.id, instituteId, status: 'PAID' } });
    if (paid) throw new AppError('Cannot delete: paid fees exist for this structure', 400);
    await prisma.fee.deleteMany({ where: { feeStructureId: req.params.id, instituteId, status: 'PENDING' } });
    await prisma.feeStructure.delete({ where: { id: req.params.id } });
    return success(res, null, 'Fee structure deleted');
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.studentId) where.studentId = req.query.studentId;

    const fees = await prisma.fee.findMany({
      where,
      include: {
        student: { select: { firstName: true, lastName: true, rollNumber: true } },
        feeStructure: true,
        installments: { orderBy: { installmentNo: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, fees);
  } catch (err) { next(err); }
});

router.post('/assign', async (req, res, next) => {
  try {
    const { studentId, feeStructureId, dueDate, discount } = req.body;
    if (!studentId || !feeStructureId) throw new AppError('Student and fee structure required', 400);

    const structure = await prisma.feeStructure.findFirst({
      where: { id: feeStructureId, instituteId: req.user.instituteId },
    });
    if (!structure) throw new AppError('Fee structure not found', 404);

    const duplicate = await prisma.fee.findFirst({
      where: {
        instituteId: req.user.instituteId,
        studentId,
        feeStructureId,
        status: 'PENDING',
        parentFeeId: null,
      },
    });
    if (duplicate) throw new AppError('This student already has a pending fee of this type', 409);

    const fee = await prisma.fee.create({
      data: {
        instituteId: req.user.instituteId,
        studentId,
        feeStructureId,
        amount: structure.amount,
        discount: discount || 0,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'PENDING',
        assignmentScope: 'INDIVIDUAL',
      },
      include: { student: true, feeStructure: true },
    });
    return success(res, fee, 'Fee assigned', 201);
  } catch (err) { next(err); }
});

router.post('/assign/bulk', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { scope, feeStructureId, dueDate, discount, batchIds, studentIds } = req.body;
    if (!feeStructureId || !scope) throw new AppError('feeStructureId and scope are required', 400);

    const structure = await prisma.feeStructure.findFirst({
      where: { id: feeStructureId, instituteId },
    });
    if (!structure) throw new AppError('Fee structure not found', 404);

    let targetStudents = [];
    if (scope === 'ALL_STUDENTS') {
      targetStudents = await prisma.student.findMany({
        where: { instituteId, status: 'ACTIVE' },
        select: { id: true },
      });
    } else if (scope === 'BATCH') {
      if (!batchIds?.length) throw new AppError('batchIds required for BATCH scope', 400);
      targetStudents = await prisma.student.findMany({
        where: { instituteId, status: 'ACTIVE', currentBatchId: { in: batchIds } },
        select: { id: true },
      });
    } else if (scope === 'INDIVIDUAL') {
      if (!studentIds?.length) throw new AppError('studentIds required for INDIVIDUAL scope', 400);
      targetStudents = studentIds.map((id) => ({ id }));
    } else {
      throw new AppError('Invalid scope. Use ALL_STUDENTS, BATCH, or INDIVIDUAL', 400);
    }

    const assignmentScope = scope === 'ALL_STUDENTS' ? 'ALL_STUDENTS' : scope === 'BATCH' ? 'BATCH' : 'INDIVIDUAL';
    const created = [];
    const skipped = [];

    for (const { id: studentId } of targetStudents) {
      const duplicate = await prisma.fee.findFirst({
        where: { instituteId, studentId, feeStructureId, status: 'PENDING', parentFeeId: null },
      });
      if (duplicate) {
        skipped.push(studentId);
        continue;
      }
      const fee = await prisma.fee.create({
        data: {
          instituteId,
          studentId,
          feeStructureId,
          amount: structure.amount,
          discount: discount || 0,
          dueDate: dueDate ? new Date(dueDate) : null,
          status: 'PENDING',
          assignmentScope,
        },
      });
      created.push(fee);
    }

    return success(res, { created: created.length, skipped: skipped.length, fees: created }, `Fee assigned to ${created.length} students`, 201);
  } catch (err) { next(err); }
});

// ─── Fee Requests (admin) ─────────────────────────────────────────────────────

router.get('/requests', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    const requests = await prisma.feeRequest.findMany({
      where,
      include: {
        student: { select: { firstName: true, lastName: true, rollNumber: true } },
        fee: { include: { feeStructure: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, requests);
  } catch (err) { next(err); }
});

router.post('/requests/:id/review', async (req, res, next) => {
  try {
    const instituteId = req.user.instituteId;
    const { action, adminNotes, installmentCount, extensionDays, approvedAmount } = req.body;
    const request = await prisma.feeRequest.findFirst({
      where: { id: req.params.id, instituteId },
      include: { fee: true, student: true },
    });
    if (!request) throw new AppError('Fee request not found', 404);
    if (request.status !== 'PENDING') throw new AppError('Request already reviewed', 400);

    if (action === 'REJECT') {
      const updated = await prisma.feeRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', adminNotes, reviewedById: req.user.id, reviewedAt: new Date() },
      });
      return success(res, updated, 'Request rejected');
    }

    const updates = {
      status: action === 'PARTIAL_APPROVED' ? 'PARTIAL_APPROVED' : 'APPROVED',
      adminNotes,
      reviewedById: req.user.id,
      reviewedAt: new Date(),
      installmentCount: installmentCount || request.installmentCount,
      extensionDays: extensionDays || request.extensionDays,
      approvedAmount: approvedAmount ?? request.approvedAmount,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const reqUpdated = await tx.feeRequest.update({ where: { id: request.id }, data: updates });

      if (request.feeId && request.fee) {
        const fee = request.fee;
        if (action === 'EXTEND_DUE' || request.requestType === 'DUE_DATE_EXTENSION') {
          const days = extensionDays || request.extensionDays || 7;
          const newDue = fee.dueDate ? new Date(fee.dueDate) : new Date();
          newDue.setDate(newDue.getDate() + days);
          await tx.fee.update({ where: { id: fee.id }, data: { dueDate: newDue } });
        }

        if ((action === 'INSTALLMENT' || request.requestType === 'INSTALLMENT') && installmentCount > 1) {
          const count = installmentCount || 2;
          const netAmount = Number(fee.amount) - Number(fee.discount);
          const perInstallment = Math.round((netAmount / count) * 100) / 100;
          await tx.fee.update({
            where: { id: fee.id },
            data: { status: 'PARTIAL', notes: `Split into ${count} installments` },
          });
          const baseDue = fee.dueDate ? new Date(fee.dueDate) : new Date();
          for (let i = 1; i <= count; i++) {
            const due = new Date(baseDue);
            due.setMonth(due.getMonth() + (i - 1));
            await tx.fee.create({
              data: {
                instituteId,
                studentId: fee.studentId,
                feeStructureId: fee.feeStructureId,
                amount: perInstallment,
                dueDate: due,
                status: 'PENDING',
                parentFeeId: fee.id,
                installmentNo: i,
                assignmentScope: 'INDIVIDUAL',
              },
            });
          }
        }

        if (approvedAmount != null && request.requestType === 'PARTIAL_PAYMENT') {
          await tx.fee.update({
            where: { id: fee.id },
            data: { amount: approvedAmount, status: 'PARTIAL' },
          });
        }

        if (request.requestType === 'CONCESSION' && approvedAmount != null) {
          const discount = Number(fee.amount) - Number(approvedAmount);
          await tx.fee.update({
            where: { id: fee.id },
            data: { discount: Math.max(0, discount) },
          });
        }
      }

      return reqUpdated;
    });

    return success(res, updated, 'Request processed');
  } catch (err) { next(err); }
});

router.post('/:id/collect', async (req, res, next) => {
  try {
    const fee = await prisma.fee.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!fee) throw new AppError('Fee not found', 404);

    const receiptNumber = `RCP-${Date.now()}`;
    const updated = await prisma.fee.update({
      where: { id: fee.id },
      data: {
        status: 'PAID',
        paidDate: new Date(),
        receiptNumber,
        collectedById: req.user.id,
        fine: req.body.fine ?? fee.fine,
      },
      include: { student: true, feeStructure: true },
    });

    const { events } = await import('../../../events/eventBus.js');
    await events.feeCollected({
      aggregateId: fee.id,
      instituteId: req.user.instituteId,
      payload: {
        feeId: fee.id,
        studentId: fee.studentId,
        amount: Number(updated.amount),
        receiptNumber,
        actorId: req.user.id,
      },
    });

    return success(res, updated, 'Fee collected');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const fee = await prisma.fee.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!fee) throw new AppError('Fee not found', 404);
    if (fee.status === 'PAID') throw new AppError('Cannot delete a paid fee record', 400);
    await prisma.fee.delete({ where: { id: fee.id } });
    return success(res, null, 'Fee record deleted');
  } catch (err) { next(err); }
});

export default router;
