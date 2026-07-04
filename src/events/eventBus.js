import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database.js';
import { DOMAIN_EVENTS } from './domainEventTypes.js';
import { dispatchDomainEvent } from './eventDispatcher.js';

/**
 * Publish a domain event — transactional outbox pattern.
 * 1. Persist to domain_events table (PENDING)
 * 2. Dispatch to in-process handlers immediately
 * 3. Failed handlers increment attempts; BullMQ retries when queue enabled
 */
export async function publishEvent({
  eventType,
  aggregateType,
  aggregateId = null,
  instituteId = null,
  payload = {},
  correlationId = null,
  causationId = null,
  tx = null,
}) {
  const client = tx || prisma;
  const correlation = correlationId || uuidv4();

  const event = await client.domainEvent.create({
    data: {
      eventType,
      aggregateType,
      aggregateId,
      instituteId,
      payload,
      correlationId: correlation,
      causationId,
      status: 'PENDING',
    },
  });

  // Async dispatch — don't block HTTP response on handler failures
  setImmediate(() => {
    dispatchDomainEvent(event).catch((err) => {
      console.error(`Domain event dispatch failed [${event.id}]:`, err.message);
    });
  });

  return event;
}

/** Convenience publishers */
export const events = {
  studentCreated: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.STUDENT_CREATED, aggregateType: 'Student', ...data, ...opts }),
  feeCollected: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.FEE_COLLECTED, aggregateType: 'Fee', ...data, ...opts }),
  resultPublished: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.RESULT_PUBLISHED, aggregateType: 'Result', ...data, ...opts }),
  attendanceMarked: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.ATTENDANCE_MARKED, aggregateType: 'Attendance', ...data, ...opts }),
  ticketCreated: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.TICKET_CREATED, aggregateType: 'SupportTicket', ...data, ...opts }),
  subscriptionRenewed: (data, opts) =>
    publishEvent({ eventType: DOMAIN_EVENTS.SUBSCRIPTION_RENEWED, aggregateType: 'Institute', ...data, ...opts }),
};

export { DOMAIN_EVENTS };
