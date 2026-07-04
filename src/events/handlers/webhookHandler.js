import { prisma } from '../../config/database.js';
import crypto from 'crypto';

export async function deliverWebhooks(event) {
  if (!event.instituteId) return;

  const webhooks = await prisma.webhook.findMany({
    where: {
      instituteId: event.instituteId,
      status: 'ACTIVE',
      events: { has: event.eventType },
    },
  });

  for (const hook of webhooks) {
    const body = JSON.stringify({
      id: event.id,
      type: event.eventType,
      occurredAt: event.occurredAt,
      data: event.payload,
    });
    const signature = crypto
      .createHmac('sha256', hook.secretHash)
      .update(body)
      .digest('hex');

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ERP-Event': event.eventType,
          'X-ERP-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          eventType: event.eventType,
          payload: event.payload,
          responseCode: res.status,
          responseBody: (await res.text()).slice(0, 1000),
        },
      });
    } catch (err) {
      await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          eventType: event.eventType,
          payload: event.payload,
          responseCode: 0,
          responseBody: err.message?.slice(0, 500),
          attempt: 1,
        },
      });
    }
  }
}
