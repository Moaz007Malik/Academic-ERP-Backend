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
      },
      include: { student: true, feeStructure: true },
    });
    return success(res, fee, 'Fee assigned', 201);
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
