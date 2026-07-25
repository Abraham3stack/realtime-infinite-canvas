const RETRY_WINDOW_MS = 30_000;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 3_000;

const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server timeout
  'P1017', // Server closed the connection
  'P2024', // Timed out fetching a new connection from the pool
  'P2028', // Transaction API timeout (common on cold starts)
]);

const TRANSIENT_MESSAGE_SNIPPETS = [
  'unable to start a transaction in the given time',
  'error in postgresql connection',
  'connection closed',
  "can't reach database server",
  'the database server closed the connection',
  'timed out',
];

type RetryableErrorShape = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  meta?: {
    error?: unknown;
  };
};

function getErrorMessage(error: RetryableErrorShape): string {
  const parts = [error.message, error.meta?.error]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());

  return parts.join(' | ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isNeonColdStartTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const retryable = error as RetryableErrorShape;
  const code = typeof retryable.code === 'string' ? retryable.code : '';
  const name = typeof retryable.name === 'string' ? retryable.name : '';
  const message = getErrorMessage(retryable);

  const looksLikePrismaError = name.startsWith('Prisma') || code.startsWith('P');
  if (!looksLikePrismaError) {
    return false;
  }

  if (TRANSIENT_PRISMA_CODES.has(code)) {
    return true;
  }

  return TRANSIENT_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet));
}

// Retries only transient Neon/Prisma startup failures with exponential backoff.
// All other errors (validation, domain, coding errors) are re-thrown immediately.
export async function withNeonColdStartRetry<T>(operation: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;
  let completed = false;
  let result: T | undefined;

  while (!completed) {
    try {
      result = await operation();
      completed = true;
    } catch (error) {
      if (!isNeonColdStartTransientError(error)) {
        throw error;
      }

      const elapsedMs = Date.now() - start;
      const waitMs = Math.min(delayMs, MAX_DELAY_MS);

      if (elapsedMs + waitMs > RETRY_WINDOW_MS) {
        throw error;
      }

      attempt += 1;
      console.warn(
        `[db] transient connection/startup issue detected; retry=${attempt} elapsed=${elapsedMs}ms nextDelay=${waitMs}ms`
      );

      await sleep(waitMs);
      delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    }
  }

  return result as T;
}
