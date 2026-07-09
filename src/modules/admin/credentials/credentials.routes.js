import { Router } from 'express';
import { prisma } from '../../../config/database.js';
import { success } from '../../../utils/response.js';
import { AppError } from '../../../utils/AppError.js';
import { hashPassword } from '../../auth/auth.service.js';
import { revokeAllUserTokens } from '../../../services/token.service.js';
import { generateTempPassword } from '../../../utils/portalUser.js';
import { savePasswordHistory } from '../../../security/securityPolicies.js';

const router = Router();

const PORTAL_ROLES = ['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'HR', 'LIBRARIAN', 'RECEPTIONIST', 'STAFF'];

/** List all institute portal logins with admin-visible passwords */
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        instituteId: req.user.instituteId,
        role: { in: PORTAL_ROLES },
        isActive: true,
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        portalPassword: true,
        mustChangePass: true,
        lastLoginAt: true,
        student: { select: { id: true, rollNumber: true } },
        teacher: { select: { id: true, employeeCode: true } },
      },
    });
    return success(res, users);
  } catch (err) { next(err); }
});

router.post('/:userId/reset-password', async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        instituteId: req.user.instituteId,
        role: { in: PORTAL_ROLES },
      },
    });
    if (!user) throw new AppError('User not found', 404);

    const newPassword = req.body.password?.trim() || generateTempPassword();
    const passwordHash = await hashPassword(newPassword);

    await savePasswordHistory(user.id, user.passwordHash);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        portalPassword: newPassword,
        mustChangePass: true,
      },
    });
    await revokeAllUserTokens(user.id);

    return success(res, {
      email: user.email,
      password: newPassword,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      role: user.role,
    }, 'Password reset');
  } catch (err) { next(err); }
});

router.put('/:userId/password', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password?.trim()) throw new AppError('Password is required', 400);

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.userId,
        instituteId: req.user.instituteId,
        role: { in: PORTAL_ROLES },
      },
    });
    if (!user) throw new AppError('User not found', 404);

    const passwordHash = await hashPassword(password.trim());
    await savePasswordHistory(user.id, user.passwordHash);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        portalPassword: password.trim(),
        mustChangePass: false,
      },
    });
    await revokeAllUserTokens(user.id);

    return success(res, { email: user.email, password: password.trim() }, 'Password updated');
  } catch (err) { next(err); }
});

export default router;
