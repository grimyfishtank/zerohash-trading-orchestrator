import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../client/RateLimiter";
import { createMockTelemetry, createMockLogger } from "./helpers";
import { ZeroHashError } from "../errors/ZeroHashError";

describe("RateLimiter", () => {
  const logger = createMockLogger();
  let telemetry: ReturnType<typeof createMockTelemetry>;

  beforeEach(() => {
    vi.useFakeTimers();
    telemetry = createMockTelemetry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createLimiter(config?: Partial<{ maxOperations: number; windowMs: number; strategy: "reject" | "queue"; maxQueueSize: number; queueTimeoutMs: number }>) {
    return new RateLimiter(config, telemetry, logger);
  }

  it("allows operations within limit", async () => {
    const limiter = createLimiter({ maxOperations: 2 });
    await expect(limiter.acquire("key", () => Promise.resolve("op1"))).resolves.not.toThrow();
    await expect(limiter.acquire("key", () => Promise.resolve("op2"))).resolves.not.toThrow();
  });

  it("rejects when limit exceeded with reject strategy", async () => {
    const limiter = createLimiter({ maxOperations: 2, strategy: "reject" });
    await limiter.acquire("key", () => Promise.resolve("op1"));
    await limiter.acquire("key", () => Promise.resolve("op2"));
    try {
      await limiter.acquire("key", () => Promise.resolve("op3"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ZeroHashError);
      expect((e as ZeroHashError).code).toBe("RATE_LIMITED");
    }
  });

  it("emits RATE_LIMITED telemetry when exceeded", async () => {
    const limiter = createLimiter({ maxOperations: 1, strategy: "reject" });
    await limiter.acquire("key", () => Promise.resolve("op1"));
    try {
      await limiter.acquire("key", () => Promise.resolve("op2"));
    } catch {
      // expected
    }
    expect(telemetry.track).toHaveBeenCalledWith(
      "RATE_LIMITED",
      undefined,
      expect.anything()
    );
  });

  it("remaining() returns correct count", async () => {
    const limiter = createLimiter({ maxOperations: 5 });
    expect(limiter.remaining("key")).toBe(5);
    await limiter.acquire("key", () => Promise.resolve("op1"));
    expect(limiter.remaining("key")).toBe(4);
    await limiter.acquire("key", () => Promise.resolve("op2"));
    expect(limiter.remaining("key")).toBe(3);
  });

  it("getStatus() returns remaining, queueDepth, retryAfterMs", async () => {
    const limiter = createLimiter({ maxOperations: 3 });
    await limiter.acquire("key", () => Promise.resolve("op1"));
    const status = limiter.getStatus("key");
    expect(status).toEqual(
      expect.objectContaining({
        remaining: 2,
        queueDepth: 0,
        retryAfterMs: expect.any(Number),
      })
    );
  });

  it("getKeys() returns active bucket keys", async () => {
    const limiter = createLimiter();
    await limiter.acquire("alpha", () => Promise.resolve("op1"));
    await limiter.acquire("beta", () => Promise.resolve("op2"));
    const keys = limiter.getKeys();
    expect(keys).toContain("alpha");
    expect(keys).toContain("beta");
  });

  it("reset() clears all state", async () => {
    const limiter = createLimiter({ maxOperations: 5 });
    await limiter.acquire("a", () => Promise.resolve("op1"));
    await limiter.acquire("b", () => Promise.resolve("op2"));
    limiter.reset();
    expect(limiter.remaining("a")).toBe(5);
    expect(limiter.remaining("b")).toBe(5);
    expect(limiter.getKeys()).toHaveLength(0);
  });

  it("reset(key) clears specific key only", async () => {
    const limiter = createLimiter({ maxOperations: 5 });
    await limiter.acquire("a", () => Promise.resolve("op1"));
    await limiter.acquire("b", () => Promise.resolve("op2"));
    limiter.reset("a");
    expect(limiter.remaining("a")).toBe(5);
    expect(limiter.remaining("b")).toBe(4);
  });

  it("queue strategy rejects when queue is full", async () => {
    const limiter = createLimiter({
      maxOperations: 1,
      strategy: "queue",
      maxQueueSize: 1,
    });
    await limiter.acquire("key", () => Promise.resolve("op1"));
    // This should be queued (queue size = 1)
    const queued = limiter.acquire("key", () => Promise.resolve("op2"));
    // This should be rejected — queue is full
    try {
      await limiter.acquire("key", () => Promise.resolve("op3"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ZeroHashError);
      expect((e as ZeroHashError).code).toBe("RATE_LIMITED");
    }
    // Clean up: advance time so queued op resolves
    vi.advanceTimersByTime(60_000);
    await queued.catch(() => {});
  });

  it("queue strategy emits RATE_LIMIT_QUEUED when operation queued", async () => {
    const limiter = createLimiter({
      maxOperations: 1,
      strategy: "queue",
      maxQueueSize: 10,
    });
    await limiter.acquire("key", () => Promise.resolve("op1"));
    // This will be queued
    const queued = limiter.acquire("key", () => Promise.resolve("op2"));
    expect(telemetry.track).toHaveBeenCalledWith(
      "RATE_LIMIT_QUEUED",
      undefined,
      expect.anything()
    );
    // Clean up
    vi.advanceTimersByTime(60_000);
    await queued.catch(() => {});
  });
});
