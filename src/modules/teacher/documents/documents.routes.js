import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { uploadLimiter } from '../../../middleware/rateLimiter.js';
import { documentUpload } from '../../../middleware/upload.js';
import { AppError } from '../../../utils/AppError.js';
import {
  uploadPersonDocument,
  deletePersonDocument,
  listPersonDocuments,
} from '../../../services/document.service.js';
import { prisma } from '../../../config/database.js';

const router = Router();
router.use(blockExpiredModuleAccess);

async function getOwnTeacher(req) {
  const teacher = await prisma.teacher.findFirst({
    where: { userId: req.user.id, instituteId: req.user.instituteId },
  });
  if (!teacher) throw new AppError('Teacher profile not found', 404);
  return teacher;
}

router.get('/', async (req, res, next) => {
  try {
    const teacher = await getOwnTeacher(req);
    const docs = await listPersonDocuments({
      instituteId: req.user.instituteId,
      teacherId: teacher.id,
    });
    return success(res, docs);
  } catch (err) { next(err); }
});

router.post('/', uploadLimiter, documentUpload.single('file'), async (req, res, next) => {
  try {
    const teacher = await getOwnTeacher(req);
    if (!req.file) throw new AppError('File is required', 400);

    const doc = await uploadPersonDocument({
      file: req.file,
      instituteId: req.user.instituteId,
      personType: 'TEACHER',
      teacherId: teacher.id,
      category: req.body.category || 'OTHER',
      title: req.body.title,
      uploadedById: req.user.id,
    });
    return success(res, doc, 'Document uploaded', 201);
  } catch (err) { next(err); }
});

router.delete('/:docId', async (req, res, next) => {
  try {
    const teacher = await getOwnTeacher(req);
    const doc = await prisma.personDocument.findFirst({
      where: {
        id: req.params.docId,
        instituteId: req.user.instituteId,
        teacherId: teacher.id,
      },
    });
    if (!doc) throw new AppError('Document not found', 404);
    await deletePersonDocument(doc, req.user.instituteId);
    return success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

export default router;
