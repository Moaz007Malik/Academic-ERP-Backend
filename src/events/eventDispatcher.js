import { prisma } from '../config/database.js';
import { writeAuditLog } from '../services/audit.service.js';
import { enqueueJob } from '../jobs/jobQueue.js';
import { deliverWebhooks } from './handlers/webhookHandler.js';
import { recordActivity } from './handlers/activityHandler.js';
import { triggerNotifications } from './handlers/notificationHandler.js';

const HANDLERS = {
  '*': [recordActivity, writeAuditFromEvent],
};

/** Event-type specific handlers */
const TYPED_HANDLERS = {
  'fee.collected': [triggerNotifications, deliverWebhooks, enqueueAnalyticsJob],
  'result.published': [triggerNotifications, deliverWebhooks, enqueueAnalyticsJob],
  'attendance.marked': [enqueueAnalyticsJob],
  'ticket.created': [triggerNotifications, deliverWebhooks],
  'subscription.renewed': [deliverWebhooks, enqueueAnalyticsJob],
  'student.created': [deliverWebhooks, enqueueAnalyticsJob],
};

export async function dispatchDomainEvent(event) {
  const handlers = [
    ...(HANDLERS['*'] || []),
    ...(TYPED_HANDLERS[event.eventType] || []),
  ];

  try {
    for (const handler of handlers) {
      await handler(event);
    }
    await prisma.domainEvent.update({
      where: { id: event.id },
      data: { status: 'COMPLETED', processedAt: new Date() },
    });
  } catch (err) {
    await prisma.domainEvent.update({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: err.message?.slice(0, 500),
      },
    });
    throw err;
  }
}

async function writeAuditFromEvent(event) {
  await writeAuditLog({
    instituteId: event.instituteId,
    userId: event.payload?.actorId || null,
    action: event.eventType,
    entity: event.aggregateType,
    entityId: event.aggregateId,
    newValue: event.payload,
  });
}

async function enqueueAnalyticsJob(event) {
  await enqueueJob('analytics.compute', {
    eventId: event.id,
    eventType: event.eventType,
    instituteId: event.instituteId,
  });
}

/** Reprocess pending/failed events (cron or admin trigger) */
export async function replayPendingEvents(limit = 50) {
  const pending = await prisma.domainEvent.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });
  for (const event of pending) {
    await dispatchDomainEvent(event);
  }
  return pending.length;
}
