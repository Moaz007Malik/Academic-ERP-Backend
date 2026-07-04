import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { AppError } from '../../../utils/AppError.js';
import { prisma } from '../../../config/database.js';
import {
  createFormDefinition,
  submitForm,
  getFormBySlug,
  resolveAbVariant,
} from '../../../forms/formBuilder.service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const forms = await prisma.formDefinition.findMany({
      where: { instituteId: req.user.instituteId, deletedAt: null },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    return success(res, forms);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const form = await createFormDefinition(req.user.instituteId, req.body);
    return success(res, form, 'Form created', 201);
  } catch (err) { next(err); }
});

router.put('/:id/publish', async (req, res, next) => {
  try {
    const form = await prisma.formDefinition.updateMany({
      where: { id: req.params.id, instituteId: req.user.instituteId },
      data: { isPublished: true },
    });
    return success(res, form, 'Form published');
  } catch (err) { next(err); }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    const submission = await submitForm(req.user.instituteId, req.params.id, {
      submittedById: req.user.id,
      values: req.body.values,
      metadata: req.body.metadata,
    });
    return success(res, submission, 'Submitted', 201);
  } catch (err) { next(err); }
});

router.get('/public/:slug', async (req, res, next) => {
  try {
    const form = await getFormBySlug(req.user.instituteId, req.params.slug);
    if (!form) throw new AppError('Form not found', 404);
    return success(res, form);
  } catch (err) { next(err); }
});

router.get('/ab/:featureKey', async (req, res, next) => {
  try {
    const variant = await resolveAbVariant(
      req.params.featureKey,
      req.user.instituteId,
      req.user.id
    );
    return success(res, variant);
  } catch (err) { next(err); }
});

export default router;
