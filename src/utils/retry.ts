import { ErrorCode, RETRYABLE_ERRORS } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";

export type BackoffStrategy = "exponential" | "linear";

export interface RetryOptions {
  retries: number;
  backoffStrategy: BackoffStrategy;
  retryOn?: ReadonlySet<ErrorCode>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: ZeroHashError) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> & {
  onRetry: undefined;
} = {
  retries: 3,
  backoffStrategy: "exponential",
  retryOn: RETRYABLE_ERRORS,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  onRetry: undefined,
};

function computeDelay(
  attempt: number,
  strategy: BackoffStrategy,
  baseMs: number,
  maxMs: number
): number {
  const raw =
    strategy === "exponential"
      ? baseMs * Math.pow(2, attempt)
      : baseMs * (attempt + 1);

  // Add jitter: +/- 20%
  const jitter = raw * 0.2 * (Math.random() * 2 - 1);
  return Math.min(raw + jitter, maxMs);
}

function isRetryable(
  error: unknown,
  retryOn: ReadonlySet<ErrorCode>
): boolean {
  if (error instanceof ZeroHashError) {
    return retryOn.has(error.code);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: ZeroHashError | undefined;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = ZeroHashError.fromUnknown(
        error,
        ErrorCode.NETWORK_ERROR
      );

      const isLast = attempt === opts.retries;
      if (isLast || !isRetryable(lastError, opts.retryOn)) {
        throw lastError;
      }

      opts.onRetry?.(attempt + 1, lastError);

      const delay = computeDelay(
        attempt,
        opts.backoffStrategy,
        opts.baseDelayMs,
        opts.maxDelayMs
      );
      await sleep(delay);
    }
  }

  // Unreachable in practice, but satisfies the type checker
  throw lastError ?? new ZeroHashError(
    ErrorCode.RETRY_EXHAUSTED,
    "Retry attempts exhausted"
  );
}
