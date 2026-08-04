import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { requirePermission } from '../../../middleware/rbac.js';
import { AppError } from '../../../utils/AppError.js';
import { createSlot, updateSlot, removeSlot, getTimetable } from '../../../services/timetable.service.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.TIMETABLE));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { track, sectionId, degreeCourseId, individualCourseId, teacherId } = req.query;
    const timetable = await getTimetable({ instituteId: req.user.instituteId, track, sectionId, degreeCourseId, individualCourseId, teacherId });
    return success(res, timetable);
  } catch (err) { next(err); }
});

router.post('/', requirePermission('MANAGE_TIMETABLE'), async (req, res, next) => {
  try {
    const {
      track, dayOfWeek, startTime, endTime, room, teacherId,
      subjectId, sectionId, degreeCourseId, individualCourseId,
    } = req.body;
    const slot = await createSlot({
      instituteId: req.user.instituteId, track, dayOfWeek, startTime, endTime, room, teacherId,
      subjectId, sectionId, degreeCourseId, individualCourseId,
    });
    return success(res, slot, 'Timetable slot created', 201);
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('MANAGE_TIMETABLE'), async (req, res, next) => {
  try {
    const { dayOfWeek, startTime, endTime, room, teacherId } = req.body;
    const slot = await updateSlot({ instituteId: req.user.instituteId, id: req.params.id, dayOfWeek, startTime, endTime, room, teacherId });
    return success(res, slot, 'Timetable slot updated');
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('MANAGE_TIMETABLE'), async (req, res, next) => {
  try {
    await removeSlot({ instituteId: req.user.instituteId, id: req.params.id });
    return success(res, null, 'Timetable slot removed');
  } catch (err) { next(err); }
});

export default router;
