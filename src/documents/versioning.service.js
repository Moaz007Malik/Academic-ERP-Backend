import { prisma } from '../config/database.js';
import { publishEvent } from '../events/eventBus.js';
import { DOMAIN_EVENTS } from '../events/domainEventTypes.js';

/**
 * Create a new document version — previous versions marked isCurrent=false.
 */
export async function createDocumentVersion({
  instituteId,
  entityType,
  entityId,
  fileUrl,
  storageRecordId = null,
  checksum = null,
  changeNotes = null,
  createdById = null,
}) {
  const latest = await prisma.documentVersion.findFirst({
    where: { instituteId, entityType, entityId, isCurrent: true },
    orderBy: { versionNumber: 'desc' },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    if (latest) {
      await tx.documentVersion.update({
        where: { id: latest.id },
        data: { isCurrent: false },
      });
    }
    return tx.documentVersion.create({
      data: {
        instituteId,
        entityType,
        entityId,
        versionNumber,
        fileUrl,
        storageRecordId,
        checksum,
        changeNotes,
        createdById,
        isCurrent: true,
      },
    });
  });

  await publishEvent({
    eventType: DOMAIN_EVENTS.DOCUMENT_VERSIONED,
    aggregateType: 'DocumentVersion',
    aggregateId: version.id,
    instituteId,
    payload: { entityType, entityId, versionNumber },
  });

  return version;
}

export async function getVersionHistory(instituteId, entityType, entityId) {
  return prisma.documentVersion.findMany({
    where: { instituteId, entityType, entityId },
    orderBy: { versionNumber: 'desc' },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function restoreVersion(versionId, userId) {
  const version = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error('Version not found');

  return createDocumentVersion({
    instituteId: version.instituteId,
    entityType: version.entityType,
    entityId: version.entityId,
    fileUrl: version.fileUrl,
    storageRecordId: version.storageRecordId,
    checksum: version.checksum,
    changeNotes: `Restored from v${version.versionNumber}`,
    createdById: userId,
  });
}
