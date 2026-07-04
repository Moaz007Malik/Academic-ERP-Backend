import { prisma } from '../../config/database.js';

/**
 * Trigger in-app notifications + queue email/SMS via background jobs.
 */
export async function triggerNotifications(event) {
  const { instituteId, eventType, payload } = event;
  if (!instituteId) return;

  const titleMap = {
    'fee.collected': 'Fee Payment Received',
    'result.published': 'Results Published',
    'ticket.created': 'New Support Ticket',
  };
  const title = titleMap[eventType] || 'System Notification';

  await prisma.notification.create({
    data: {
      instituteId,
      title,
      message: JSON.stringify(payload).slice(0, 2000),
      channel: 'IN_APP',
      status: 'SENT',
    },
  });

  // Email/SMS logs created by job workers when QUEUE_ENABLED=true
}
