import { Router } from 'express';
import { success } from '../../../utils/response.js';
import { PERMISSIONS } from '../../../utils/permissions.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    return success(res, PERMISSIONS);
  } catch (err) {
    next(err);
  }
});

export default router;
