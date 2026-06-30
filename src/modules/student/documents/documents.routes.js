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

async function getOwnStudent(req) {
  const student = await prisma.student.findFirst({
    where: { userId: req.user.id, instituteId: req.user.instituteId },
  });
  if (!student) throw new AppError('Student profile not found', 404);
  return student;
}

router.get('/', async (req, res, next) => {
  try {
    const student = await getOwnStudent(req);
    const docs = await listPersonDocuments({
      instituteId: req.user.instituteId,
      studentId: student.id,
    });
    return success(res, docs);
  } catch (err) { next(err); }
});

router.post('/', uploadLimiter, documentUpload.single('file'), async (req, res, next) => {
  try {
    const student = await getOwnStudent(req);
    if (!req.file) throw new AppError('File is required', 400);

    const doc = await uploadPersonDocument({
      file: req.file,
      instituteId: req.user.instituteId,
      personType: 'STUDENT',
      studentId: student.id,
      category: req.body.category || 'OTHER',
      title: req.body.title,
      uploadedById: req.user.id,
    });
    return success(res, doc, 'Document uploaded', 201);
  } catch (err) { next(err); }
});

router.delete('/:docId', async (req, res, next) => {
  try {
    const student = await getOwnStudent(req);
    const doc = await prisma.personDocument.findFirst({
      where: {
        id: req.params.docId,
        instituteId: req.user.instituteId,
        studentId: student.id,
      },
    });
    if (!doc) throw new AppError('Document not found', 404);
    await deletePersonDocument(doc, req.user.instituteId);
    return success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

export default router;
