import { prisma } from '../../config/database.js';

const NOTIFICATION_BUILDERS = {
  'fee.collected': (p) => ({
    title: 'Fee Payment Received',
    message: `${p.studentName || 'A student'} paid ${Number(p.amount || 0).toLocaleString()} PKR${p.feeName ? ` (${p.feeName})` : ''}.`,
  }),
  'result.published': (p) => ({
    title: 'Results Published',
    message: `Results published for ${p.scopeLabel || 'an exam'}${p.track ? ` (${p.track})` : ''}.`,
  }),
  'attendance.marked': (p) => ({
    title: 'Attendance Submitted',
    message: `${p.markedCount ?? 'Some'} attendance record(s) marked for ${p.scopeLabel || 'a class'} on ${p.date || 'today'}.`,
  }),
  'ticket.created': (p) => ({
    title: 'New Support Ticket',
    message: `${p.createdByName || 'Someone'} raised a ${(p.priority || 'MEDIUM').toLowerCase()}-priority ticket: "${p.subject || ''}".`,
  }),
  'student.created': (p) => ({
    title: 'Student Added',
    message: `New student ${p.studentName || ''}${p.rollNumber ? ` (${p.rollNumber})` : ''} was added.`,
  }),
};

/** Trigger in-app notifications + queue email/SMS via background jobs. */
export async function triggerNotifications(event) {
  const { instituteId, eventType, payload } = event;
  if (!instituteId) return;

  const build = NOTIFICATION_BUILDERS[eventType];
  const { title, message } = build
    ? build(payload || {})
    : { title: 'System Notification', message: JSON.stringify(payload).slice(0, 2000) };

  await prisma.notification.create({
    data: { instituteId, title, message, channel: 'IN_APP', status: 'SENT' },
  });

  // Email/SMS logs created by job workers when QUEUE_ENABLED=true
}
