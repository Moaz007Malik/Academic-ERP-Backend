import { hashPassword } from '../modules/auth/auth.service.js';

export async function createPortalUser(tx, {
  email, password, role, instituteId, firstName, lastName,
}) {
  const plainPassword = password || (role === 'TEACHER' ? 'Teacher@123' : 'Student@123');
  const passwordHash = await hashPassword(plainPassword);
  return tx.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      portalPassword: plainPassword,
      role,
      instituteId,
      firstName,
      lastName,
      mustChangePass: true,
    },
  });
}

export function generateTempPassword() {
  return `Temp@${Math.random().toString(36).slice(2, 10)}`;
}

export function generateRollNumber(prefix, num) {
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

export function generateEmployeeCode(prefix, num) {
  return `${prefix}-${String(num).padStart(3, '0')}`;
}
