import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { AppError } from '../../../utils/AppError.js';
import { prisma } from '../../../config/database.js';
import {
  startWorkflow,
  transitionWorkflow,
  ensureWorkflowDefinition,
  WORKFLOW_TEMPLATES,
} from '../../../workflows/workflowEngine.js';

const router = Router();

router.get('/types', (_req, res) => {
  return success(res, Object.keys(WORKFLOW_TEMPLATES));
});

router.post('/start', async (req, res, next) => {
  try {
    const { workflowType, entityType, entityId, metadata } = req.body;
    if (!workflowType || !entityType || !entityId) {
      throw new AppError('workflowType, entityType, entityId required', 400);
    }
    const instance = await startWorkflow({
      instituteId: req.user.instituteId,
      workflowType,
      entityType,
      entityId,
      initiatedById: req.user.id,
      metadata,
    });
    return success(res, instance, 'Workflow started', 201);
  } catch (err) { next(err); }
});

router.post('/:instanceId/transition', async (req, res, next) => {
  try {
    const { action, comments } = req.body;
    const updated = await transitionWorkflow({
      instanceId: req.params.instanceId,
      action,
      actorId: req.user.id,
      actorRole: req.user.role,
      comments,
    });
    return success(res, updated, 'Workflow updated');
  } catch (err) { next(err); }
});

router.get('/:instanceId', async (req, res, next) => {
  try {
    const instance = await prisma.workflowInstance.findFirst({
      where: { id: req.params.instanceId, instituteId: req.user.instituteId },
      include: {
        approvals: { include: { approver: { select: { firstName: true, lastName: true } } } },
        auditLogs: { orderBy: { createdAt: 'asc' } },
        definition: { include: { states: true, transitions: true } },
      },
    });
    if (!instance) throw new AppError('Not found', 404);
    return success(res, instance);
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const where = { instituteId: req.user.instituteId };
    if (req.query.status) where.status = req.query.status;
    if (req.query.workflowType) where.workflowType = req.query.workflowType;
    const instances = await prisma.workflowInstance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return success(res, instances);
  } catch (err) { next(err); }
});

router.post('/definitions/seed', async (req, res, next) => {
  try {
    const { workflowType } = req.body;
    const def = await ensureWorkflowDefinition(req.user.instituteId, workflowType);
    return success(res, def, 'Definition ready');
  } catch (err) { next(err); }
});

export default router;
