import type { TradingFlowType } from "../client/types";
import type { ErrorCode } from "../errors/ErrorCodes";

export interface TradingEventPayload {
  event: TradingEventType;
  flow?: TradingFlowType;
  timestamp: number;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export type TradingEventType =
  | "FLOW_OPENED"
  | "FLOW_CLOSED"
  | "JWT_REFRESHED"
  | "JWT_FAILED"
  | "JWT_EXPIRED"
  | "RETRY_ATTEMPT"
  | "ERROR_THROWN"
  | "VERSION_MISMATCH"
  | "SDK_INITIALIZED"
  | "MODAL_CONFLICT_DETECTED"
  | "CONVERSION_STEP"
  | "CONVERSION_COMPLETED"
  | "CONVERSION_ABANDONED"
  | "SLIPPAGE_DETECTED"
  | "RATE_LIMITED"
  | "RATE_LIMIT_QUEUED"
  | "OPERATION_TIMEOUT"
  | "CIRCUIT_OPENED"
  | "CIRCUIT_CLOSED"
  | "CIRCUIT_HALF_OPEN";

export interface TelemetryConfig {
  onEvent?: (payload: TradingEventPayload) => void;
  enrichMetadata?: () => Record<string, unknown>;
}

export type TradingEventMap = {
  [K in TradingEventType]: TradingEventPayload;
};

export function buildEventPayload(
  event: TradingEventType,
  flow?: TradingFlowType,
  metadata?: Record<string, unknown>,
  enrichMetadata?: () => Record<string, unknown>,
  correlationId?: string
): TradingEventPayload {
  const payload: TradingEventPayload = {
    event,
    flow,
    timestamp: Date.now(),
    metadata: {
      ...enrichMetadata?.(),
      ...metadata,
    },
  };

  if (correlationId) {
    payload.correlationId = correlationId;
  }

  return payload;
}

export interface TelemetryEmitter {
  track(
    event: TradingEventType,
    flow?: TradingFlowType,
    metadata?: Record<string, unknown>,
    correlationId?: string
  ): void;
}

export function createTelemetryEmitter(
  config: TelemetryConfig,
  emit: (event: TradingEventType, payload: TradingEventPayload) => void
): TelemetryEmitter {
  return {
    track(event, flow, metadata, correlationId) {
      const payload = buildEventPayload(
        event,
        flow,
        metadata,
        config.enrichMetadata,
        correlationId
      );

      // Emit to internal bus
      emit(event, payload);

      // Forward to integrator hook
      try {
        config.onEvent?.(payload);
      } catch {
        console.error("[Telemetry] Integrator onEvent hook threw");
      }
    },
  };
}

export function errorMetadata(
  code: ErrorCode,
  message: string
): Record<string, unknown> {
  return { errorCode: code, errorMessage: message };
}
