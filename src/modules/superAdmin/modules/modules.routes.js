import { Router } from 'express';
import { MODULE_CATALOG, summarizeModules } from '../../../utils/moduleCatalog.js';
import { success } from '../../../utils/response.js';

const router = Router();

router.get('/', (_req, res) => {
  return success(res, { catalog: MODULE_CATALOG, summary: summarizeModules([]) });
});

export default router;
