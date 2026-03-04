// ── Client ───────────────────────────────────────────────────────────────────
export { ZeroHashTradingClient } from "./client/ZeroHashTradingClient";
export { JWTManager } from "./client/JWTManager";
export { ModalManager } from "./client/ModalManager";
export { VersionGuard } from "./client/VersionGuard";
export { ConversionTracker } from "./client/ConversionTracker";
export { SlippageGuard } from "./client/SlippageGuard";
export { RateLimiter } from "./client/RateLimiter";

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  TradingClientConfig,
  TradingFlowType,
  TradingEvent,
  JWTProvider,
  Environment,
  RetryConfig,
  VersionConstraint,
  FlowConfig,
  FeatureFlags,
  ZeroHashSDKInstance,
  ZeroHashSDKFactory,
  ZeroHashSDKInitConfig,
  ZeroHashModalParams,
  HealthStatus,
  CircuitState,
} from "./client/types";

export type {
  ConversionStep,
  ConversionEvent,
  ConversionHooks,
} from "./client/ConversionTracker";

export type {
  SlippageConfig,
  SlippageEvent,
  FlowSlippageOverrides,
} from "./client/SlippageGuard";

export type { RateLimitConfig } from "./client/RateLimiter";

// ── Telemetry ────────────────────────────────────────────────────────────────
export { EventBus } from "./telemetry/EventBus";
export type { EventBusErrorHandler } from "./telemetry/EventBus";
export type {
  TelemetryConfig,
  TelemetryEmitter,
  TradingEventPayload,
  TradingEventType,
  TradingEventMap,
} from "./telemetry/TelemetryHooks";

// ── Errors ───────────────────────────────────────────────────────────────────
export { ZeroHashError } from "./errors/ZeroHashError";
export { ErrorCode, RETRYABLE_ERRORS } from "./errors/ErrorCodes";
export type { ErrorContext } from "./errors/ZeroHashError";

// ── Utilities ────────────────────────────────────────────────────────────────
export { retry } from "./utils/retry";
export type { RetryOptions, BackoffStrategy } from "./utils/retry";
export { createLogger } from "./utils/logger";
export type { Logger, LogLevel } from "./utils/logger";
export { generateCorrelationId } from "./utils/correlationId";
export { withTimeout } from "./utils/withTimeout";
export { CircuitBreaker } from "./utils/CircuitBreaker";
export type { CircuitBreakerConfig } from "./utils/CircuitBreaker";
