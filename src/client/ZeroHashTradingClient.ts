import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import { EventBus } from "../telemetry/EventBus";
import {
  createTelemetryEmitter,
  errorMetadata,
  type TelemetryConfig,
  type TelemetryEmitter,
  type TradingEventMap,
  type TradingEventType,
} from "../telemetry/TelemetryHooks";
import { CircuitBreaker } from "../utils/CircuitBreaker";
import { generateCorrelationId } from "../utils/correlationId";
import { createLogger, type Logger } from "../utils/logger";
import { retry, type RetryOptions } from "../utils/retry";
import { withTimeout } from "../utils/withTimeout";
import { ConversionTracker } from "./ConversionTracker";
import { JWTManager } from "./JWTManager";
import { ModalManager } from "./ModalManager";
import { RateLimiter } from "./RateLimiter";
import { SlippageGuard, type SlippageEvent } from "./SlippageGuard";
import type {
  FeatureFlags,
  FlowConfig,
  HealthStatus,
  RetryConfig,
  TradingClientConfig,
  TradingEvent,
  TradingFlowType,
  ZeroHashSDKFactory,
  ZeroHashSDKInstance,
} from "./types";
import { VersionGuard } from "./VersionGuard";

const DEFAULT_RETRY: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  backoffStrategy: "exponential",
  baseDelayMs: 500,
};

const DEFAULT_FEATURES: FeatureFlags = {
  enableRetry: true,
  enableVersionCheck: true,
  enableTelemetry: true,
  enableConversionTracking: true,
  enableSlippageGuard: false,
  enableRateLimiting: false,
  enableCircuitBreaker: false,
};

const DEFAULT_TIMEOUT_MS = 30_000;

// Maps user-facing events to internal telemetry event types
const EVENT_MAPPING: Record<TradingEvent, TradingEventType[]> = {
  FLOW_OPENED: ["FLOW_OPENED"],
  FLOW_CLOSED: ["FLOW_CLOSED"],
  JWT_REFRESHED: ["JWT_REFRESHED"],
  ERROR: ["ERROR_THROWN", "JWT_FAILED"],
};

export class ZeroHashTradingClient {
  private sdk: ZeroHashSDKInstance | null = null;
  private jwtManager: JWTManager | null = null;
  private modalManager: ModalManager | null = null;
  private conversionTracker: ConversionTracker | null = null;
  private slippageGuard: SlippageGuard | null = null;
  private rateLimiter: RateLimiter | null = null;
  private circuitBreaker: CircuitBreaker | null = null;
  private initialized = false;
  private initTimestamp: number | null = null;
  private openFlowInProgress: TradingFlowType | null = null;

  private readonly eventBus: EventBus<TradingEventMap>;
  private readonly telemetry: TelemetryEmitter;
  private readonly logger: Logger;
  private readonly retryConfig: RetryConfig;
  private readonly features: FeatureFlags;
  private readonly flowOverrides: Partial<
    Record<TradingFlowType, FlowConfig>
  >;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: TradingClientConfig,
    private readonly sdkFactory?: ZeroHashSDKFactory
  ) {
    this.logger = createLogger(
      "ZeroHashTradingClient",
      config.logLevel ?? "info"
    );

    this.retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    this.features = { ...DEFAULT_FEATURES, ...config.featureFlags };
    this.flowOverrides = config.flowOverrides ?? {};
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.eventBus = new EventBus<TradingEventMap>();

    // The event bus always emits (so client.on() subscriptions always work).
    // When telemetry is disabled, the integrator's onEvent hook is suppressed.
    const telemetryConfig: TelemetryConfig = this.features.enableTelemetry
      ? (config.telemetry ?? {})
      : {}; // No integrator hook — but internal bus still fires
    this.telemetry = createTelemetryEmitter(
      telemetryConfig,
      (event, payload) => this.eventBus.emit(event, payload)
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn("Client already initialized");
      return;
    }

    try {
      const sdk = this.sdkFactory
        ? this.sdkFactory()
        : this.createDefaultSDK();

      // Version check
      if (this.features.enableVersionCheck && this.config.versionConstraint) {
        const guard = new VersionGuard(
          this.config.versionConstraint,
          this.telemetry,
          this.logger
        );
        guard.validate(sdk);
      }

      // Initialize the SDK
      await sdk.init({
        appsUrl: this.config.zeroHashAppsURL,
        env: this.config.environment,
      });

      this.sdk = sdk;

      // Circuit breaker (created before JWTManager since it's injected)
      if (this.features.enableCircuitBreaker) {
        this.circuitBreaker = new CircuitBreaker(
          this.config.circuitBreaker,
          this.telemetry,
          this.logger
        );
      }

      this.jwtManager = new JWTManager(
        this.config.jwtProvider,
        this.telemetry,
        this.logger,
        this.flowOverrides,
        this.circuitBreaker ?? undefined,
      );
      this.modalManager = new ModalManager(sdk, this.telemetry, this.logger);

      // Conversion tracking
      if (this.features.enableConversionTracking) {
        this.conversionTracker = new ConversionTracker(
          this.config.conversion ?? {},
          this.telemetry,
          this.logger
        );
      }

      // Slippage guard
      if (this.features.enableSlippageGuard) {
        this.slippageGuard = new SlippageGuard(
          this.config.slippage,
          this.config.slippageOverrides,
          this.logger
        );
      }

      // Rate limiter
      if (this.features.enableRateLimiting) {
        this.rateLimiter = new RateLimiter(
          this.config.rateLimit,
          this.telemetry,
          this.logger
        );
      }

      this.initialized = true;
      this.initTimestamp = Date.now();

      this.telemetry.track("SDK_INITIALIZED");
      this.logger.info("Client initialized", {
        environment: this.config.environment,
      });
    } catch (error: unknown) {
      const zhError =
        error instanceof ZeroHashError
          ? error
          : new ZeroHashError(
              ErrorCode.INITIALIZATION_FAILED,
              "SDK initialization failed",
              { originalError: error }
            );

      this.emitError(zhError);
      throw zhError;
    }
  }

  // ── Flow Orchestration ────────────────────────────────────────────────

  async openFlow(flow: TradingFlowType): Promise<void> {
    this.ensureInitialized();

    if (this.openFlowInProgress) {
      throw new ZeroHashError(
        ErrorCode.MODAL_CONFLICT,
        `Cannot open flow "${flow}": flow "${this.openFlowInProgress}" is currently being opened`,
        { requestedFlow: flow, inProgressFlow: this.openFlowInProgress }
      );
    }

    this.openFlowInProgress = flow;
    const correlationId = generateCorrelationId();

    const execute = async (signal: AbortSignal): Promise<void> => {
      const metadata = this.resolveMetadata(flow);

      // Begin conversion funnel
      this.conversionTracker?.beginFunnel(flow, { ...metadata, correlationId });

      if (signal.aborted) throw signal.reason;
      const jwt = await this.jwtManager!.getToken(flow);
      this.conversionTracker?.recordStep(flow, "JWT_ACQUIRED", { correlationId });

      if (signal.aborted) throw signal.reason;
      await this.modalManager!.open(flow, jwt, metadata);
      this.conversionTracker?.recordStep(flow, "MODAL_DISPLAYED", { correlationId });
    };

    const timedExecute = () => withTimeout(
      (signal) => execute(signal),
      this.timeoutMs
    );

    const guarded = this.rateLimiter
      ? () => this.rateLimiter!.acquireForFlow(flow, timedExecute)
      : timedExecute;

    try {
      if (this.features.enableRetry && this.retryConfig.enabled) {
        await this.withRetry(guarded, flow, correlationId);
      } else {
        try {
          await guarded();
        } catch (error: unknown) {
          const zhError = ZeroHashError.fromUnknown(
            error,
            ErrorCode.NETWORK_ERROR
          );
          this.emitError(zhError, flow, correlationId);
          throw zhError;
        }
      }
    } finally {
      this.openFlowInProgress = null;
    }
  }

  async closeFlow(flow: TradingFlowType): Promise<void> {
    this.ensureInitialized();

    try {
      await withTimeout(
        () => this.modalManager!.close(flow),
        this.timeoutMs
      );
      this.conversionTracker?.abandonFunnel(flow);
    } catch (error: unknown) {
      const zhError = ZeroHashError.fromUnknown(
        error,
        ErrorCode.MODAL_CLOSE_FAILED
      );
      this.emitError(zhError, flow);
      throw zhError;
    }
  }

  /**
   * Mark the current flow's conversion funnel as completed (e.g. after
   * a successful transaction confirmation callback from the SDK).
   */
  completeConversion(flow: TradingFlowType): void {
    this.conversionTracker?.completeFunnel(flow);
  }

  /**
   * Record an intermediate conversion step (e.g. user interaction,
   * transaction submission) for funnel analytics.
   */
  recordConversionStep(
    flow: TradingFlowType,
    step: "USER_INTERACTED" | "TRANSACTION_SUBMITTED" | "TRANSACTION_CONFIRMED",
    metadata?: Record<string, unknown>
  ): void {
    this.conversionTracker?.recordStep(flow, step, metadata);
  }

  /**
   * Evaluate price slippage for a trading flow. Returns the slippage event
   * if tolerance is exceeded, or null if within bounds.
   * Throws if the flow's slippage action is set to "block".
   */
  evaluateSlippage(
    flow: TradingFlowType,
    expectedPrice: number,
    actualPrice: number
  ): SlippageEvent | null {
    if (!this.slippageGuard) {
      this.logger.debug("SlippageGuard not enabled");
      return null;
    }

    const event = this.slippageGuard.evaluate(flow, expectedPrice, actualPrice);
    if (event) {
      this.telemetry.track("SLIPPAGE_DETECTED", flow, {
        slippagePercent: event.slippagePercent,
        action: event.action,
      });
    }
    return event;
  }

  async refreshJWT(flow: TradingFlowType): Promise<void> {
    this.ensureInitialized();

    try {
      await this.jwtManager!.refreshToken(flow);
    } catch (error: unknown) {
      const zhError = ZeroHashError.fromUnknown(
        error,
        ErrorCode.JWT_FETCH_FAILED
      );
      this.emitError(zhError, flow);
      throw zhError;
    }
  }

  // ── Event Subscription ────────────────────────────────────────────────

  on(event: TradingEvent, callback: (payload: unknown) => void): () => void {
    const internalEvents = EVENT_MAPPING[event];
    const unsubscribers = internalEvents.map((internalEvent) =>
      this.eventBus.on(internalEvent, callback)
    );

    return () => unsubscribers.forEach((unsub) => unsub());
  }

  // ── Inspection ────────────────────────────────────────────────────────

  get isInitialized(): boolean {
    return this.initialized;
  }

  get activeFlow(): TradingFlowType | null {
    return this.modalManager?.currentFlow ?? null;
  }

  // ── Health / Diagnostics ──────────────────────────────────────────────

  health(): HealthStatus {
    const rateLimiterStatus: HealthStatus["rateLimiter"] = this.rateLimiter
      ? Object.fromEntries(
          this.rateLimiter.getKeys().map((key) => [key, {
            remaining: this.rateLimiter!.remaining(key),
            retryAfterMs: this.rateLimiter!.retryAfterMs(key),
          }])
        )
      : null;

    return {
      initialized: this.initialized,
      activeFlow: this.modalManager?.currentFlow ?? null,
      jwt: this.jwtManager?.getCacheStatus() ?? { cachedFlows: [], inflightFlows: [] },
      modal: {
        isOpen: this.modalManager?.isOpen ?? false,
        currentFlow: this.modalManager?.currentFlow ?? null,
      },
      rateLimiter: rateLimiterStatus,
      circuitBreaker: this.circuitBreaker?.getState() ?? null,
      conversionFunnels: this.conversionTracker?.getActiveFunnels() ?? [],
      uptime: this.initTimestamp ? Date.now() - this.initTimestamp : 0,
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  destroy(): void {
    this.jwtManager?.invalidateAll();
    this.modalManager?.forceReset();
    this.conversionTracker?.reset();
    this.rateLimiter?.reset();
    this.circuitBreaker?.reset();
    this.eventBus.removeAllListeners();
    this.sdk = null;
    this.jwtManager = null;
    this.modalManager = null;
    this.conversionTracker = null;
    this.slippageGuard = null;
    this.rateLimiter = null;
    this.circuitBreaker = null;
    this.initTimestamp = null;
    this.initialized = false;
    this.logger.info("Client destroyed");
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized || !this.sdk || !this.jwtManager || !this.modalManager) {
      throw new ZeroHashError(
        ErrorCode.SDK_NOT_INITIALIZED,
        "Client has not been initialized. Call initialize() first."
      );
    }
  }

  private async withRetry(
    fn: () => Promise<void>,
    flow: TradingFlowType,
    correlationId?: string
  ): Promise<void> {
    const options: Partial<RetryOptions> = {
      retries: this.retryConfig.maxRetries,
      backoffStrategy: this.retryConfig.backoffStrategy,
      baseDelayMs: this.retryConfig.baseDelayMs,
      onRetry: (attempt, error) => {
        this.telemetry.track("RETRY_ATTEMPT", flow, {
          attempt,
          errorCode: error.code,
        }, correlationId);
      },
    };

    try {
      await retry(fn, options);
    } catch (error: unknown) {
      const zhError = ZeroHashError.fromUnknown(
        error,
        ErrorCode.RETRY_EXHAUSTED
      );
      this.emitError(zhError, flow, correlationId);
      throw zhError;
    }
  }

  private resolveMetadata(
    flow: TradingFlowType
  ): Record<string, unknown> | undefined {
    const base = this.config.partnerMetadata;
    const override = this.flowOverrides[flow]?.metadata;

    if (!base && !override) return undefined;
    return { ...base, ...override };
  }

  private emitError(error: ZeroHashError, flow?: TradingFlowType, correlationId?: string): void {
    this.telemetry.track(
      "ERROR_THROWN",
      flow,
      errorMetadata(error.code, error.message),
      correlationId
    );
  }

  /**
   * Creates an adapter that bridges the real zh-web-sdk API to our
   * ZeroHashSDKInstance interface. The real SDK has a narrower surface
   * (onboarding-modal methods only), so we normalize it here.
   */
  private createDefaultSDK(): ZeroHashSDKInstance {
    // We need the real SDK class. Use a dynamic expression so bundlers
    // don't inline it and so it works in both CJS and ESM contexts.
    const moduleName = "zh-web-sdk";
    let ZeroHashSDKClass: new (
      params: { zeroHashOnboardingURL: string; userOnboardingJWT?: string }
    ) => {
      setUserOnboardingJWT(params: { userOnboardingJWT: string }): void;
      openOnboardingModal(params: { userOnboardingJWT?: string }): void;
      closeOnboardingModal(): void;
      isOnboardingModalOpen(): boolean;
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(moduleName) as { ZeroHashSDK: typeof ZeroHashSDKClass };
      ZeroHashSDKClass = mod.ZeroHashSDK;
    } catch {
      throw new ZeroHashError(
        ErrorCode.SDK_NOT_INITIALIZED,
        "zh-web-sdk is not installed. Install it as a peer dependency or provide a custom SDK factory via the second constructor argument."
      );
    }

    let realSDK: InstanceType<typeof ZeroHashSDKClass> | null = null;

    return {
      async init(config) {
        realSDK = new ZeroHashSDKClass({
          zeroHashOnboardingURL: config.appsUrl,
        });
      },
      async openModal(params) {
        if (!realSDK) throw new Error("SDK not initialized");
        realSDK.setUserOnboardingJWT({ userOnboardingJWT: params.jwt });
        realSDK.openOnboardingModal({ userOnboardingJWT: params.jwt });
      },
      async closeModal() {
        if (!realSDK) throw new Error("SDK not initialized");
        realSDK.closeOnboardingModal();
      },
      isModalOpen() {
        if (!realSDK) return false;
        return realSDK.isOnboardingModalOpen();
      },
      // SDK does not expose a version property — VersionGuard
      // falls back to reading zh-web-sdk/package.json
      version: undefined,
    };
  }
}
