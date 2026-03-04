import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "./logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime: number | null = null;
  private halfOpenAttempts = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(
    config: Partial<CircuitBreakerConfig> | undefined,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("HALF_OPEN");
      } else {
        throw new ZeroHashError(
          ErrorCode.CIRCUIT_OPEN,
          "Circuit breaker is OPEN — requests are being rejected",
          { failures: this.failures, lastFailure: this.lastFailureTime }
        );
      }
    }

    if (this.state === "HALF_OPEN" && this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
      throw new ZeroHashError(
        ErrorCode.CIRCUIT_OPEN,
        "Circuit breaker is HALF_OPEN — max test attempts reached",
        { halfOpenAttempts: this.halfOpenAttempts }
      );
    }

    try {
      if (this.state === "HALF_OPEN") {
        this.halfOpenAttempts++;
      }
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): { state: CircuitState; failures: number; lastFailure: number | null } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailureTime,
    };
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.transitionTo("CLOSED");
    }
    this.failures = 0;
    this.halfOpenAttempts = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
    } else if (this.failures >= this.config.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.logger.info(`Circuit breaker: ${oldState} -> ${newState}`, {
      failures: this.failures,
    });

    const eventMap = {
      OPEN: "CIRCUIT_OPENED",
      CLOSED: "CIRCUIT_CLOSED",
      HALF_OPEN: "CIRCUIT_HALF_OPEN",
    } as const;

    this.telemetry.track(eventMap[newState], undefined, {
      previousState: oldState,
      failures: this.failures,
    });

    if (newState === "HALF_OPEN") {
      this.halfOpenAttempts = 0;
    }
  }
}
