import type { TelemetryConfig } from "../telemetry/TelemetryHooks";
import type { LogLevel } from "../utils/logger";
import type { ConversionHooks } from "./ConversionTracker";
import type { RateLimitConfig } from "./RateLimiter";
import type { FlowSlippageOverrides, SlippageConfig } from "./SlippageGuard";

// ── Flow Types ──────────────────────────────────────────────────────────────

export type TradingFlowType =
  | "ONBOARDING"
  | "CRYPTO_BUY"
  | "CRYPTO_SELL"
  | "FIAT_DEPOSIT"
  | "FIAT_WITHDRAWAL"
  | "CRYPTO_WITHDRAWAL";

// ── Events ──────────────────────────────────────────────────────────────────

export type TradingEvent =
  | "FLOW_OPENED"
  | "FLOW_CLOSED"
  | "JWT_REFRESHED"
  | "ERROR";

// ── JWT ─────────────────────────────────────────────────────────────────────

export interface JWTProvider {
  getJWT(flow: TradingFlowType): Promise<string>;
}

// ── Configuration ───────────────────────────────────────────────────────────

export type Environment = "prod" | "cert";

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  backoffStrategy: "exponential" | "linear";
  baseDelayMs: number;
}

export interface VersionConstraint {
  minVersion: string;
  maxVersion?: string;
}

export interface FlowConfig {
  jwtProvider?: JWTProvider;
  metadata?: Record<string, unknown>;
  slippage?: Partial<SlippageConfig>;
}

export interface FeatureFlags {
  enableRetry: boolean;
  enableVersionCheck: boolean;
  enableTelemetry: boolean;
  enableConversionTracking: boolean;
  enableSlippageGuard: boolean;
  enableRateLimiting: boolean;
}

export interface TradingClientConfig {
  zeroHashAppsURL: string;
  environment: Environment;
  jwtProvider: JWTProvider;
  telemetry?: TelemetryConfig;
  retry?: Partial<RetryConfig>;
  versionConstraint?: VersionConstraint;
  featureFlags?: Partial<FeatureFlags>;
  flowOverrides?: Partial<Record<TradingFlowType, FlowConfig>>;
  partnerMetadata?: Record<string, unknown>;
  logLevel?: LogLevel;
  conversion?: ConversionHooks;
  slippage?: Partial<SlippageConfig>;
  slippageOverrides?: FlowSlippageOverrides;
  rateLimit?: Partial<RateLimitConfig>;
}

// ── SDK Interface ───────────────────────────────────────────────────────────
// This is the ORCHESTRATOR's abstraction over the SDK. It is intentionally
// different from the raw zh-web-sdk API (which only exposes onboarding-modal
// methods). The default adapter in ZeroHashTradingClient bridges this
// interface to the real SDK. Consumers may also provide their own factory
// to substitute a mock or a different SDK version.

export interface ZeroHashSDKInstance {
  init(config: ZeroHashSDKInitConfig): Promise<void>;
  openModal(params: ZeroHashModalParams): Promise<void>;
  closeModal(): Promise<void>;
  isModalOpen(): boolean;
  version?: string;
}

export interface ZeroHashSDKInitConfig {
  appsUrl: string;
  env: Environment;
}

export interface ZeroHashModalParams {
  flow: string;
  jwt: string;
  metadata?: Record<string, unknown>;
}

// ── SDK Factory ─────────────────────────────────────────────────────────────
// Allows injection of a custom SDK instance (testing, alternate SDK versions).
// When not provided, the client creates an adapter around the real zh-web-sdk.

export type ZeroHashSDKFactory = () => ZeroHashSDKInstance;
