import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success, paginated } from '../../../utils/response.js';
import { parsePagination, buildPaginationMeta } from '../../../utils/pagination.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { uploadLimiter } from '../../../middleware/rateLimiter.js';
import { documentUpload } from '../../../middleware/upload.js';
import { AppError } from '../../../utils/AppError.js';
import {
  uploadCourseDocument,
  deleteCourseDocument,
  listCourseDocuments,
} from '../../../services/courseCatalogDocument.service.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.DEGREE));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { code: { contains: req.query.search, mode: 'insensitive' } },
      ];
    }
    const [courses, total] = await Promise.all([
      prisma.courseCatalog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { _count: { select: { documents: true, degreeSemesterCourses: true } } },
      }),
      prisma.courseCatalog.count({ where }),
    ]);
    return paginated(res, courses, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const course = await prisma.courseCatalog.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      include: { documents: { orderBy: { createdAt: 'desc' } } },
    });
    if (!course) throw new AppError('Course not found', 404);
    return success(res, course);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, code, creditHours, courseType, description, status } = req.body;
    if (!name?.trim() || !code?.trim()) throw new AppError('Name and code are required', 400);

    const instituteId = req.user.instituteId;
    const normalizedCode = String(code).trim().toUpperCase();
    const dup = await prisma.courseCatalog.findFirst({ where: { instituteId, code: normalizedCode } });
    if (dup) throw new AppError('Course code already exists', 409);

    const validTypes = ['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL'];
    const course = await prisma.courseCatalog.create({
      data: {
        instituteId,
        name: name.trim(),
        code: normalizedCode,
        creditHours: Number.isFinite(Number(creditHours)) ? Number(creditHours) : 3,
        courseType: validTypes.includes(courseType) ? courseType : 'THEORY',
        description: description?.trim() || null,
        status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      },
    });
    return success(res, course, 'Course created', 201);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.courseCatalog.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!existing) throw new AppError('Course not found', 404);

    const { name, code, creditHours, courseType, description, status } = req.body;
    const validTypes = ['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL'];

    if (code && String(code).trim().toUpperCase() !== existing.code) {
      const dup = await prisma.courseCatalog.findFirst({
        where: { instituteId: req.user.instituteId, code: String(code).trim().toUpperCase(), NOT: { id: existing.id } },
      });
      if (dup) throw new AppError('Course code already exists', 409);
    }

    const course = await prisma.courseCatalog.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(code !== undefined && { code: String(code).trim().toUpperCase() }),
        ...(creditHours !== undefined && { creditHours: Number(creditHours) || existing.creditHours }),
        ...(courseType !== undefined && { courseType: validTypes.includes(courseType) ? courseType : existing.courseType }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
      },
    });
    return success(res, course, 'Course updated');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const inUse = await prisma.degreeSemesterCourse.count({
      where: { courseId: req.params.id, instituteId: req.user.instituteId },
    });
    if (inUse > 0) {
      throw new AppError('Cannot delete a course that is assigned to a degree semester. Remove it from all semesters first.', 409);
    }
    await prisma.courseCatalog.deleteMany({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    return success(res, null, 'Course deleted');
  } catch (err) { next(err); }
});

router.get('/:id/documents', async (req, res, next) => {
  try {
    const course = await prisma.courseCatalog.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);
    const docs = await listCourseDocuments({ instituteId: req.user.instituteId, courseId: course.id });
    return success(res, docs);
  } catch (err) { next(err); }
});

router.post('/:id/documents', uploadLimiter, documentUpload.single('file'), async (req, res, next) => {
  try {
    const course = await prisma.courseCatalog.findFirst({
      where: { id: req.params.id, instituteId: req.user.instituteId },
    });
    if (!course) throw new AppError('Course not found', 404);
    if (!req.file) throw new AppError('File is required', 400);

    const doc = await uploadCourseDocument({
      file: req.file,
      instituteId: req.user.instituteId,
      courseId: course.id,
      category: req.body.category || 'OTHER',
      title: req.body.title,
      uploadedById: req.user.id,
    });
    return success(res, doc, 'Document uploaded', 201);
  } catch (err) { next(err); }
});

router.delete('/:id/documents/:docId', async (req, res, next) => {
  try {
    const doc = await prisma.courseCatalogDocument.findFirst({
      where: { id: req.params.docId, instituteId: req.user.instituteId, courseId: req.params.id },
    });
    if (!doc) throw new AppError('Document not found', 404);
    await deleteCourseDocument(doc, req.user.instituteId);
    return success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

export default router;
