import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.ID_CARD_DESIGNER));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const designs = await prisma.cardDesign.findMany({
      where: { instituteId: req.user.instituteId },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, designs);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { fileUrl, type } = req.body;
    if (!fileUrl) throw new AppError('fileUrl is required', 400);
    const design = await prisma.cardDesign.create({
      data: {
        instituteId: req.user.instituteId,
        fileUrl,
        type: type || 'STUDENT_ID',
      },
    });
    return success(res, design, 'Card design saved', 201);
  } catch (err) { next(err); }
});

router.get('/preview/:studentId', async (req, res, next) => {
  try {
    const student = await prisma.student.findFirst({
      where: { id: req.params.studentId, instituteId: req.user.instituteId },
      include: {
        institute: { select: { name: true, logo: true, address: true, phone: true } },
        currentBatch: true,
        currentSection: true,
      },
    });
    if (!student) throw new AppError('Student not found', 404);

    const design = await prisma.cardDesign.findFirst({
      where: { instituteId: req.user.instituteId },
      orderBy: { createdAt: 'desc' },
    });

    return success(res, {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        rollNumber: student.rollNumber,
        photo: student.photo,
        batch: student.currentBatch?.name,
        section: student.currentSection?.name,
      },
      institute: student.institute,
      design,
      qrData: JSON.stringify({
        studentId: student.id,
        rollNumber: student.rollNumber,
        instituteId: student.instituteId,
      }),
    });
  } catch (err) { next(err); }
});

export default router;
