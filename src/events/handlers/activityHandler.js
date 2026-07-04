import { prisma } from '../../config/database.js';

export async function recordActivity(event) {
  if (!event.instituteId) return;
  const [verb] = event.eventType.split('.');
  await prisma.activityStream.create({
    data: {
      instituteId: event.instituteId,
      actorId: event.payload?.actorId || null,
      verb: verb || 'updated',
      objectType: event.aggregateType,
      objectId: event.aggregateId,
      summary: event.eventType,
      metadata: event.payload,
    },
  });
}
