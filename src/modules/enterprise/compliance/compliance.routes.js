import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { AppError } from '../../../utils/AppError.js';
import { prisma } from '../../../config/database.js';
import { enqueueJob } from '../../../jobs/jobQueue.js';
import { getVersionHistory } from '../../../documents/versioning.service.js';
import { replayPendingEvents } from '../../../events/eventDispatcher.js';

const router = Router();

router.post('/export', async (req, res, next) => {
  try {
    const { subjectType, subjectId } = req.body;
    if (!subjectType) throw new AppError('subjectType required', 400);
    const request = await prisma.dataExportRequest.create({
      data: {
        instituteId: req.user.instituteId,
        requestedById: req.user.id,
        subjectType,
        subjectId: subjectId || null,
      },
    });
    await enqueueJob('compliance.export', { requestId: request.id });
    return success(res, request, 'Export requested', 202);
  } catch (err) { next(err); }
});

router.post('/erasure', async (req, res, next) => {
  try {
    const { subjectType, subjectId, notes } = req.body;
    if (!subjectType || !subjectId) throw new AppError('subjectType and subjectId required', 400);
    const request = await prisma.erasureRequest.create({
      data: {
        instituteId: req.user.instituteId,
        subjectType,
        subjectId,
        requestedById: req.user.id,
        notes,
      },
    });
    return success(res, request, 'Erasure request submitted', 201);
  } catch (err) { next(err); }
});

router.post('/consent', async (req, res, next) => {
  try {
    const { consentType, granted, studentId } = req.body;
    const consent = await prisma.dataConsent.create({
      data: {
        instituteId: req.user.instituteId,
        userId: req.user.id,
        studentId: studentId || null,
        consentType,
        granted,
        grantedAt: granted ? new Date() : null,
        ipAddress: req.ip,
      },
    });
    return success(res, consent, 'Consent recorded', 201);
  } catch (err) { next(err); }
});

router.get('/documents/:entityType/:entityId/versions', async (req, res, next) => {
  try {
    const versions = await getVersionHistory(
      req.user.instituteId,
      req.params.entityType,
      req.params.entityId
    );
    return success(res, versions);
  } catch (err) { next(err); }
});

router.post('/events/replay', async (req, res, next) => {
  try {
    const count = await replayPendingEvents(req.body?.limit ?? 50);
    return success(res, { replayed: count });
  } catch (err) { next(err); }
});

export default router;
