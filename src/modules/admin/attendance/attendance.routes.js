import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { requireModule } from '../../../middleware/moduleGuard.js';
import { MODULE_KEYS } from '../../../utils/constants.js';
import { blockExpiredModuleAccess } from '../../../middleware/subscriptionGuard.js';
import { AppError } from '../../../utils/AppError.js';
import { markAttendance, getAttendanceRecords, getAttendanceSummary } from '../../../services/attendance.service.js';

const router = Router();
router.use(requireModule(MODULE_KEYS.ATTENDANCE));
router.use(blockExpiredModuleAccess);

router.get('/', async (req, res, next) => {
  try {
    const { date, sectionId, subjectId, studentId } = req.query;
    const records = await getAttendanceRecords({
      instituteId: req.user.instituteId, track: 'ACADEMIC', subjectId, studentId, date,
    });

    let filtered = records;
    if (sectionId) {
      filtered = records.filter((r) => r.student.currentSectionId === sectionId);
    }
    return success(res, filtered);
  } catch (err) { next(err); }
});

router.get('/summary/:studentId', async (req, res, next) => {
  try {
    const summary = await getAttendanceSummary({
      instituteId: req.user.instituteId, studentId: req.params.studentId, track: 'ACADEMIC',
    });
    const { leave, ...legacyShape } = summary;
    return success(res, legacyShape);
  } catch (err) { next(err); }
});

router.post('/mark', async (req, res, next) => {
  try {
    const { date, subjectId, sectionId, records } = req.body;
    if (!date || !subjectId || !Array.isArray(records)) {
      throw new AppError('date, subjectId and records required', 400);
    }
    const saved = await markAttendance({
      instituteId: req.user.instituteId, track: 'ACADEMIC',
      date, subjectId, sectionId, records, markedById: req.user.id,
    });
    return success(res, saved, `Attendance marked for ${saved.length} students`);
  } catch (err) { next(err); }
});

export default router;
