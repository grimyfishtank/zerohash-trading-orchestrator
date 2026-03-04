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
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxOperations: 5,
  windowMs: 60_000, // 1 minute
  strategy: "reject",
};

// ── Sliding Window Bucket ───────────────────────────────────────────────────

interface Bucket {
  timestamps: number[];
}

// ── Queued Operation ────────────────────────────────────────────────────────

interface QueuedOperation<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, Bucket>();
  private readonly queue: QueuedOperation<unknown>[] = [];
  private draining = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Queue strategy — wait until a slot is available
    this.logger.debug("Operation queued due to rate limit", { key });

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: async () => {
          this.getOrCreateBucket(key).timestamps.push(Date.now());
          return operation();
        },
        resolve: resolve as (value: unknown) => void,
        reject,
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

  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
      this.queue.length = 0;
      if (this.drainTimer) {
        clearTimeout(this.drainTimer);
        this.drainTimer = null;
      }
      this.draining = false;
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
    if (this.draining) return;
    this.draining = true;

    const retryMs = this.retryAfterMs(key);
    const delay = Math.max(retryMs, 100);

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.draining = false;
      this.drainQueue(key);
    }, delay);
  }

  private drainQueue(key: string): void {
    this.pruneExpired(key);
    const bucket = this.getOrCreateBucket(key);

    while (
      this.queue.length > 0 &&
      bucket.timestamps.length < this.config.maxOperations
    ) {
      const item = this.queue.shift()!;
      item
        .execute()
        .then(item.resolve)
        .catch(item.reject);
    }

    if (this.queue.length > 0) {
      this.scheduleDrain(key);
    }
  }
}
