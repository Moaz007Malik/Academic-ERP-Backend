import { prisma } from '../config/database.js';
import { computeAnalyticsSnapshot } from '../analytics/analyticsEngine.js';

export async function processJob(name, data) {
  switch (name) {
    case 'analytics.compute':
      await computeAnalyticsSnapshot(data);
      break;
    case 'email.send':
      await sendEmailJob(data);
      break;
    case 'sms.send':
      await sendSmsJob(data);
      break;
    case 'backup.verify':
      await verifyBackupJob(data);
      break;
    case 'events.replay':
      {
        const { replayPendingEvents } = await import('../events/eventDispatcher.js');
        await replayPendingEvents(data?.limit ?? 50);
      }
      break;
    default:
      console.warn(`Unknown job: ${name}`);
  }
}

async function sendEmailJob({ instituteId, toEmail, subject, template, body }) {
  // Integrate SendGrid/SES — log for now
  await prisma.emailLog.create({
    data: {
      instituteId,
      toEmail,
      subject,
      template,
      status: 'SENT',
      providerRef: `dev-${Date.now()}`,
    },
  });
}

async function sendSmsJob({ instituteId, toPhone, message }) {
  await prisma.smsLog.create({
    data: {
      instituteId,
      toPhone,
      message,
      status: 'SENT',
      providerRef: `dev-${Date.now()}`,
    },
  });
}

async function verifyBackupJob({ backupId }) {
  const backup = await prisma.backupRecord.findUnique({ where: { id: backupId } });
  if (!backup) return;
  await prisma.backupRecord.update({
    where: { id: backupId },
    data: { status: 'VERIFIED', verifiedAt: new Date() },
  });
}
