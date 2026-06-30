import { prisma } from '../config/database.js';

export async function writeAuditLog({
  instituteId,
  userId,
  action,
  entity,
  entityId,
  oldValue = null,
  newValue = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        instituteId,
        userId,
        action,
        entity,
        entityId,
        oldValue,
        newValue,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}
