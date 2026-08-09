const TRANSIENT_CODES = new Set(['P1017', 'P2028']);
const TRANSIENT_MESSAGE_PATTERNS = [
  "can't reach database server",
  'transaction not found',
  'connection was closed',
];

function isTransientError(err) {
  if (err?.code && TRANSIENT_CODES.has(err.code)) return true;
  const message = String(err?.message || '').toLowerCase();
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps prisma.$transaction(fn) with a short retry on transient connection drops
 * (observed against the hosted dev Postgres: P1017/P2028, "Can't reach database server",
 * "Transaction not found" mid-transaction). Does not retry business-logic errors (AppError etc.)
 * — only the specific transient connectivity classes above. Also raises Prisma's default 5s
 * interactive-transaction timeout to 15s: too tight for a remote DB under real latency, where a
 * transaction can otherwise expire mid-flight on legitimately successful (just slow) work.
 */
export async function withTransactionRetry(prisma, fn, { retries = 2, baseDelayMs = 150, timeout = 15000, maxWait = 15000 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(fn, { timeout, maxWait });
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) throw err;
      attempt += 1;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
