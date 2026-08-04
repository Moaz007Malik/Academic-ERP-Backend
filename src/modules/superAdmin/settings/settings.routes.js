import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { env } from '../../../config/env.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [totalInstitutes, totalUsers, totalStudents, totalTeachers] = await Promise.all([
      prisma.institute.count({ where: { deletedAt: null } }),
      prisma.user.count(),
      prisma.student.count(),
      prisma.teacher.count(),
    ]);

    return success(res, {
      environment: env.nodeEnv,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      dbConnected: true,
      totals: { totalInstitutes, totalUsers, totalStudents, totalTeachers },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
