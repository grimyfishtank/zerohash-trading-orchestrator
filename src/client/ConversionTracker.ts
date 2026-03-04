import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "../utils/logger";
import type { TradingFlowType } from "./types";

// ── Conversion Funnel Steps ─────────────────────────────────────────────────

export type ConversionStep =
  | "FLOW_INITIATED"
  | "JWT_ACQUIRED"
  | "MODAL_DISPLAYED"
  | "USER_INTERACTED"
  | "TRANSACTION_SUBMITTED"
  | "TRANSACTION_CONFIRMED"
  | "FLOW_COMPLETED"
  | "FLOW_ABANDONED";

export interface ConversionEvent {
  flow: TradingFlowType;
  step: ConversionStep;
  timestamp: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversionHooks {
  onStepCompleted?: (event: ConversionEvent) => void;
  onFunnelCompleted?: (flow: TradingFlowType, totalDurationMs: number) => void;
  onFunnelAbandoned?: (
    flow: TradingFlowType,
    lastStep: ConversionStep,
    durationMs: number
  ) => void;
}

// ── Active Funnel Tracking ──────────────────────────────────────────────────

interface ActiveFunnel {
  flow: TradingFlowType;
  startedAt: number;
  steps: ConversionEvent[];
  lastStep: ConversionStep;
}

export class ConversionTracker {
  private readonly activeFunnels = new Map<TradingFlowType, ActiveFunnel>();

  constructor(
    private readonly hooks: ConversionHooks,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger
  ) {}

  beginFunnel(flow: TradingFlowType, metadata?: Record<string, unknown>): void {
    const existing = this.activeFunnels.get(flow);
    if (existing) {
      this.logger.warn("Overwriting active funnel — previous funnel was not completed or abandoned", {
        flow,
        previousSteps: existing.steps.length,
        previousLastStep: existing.lastStep,
      });
      this.abandonFunnel(flow);
    }

    const now = Date.now();

    this.activeFunnels.set(flow, {
      flow,
      startedAt: now,
      steps: [],
      lastStep: "FLOW_INITIATED",
    });

    this.recordStep(flow, "FLOW_INITIATED", metadata);
    this.logger.debug("Conversion funnel started", { flow });
  }

  recordStep(
    flow: TradingFlowType,
    step: ConversionStep,
    metadata?: Record<string, unknown>
  ): void {
    const funnel = this.activeFunnels.get(flow);
    if (!funnel) {
      this.logger.debug("No active funnel for step recording", { flow, step });
      return;
    }

    const now = Date.now();
    const previousStepTime =
      funnel.steps.length > 0
        ? funnel.steps[funnel.steps.length - 1].timestamp
        : funnel.startedAt;

    const event: ConversionEvent = {
      flow,
      step,
      timestamp: now,
      durationMs: now - previousStepTime,
      metadata,
    };

    funnel.steps.push(event);
    funnel.lastStep = step;

    this.telemetry.track("CONVERSION_STEP", flow, {
      step,
      durationMs: event.durationMs,
      ...metadata,
    });

    try {
      this.hooks.onStepCompleted?.(event);
    } catch {
      this.logger.warn("ConversionHooks.onStepCompleted threw");
    }
  }

  completeFunnel(flow: TradingFlowType): void {
    const funnel = this.activeFunnels.get(flow);
    if (!funnel) return;

    this.recordStep(flow, "FLOW_COMPLETED");

    const totalDurationMs = Date.now() - funnel.startedAt;

    this.telemetry.track("CONVERSION_COMPLETED", flow, {
      totalDurationMs,
      stepCount: funnel.steps.length,
    });

    try {
      this.hooks.onFunnelCompleted?.(flow, totalDurationMs);
    } catch {
      this.logger.warn("ConversionHooks.onFunnelCompleted threw");
    }

    this.activeFunnels.delete(flow);
    this.logger.info("Conversion funnel completed", { flow, totalDurationMs });
  }

  abandonFunnel(flow: TradingFlowType): void {
    const funnel = this.activeFunnels.get(flow);
    if (!funnel) return;

    // Capture the last meaningful step before recording FLOW_ABANDONED
    const lastMeaningfulStep = funnel.lastStep;

    this.recordStep(flow, "FLOW_ABANDONED");

    const durationMs = Date.now() - funnel.startedAt;

    this.telemetry.track("CONVERSION_ABANDONED", flow, {
      lastStep: lastMeaningfulStep,
      durationMs,
      stepCount: funnel.steps.length,
    });

    try {
      this.hooks.onFunnelAbandoned?.(flow, lastMeaningfulStep, durationMs);
    } catch {
      this.logger.warn("ConversionHooks.onFunnelAbandoned threw");
    }

    this.activeFunnels.delete(flow);
    this.logger.info("Conversion funnel abandoned", {
      flow,
      lastStep: lastMeaningfulStep,
    });
  }

  getActiveFunnel(flow: TradingFlowType): Readonly<ActiveFunnel> | undefined {
    return this.activeFunnels.get(flow);
  }

  getActiveFunnels(): { flow: TradingFlowType; stepCount: number; lastStep: string; durationMs: number }[] {
    return Array.from(this.activeFunnels.values()).map((funnel) => ({
      flow: funnel.flow,
      stepCount: funnel.steps.length,
      lastStep: funnel.lastStep,
      durationMs: Date.now() - funnel.startedAt,
    }));
  }

  reset(): void {
    this.activeFunnels.clear();
  }
}
