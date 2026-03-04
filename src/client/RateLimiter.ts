import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "../utils/logger";
import type { TradingFlowType } from "./types";

// ── Configuration ───────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Maximum number of operations allowed within the window */
  maxOperations: number;

  /** Time window in milliseconds */
  windowMs: number;

  /** Strategy when limit is hit */
  strategy: "reject" | "queue";

  /** Maximum queue depth before rejecting (queue strategy only) */
  maxQueueSize: number;

  /** Per-operation timeout when queued (ms) — rejects if not drained in time */
  queueTimeoutMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxOperations: 5,
  windowMs: 60_000, // 1 minute
  strategy: "reject",
  maxQueueSize: 10,
  queueTimeoutMs: 30_000,
};

// ── Sliding Window Bucket ───────────────────────────────────────────────────

interface Bucket {
  timestamps: number[];
}

// ── Queued Operation ────────────────────────────────────────────────────────

interface QueuedOperation<T> {
  key: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, Bucket>();
  private readonly queue: QueuedOperation<unknown>[] = [];
  private readonly drainTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    config: Partial<RateLimitConfig> | undefined,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger
  ) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
  }

  /**
   * Wrap an async operation with rate limiting.
   * The `key` is used to scope limits (e.g. per-flow or global).
   */
  async acquire<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    this.pruneExpired(key);

    const bucket = this.getOrCreateBucket(key);

    if (bucket.timestamps.length < this.config.maxOperations) {
      bucket.timestamps.push(Date.now());
      return operation();
    }

    // Rate limit exceeded
    this.telemetry.track("RATE_LIMITED", undefined, {
      key,
      maxOperations: this.config.maxOperations,
      windowMs: this.config.windowMs,
      strategy: this.config.strategy,
    });

    if (this.config.strategy === "reject") {
      this.logger.warn("Rate limit exceeded", {
        key,
        count: bucket.timestamps.length,
        maxOperations: this.config.maxOperations,
      });

      throw new ZeroHashError(
        ErrorCode.RATE_LIMITED,
        `Rate limit exceeded for "${key}": ${this.config.maxOperations} operations per ${this.config.windowMs}ms`,
        {
          key,
          maxOperations: this.config.maxOperations,
          windowMs: this.config.windowMs,
        }
      );
    }

    // Queue strategy — check backpressure
    if (this.queue.length >= this.config.maxQueueSize) {
      this.logger.warn("Rate limit queue is full", {
        key,
        queueSize: this.queue.length,
        maxQueueSize: this.config.maxQueueSize,
      });

      throw new ZeroHashError(
        ErrorCode.RATE_LIMITED,
        `Rate limit queue is full for "${key}": ${this.config.maxQueueSize} operations queued`,
        { key, queueSize: this.queue.length, maxQueueSize: this.config.maxQueueSize }
      );
    }

    this.logger.debug("Operation queued due to rate limit", { key });

    return new Promise<T>((resolve, reject) => {
      const item: QueuedOperation<T> = {
        key,
        settled: false,
        execute: null as unknown as () => Promise<T>,
        resolve: null as unknown as (value: T) => void,
        reject: null as unknown as (error: Error) => void,
        timeoutHandle: null as unknown as ReturnType<typeof setTimeout>,
      };

      item.timeoutHandle = setTimeout(() => {
        if (item.settled) return;
        item.settled = true;
        const idx = this.queue.indexOf(item as QueuedOperation<unknown>);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new ZeroHashError(
          ErrorCode.RATE_LIMITED,
          `Rate limit queue timeout after ${this.config.queueTimeoutMs}ms for "${key}"`,
          { key, queueTimeoutMs: this.config.queueTimeoutMs }
        ));
      }, this.config.queueTimeoutMs);

      item.execute = async () => {
        clearTimeout(item.timeoutHandle);
        if (item.settled) throw new Error("Operation already settled");
        this.getOrCreateBucket(key).timestamps.push(Date.now());
        return operation();
      };
      item.resolve = (value: T) => {
        if (item.settled) return;
        item.settled = true;
        resolve(value);
      };
      item.reject = (error: Error) => {
        if (item.settled) return;
        item.settled = true;
        reject(error);
      };

      this.queue.push(item as QueuedOperation<unknown>);

      this.telemetry.track("RATE_LIMIT_QUEUED", undefined, {
        key,
        queueDepth: this.queue.length,
      });

      this.scheduleDrain(key);
    });
  }

  /** Convenience method for flow-scoped rate limiting */
  async acquireForFlow<T>(
    flow: TradingFlowType,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.acquire(`flow:${flow}`, operation);
  }

  /** Returns remaining operations allowed in the current window */
  remaining(key: string): number {
    this.pruneExpired(key);
    const bucket = this.buckets.get(key);
    if (!bucket) return this.config.maxOperations;
    return Math.max(0, this.config.maxOperations - bucket.timestamps.length);
  }

  /** Returns ms until the next slot opens up, or 0 if available now */
  retryAfterMs(key: string): number {
    this.pruneExpired(key);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.timestamps.length < this.config.maxOperations) {
      return 0;
    }

    const oldest = bucket.timestamps[0];
    return Math.max(0, oldest + this.config.windowMs - Date.now());
  }

  /** Returns status for a given key */
  getStatus(key: string): { remaining: number; queueDepth: number; retryAfterMs: number } {
    return {
      remaining: this.remaining(key),
      queueDepth: this.queue.filter((q) => q.key === key).length,
      retryAfterMs: this.retryAfterMs(key),
    };
  }

  /** Returns all active bucket keys */
  getKeys(): string[] {
    return Array.from(this.buckets.keys());
  }

  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
      // Remove queued items for this key
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].key === key) {
          clearTimeout(this.queue[i].timeoutHandle);
          this.queue.splice(i, 1);
        }
      }
      const timer = this.drainTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.drainTimers.delete(key);
      }
    } else {
      this.buckets.clear();
      for (const item of this.queue) {
        clearTimeout(item.timeoutHandle);
      }
      this.queue.length = 0;
      for (const timer of this.drainTimers.values()) {
        clearTimeout(timer);
      }
      this.drainTimers.clear();
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private getOrCreateBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private pruneExpired(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;

    const cutoff = Date.now() - this.config.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
  }

  private scheduleDrain(key: string): void {
    if (this.drainTimers.has(key)) return;

    const retryMs = this.retryAfterMs(key);
    const delay = Math.max(retryMs, 100);

    const timer = setTimeout(() => {
      this.drainTimers.delete(key);
      this.drainQueue(key);
    }, delay);

    this.drainTimers.set(key, timer);
  }

  private drainQueue(key: string): void {
    this.pruneExpired(key);
    const bucket = this.getOrCreateBucket(key);

    // Only drain items for this specific key
    let i = 0;
    while (i < this.queue.length && bucket.timestamps.length < this.config.maxOperations) {
      if (this.queue[i].key !== key) {
        i++;
        continue;
      }

      const item = this.queue.splice(i, 1)[0];
      if (item.settled) continue;

      item
        .execute()
        .then(item.resolve)
        .catch(item.reject);
    }

    // Check if there are more items for this key still queued
    if (this.queue.some((q) => q.key === key)) {
      this.scheduleDrain(key);
    }
  }
}
