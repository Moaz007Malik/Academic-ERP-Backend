import { env } from '../config/env.js';
import { isRedisReady } from '../config/redis.js';

let bullQueue = null;

/**
 * Background job queue — BullMQ when QUEUE_ENABLED=true and Redis available.
 * Falls back to setImmediate for dev/single-node deployments.
 */
export async function initJobQueue() {
  if (!env.queueEnabled || !isRedisReady()) {
    console.log('Job queue: in-process fallback (set QUEUE_ENABLED=true + Redis for BullMQ)');
    return;
  }
  try {
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: env.redisUrl };
    bullQueue = new Queue('erp-jobs', { connection });

    new Worker('erp-jobs', async (job) => {
      const { processJob } = await import('./processors.js');
      await processJob(job.name, job.data);
    }, { connection });

    console.log('BullMQ job queue initialized');
  } catch (err) {
    console.warn('BullMQ unavailable:', err.message);
    bullQueue = null;
  }
}

export async function enqueueJob(name, data, opts = {}) {
  if (bullQueue) {
    return bullQueue.add(name, data, {
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      ...opts,
    });
  }
  setImmediate(async () => {
    try {
      const { processJob } = await import('./processors.js');
      await processJob(name, data);
    } catch (err) {
      console.error(`In-process job failed [${name}]:`, err.message);
    }
  });
  return { id: 'inline', name, data };
}
