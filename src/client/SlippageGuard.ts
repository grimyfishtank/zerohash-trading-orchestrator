import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { Logger } from "../utils/logger";
import type { TradingFlowType } from "./types";

// ── Slippage Configuration ──────────────────────────────────────────────────

export interface SlippageConfig {
  /** Maximum acceptable slippage as a decimal (e.g. 0.01 = 1%) */
  maxTolerancePercent: number;

  /** Action to take when slippage exceeds tolerance */
  action: "warn" | "block" | "prompt";

  /** Optional callback when slippage is detected */
  onSlippageDetected?: (event: SlippageEvent) => void;
}

export interface SlippageEvent {
  flow: TradingFlowType;
  expectedPrice: number;
  actualPrice: number;
  slippagePercent: number;
  tolerancePercent: number;
  action: SlippageConfig["action"];
  timestamp: number;
}

// ── Per-Flow Overrides ──────────────────────────────────────────────────────

export type FlowSlippageOverrides = Partial<
  Record<TradingFlowType, Partial<SlippageConfig>>
>;

// ── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_SLIPPAGE: SlippageConfig = {
  maxTolerancePercent: 0.02, // 2%
  action: "warn",
};

export class SlippageGuard {
  private readonly defaults: SlippageConfig;
  private readonly overrides: FlowSlippageOverrides;

  constructor(
    config: Partial<SlippageConfig> | undefined,
    overrides: FlowSlippageOverrides | undefined,
    private readonly logger: Logger
  ) {
    this.defaults = { ...DEFAULT_SLIPPAGE, ...config };
    this.overrides = overrides ?? {};
  }

  /** Returns the resolved slippage config for a given flow */
  getConfig(flow: TradingFlowType): SlippageConfig {
    const override = this.overrides[flow];
    if (!override) return this.defaults;
    return { ...this.defaults, ...override };
  }

  /**
   * Evaluate a price deviation and take the configured action.
   * Returns the SlippageEvent for telemetry / UI consumption.
   * Throws if action is "block" and slippage exceeds tolerance.
   */
  evaluate(
    flow: TradingFlowType,
    expectedPrice: number,
    actualPrice: number
  ): SlippageEvent | null {
    if (expectedPrice <= 0 || actualPrice < 0) {
      this.logger.warn("Cannot evaluate slippage: invalid prices", {
        flow,
        expectedPrice,
        actualPrice,
      });
      return null;
    }

    const slippagePercent =
      Math.abs(actualPrice - expectedPrice) / expectedPrice;
    const config = this.getConfig(flow);

    if (slippagePercent <= config.maxTolerancePercent) {
      return null; // Within tolerance
    }

    const event: SlippageEvent = {
      flow,
      expectedPrice,
      actualPrice,
      slippagePercent,
      tolerancePercent: config.maxTolerancePercent,
      action: config.action,
      timestamp: Date.now(),
    };

    this.logger.warn(
      `Slippage ${(slippagePercent * 100).toFixed(2)}% exceeds tolerance ${(config.maxTolerancePercent * 100).toFixed(2)}%`,
      { flow, action: config.action }
    );

    // Notify integrator
    try {
      config.onSlippageDetected?.(event);
    } catch {
      this.logger.warn("SlippageConfig.onSlippageDetected threw");
    }

    if (config.action === "block") {
      throw new ZeroHashError(
        ErrorCode.SLIPPAGE_EXCEEDED,
        `Slippage of ${(slippagePercent * 100).toFixed(2)}% exceeds maximum tolerance of ${(config.maxTolerancePercent * 100).toFixed(2)}% for flow ${flow}`,
        {
          flow,
          expectedPrice,
          actualPrice,
          slippagePercent,
          tolerancePercent: config.maxTolerancePercent,
        }
      );
    }

    return event;
  }
}
