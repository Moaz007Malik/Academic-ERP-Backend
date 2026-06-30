import { hashPassword } from '../modules/auth/auth.service.js';

export async function createPortalUser(tx, {
  email, password, role, instituteId, firstName, lastName,
}) {
  const passwordHash = await hashPassword(password || 'Student@123');
  return tx.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      role,
      instituteId,
      firstName,
      lastName,
      mustChangePass: true,
    },
  });
}

export function generateRollNumber(prefix, num) {
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

export function generateEmployeeCode(prefix, num) {
  return `${prefix}-${String(num).padStart(3, '0')}`;
}
