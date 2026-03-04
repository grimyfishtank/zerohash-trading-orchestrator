import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "../utils/withTimeout";
import { ErrorCode } from "../errors/ErrorCodes";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when operation completes within deadline", async () => {
    const result = await withTimeout(
      async (_signal) => "done",
      5000,
    );
    expect(result).toBe("done");
  });

  it("rejects with OPERATION_TIMEOUT when deadline exceeded", async () => {
    vi.useFakeTimers();

    const promise = withTimeout(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      1000,
    );

    // Attach a catch handler early to prevent unhandled rejection warnings
    const result = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1001);

    const error = await result;
    expect(error).toMatchObject({
      code: ErrorCode.OPERATION_TIMEOUT,
    });
  });

  it("passes AbortSignal to the function", async () => {
    let receivedSignal: AbortSignal | undefined;

    await withTimeout(async (signal) => {
      receivedSignal = signal;
      return "ok";
    }, 5000);

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("cleans up timer on success", async () => {
    vi.useFakeTimers();

    const result = await withTimeout(
      async (_signal) => "fast",
      5000,
    );

    expect(result).toBe("fast");
    expect(vi.getTimerCount()).toBe(0);
  });
});
