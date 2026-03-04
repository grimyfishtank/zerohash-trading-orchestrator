import { describe, it, expect, vi, afterEach } from "vitest";
import { retry } from "../utils/retry";
import { ZeroHashError } from "../errors/ZeroHashError";
import { ErrorCode } from "../errors/ErrorCodes";

function makeZeroHashError(code: ErrorCode, message = "test error"): ZeroHashError {
  return new ZeroHashError(code, message);
}

describe("retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on first attempt with no retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retry(fn, { retries: 3 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable errors and eventually succeeds", async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeZeroHashError(ErrorCode.JWT_FETCH_FAILED))
      .mockRejectedValueOnce(makeZeroHashError(ErrorCode.JWT_FETCH_FAILED))
      .mockResolvedValue("recovered");

    const promise = retry(fn, { retries: 3, baseDelayMs: 100 });

    // Advance enough to cover delays with jitter (+/- 20%)
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(makeZeroHashError(ErrorCode.SLIPPAGE_EXCEEDED));

    await expect(
      retry(fn, { retries: 3 }),
    ).rejects.toThrow(ZeroHashError);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries and throws the last error", async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValue(makeZeroHashError(ErrorCode.NETWORK_ERROR, "network down"));

    const promise = retry(fn, { retries: 2, baseDelayMs: 100 });
    // Attach catch handler immediately to prevent unhandled rejection
    const resultPromise = promise.catch((e: unknown) => e);

    // Advance enough to cover all retry delays with jitter
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(500);

    const error = await resultPromise;
    expect(error).toBeInstanceOf(ZeroHashError);
    expect((error as ZeroHashError).message).toBe("network down");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("calls onRetry hook with attempt number and error", async () => {
    vi.useFakeTimers();

    const onRetry = vi.fn();
    const error = makeZeroHashError(ErrorCode.JWT_FETCH_FAILED);

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const promise = retry(fn, { retries: 3, baseDelayMs: 100, onRetry });

    await vi.advanceTimersByTimeAsync(200);

    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(ZeroHashError));
  });
});
