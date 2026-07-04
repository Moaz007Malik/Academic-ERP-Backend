import cron from 'node-cron';
import { runSubscriptionBillingCycle } from '../services/subscription.service.js';

/** Daily at 02:00 UTC — monthly invoices + overdue blocking */
export function initSubscriptionCron() {
  cron.schedule('0 2 * * *', async () => {
    try {
      const result = await runSubscriptionBillingCycle();
      console.log('[subscription-cron]', result);
    } catch (err) {
      console.error('[subscription-cron] failed:', err.message);
    }
  });
  console.log('Subscription cron scheduled (daily 02:00 UTC)');
}
