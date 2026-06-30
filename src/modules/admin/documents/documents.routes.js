import { Router } from 'express';
import { prisma } from '../../../config/database.js';
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

const router = Router();
router.use(blockExpiredModuleAccess);

async function getStudent(id, instituteId) {
  const student = await prisma.student.findFirst({ where: { id, instituteId } });
  if (!student) throw new AppError('Student not found', 404);
  return student;
}

async function getTeacher(id, instituteId) {
  const teacher = await prisma.teacher.findFirst({ where: { id, instituteId } });
  if (!teacher) throw new AppError('Teacher not found', 404);
  return teacher;
}

router.get('/students/:id', async (req, res, next) => {
  try {
    await getStudent(req.params.id, req.user.instituteId);
    const docs = await listPersonDocuments({
      instituteId: req.user.instituteId,
      studentId: req.params.id,
    });
    return success(res, docs);
  } catch (err) { next(err); }
});

router.post('/students/:id', uploadLimiter, documentUpload.single('file'), async (req, res, next) => {
  try {
    await getStudent(req.params.id, req.user.instituteId);
    if (!req.file) throw new AppError('File is required', 400);

    const doc = await uploadPersonDocument({
      file: req.file,
      instituteId: req.user.instituteId,
      personType: 'STUDENT',
      studentId: req.params.id,
      category: req.body.category || 'OTHER',
      title: req.body.title,
      uploadedById: req.user.id,
    });
    return success(res, doc, 'Document uploaded', 201);
  } catch (err) { next(err); }
});

router.delete('/students/:studentId/:docId', async (req, res, next) => {
  try {
    await getStudent(req.params.studentId, req.user.instituteId);
    const doc = await prisma.personDocument.findFirst({
      where: {
        id: req.params.docId,
        instituteId: req.user.instituteId,
        studentId: req.params.studentId,
      },
    });
    if (!doc) throw new AppError('Document not found', 404);
    await deletePersonDocument(doc, req.user.instituteId);
    return success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

router.get('/teachers/:id', async (req, res, next) => {
  try {
    await getTeacher(req.params.id, req.user.instituteId);
    const docs = await listPersonDocuments({
      instituteId: req.user.instituteId,
      teacherId: req.params.id,
    });
    return success(res, docs);
  } catch (err) { next(err); }
});

router.post('/teachers/:id', uploadLimiter, documentUpload.single('file'), async (req, res, next) => {
  try {
    await getTeacher(req.params.id, req.user.instituteId);
    if (!req.file) throw new AppError('File is required', 400);

    const doc = await uploadPersonDocument({
      file: req.file,
      instituteId: req.user.instituteId,
      personType: 'TEACHER',
      teacherId: req.params.id,
      category: req.body.category || 'OTHER',
      title: req.body.title,
      uploadedById: req.user.id,
    });
    return success(res, doc, 'Document uploaded', 201);
  } catch (err) { next(err); }
});

router.delete('/teachers/:teacherId/:docId', async (req, res, next) => {
  try {
    await getTeacher(req.params.teacherId, req.user.instituteId);
    const doc = await prisma.personDocument.findFirst({
      where: {
        id: req.params.docId,
        instituteId: req.user.instituteId,
        teacherId: req.params.teacherId,
      },
    });
    if (!doc) throw new AppError('Document not found', 404);
    await deletePersonDocument(doc, req.user.instituteId);
    return success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

export default router;
