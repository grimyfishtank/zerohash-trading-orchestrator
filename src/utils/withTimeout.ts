import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    return result;
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new ZeroHashError(
        ErrorCode.OPERATION_TIMEOUT,
        `Operation timed out after ${timeoutMs}ms`,
        { timeoutMs }
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
