import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { CircuitBreaker } from "../utils/CircuitBreaker";
import type { Logger } from "../utils/logger";
import type { JWTProvider, TradingFlowType } from "./types";

interface CachedToken {
  token: string;
  expiresAt: number;
  fetchedAt: number;
}

// Preemptive refresh window: refresh when less than this many ms remain
const PREEMPTIVE_REFRESH_MS = 30_000;

export class JWTManager {
  private readonly cache = new Map<TradingFlowType, CachedToken>();
  private readonly inflightRequests = new Map<
    TradingFlowType,
    Promise<string>
  >();

  constructor(
    private readonly provider: JWTProvider,
    private readonly telemetry: TelemetryEmitter,
    private readonly logger: Logger,
    private readonly flowOverrides?: Partial<Record<TradingFlowType, { jwtProvider?: JWTProvider }>>,
    private readonly circuitBreaker?: CircuitBreaker,
  ) {}

  async getToken(flow: TradingFlowType): Promise<string> {
    const cached = this.cache.get(flow);

    if (cached) {
      if (this.isExpired(cached)) {
        this.telemetry.track("JWT_EXPIRED", flow, {
          expiredAt: cached.expiresAt,
          expiredAgoMs: Date.now() - cached.expiresAt,
        });
        this.logger.info("Cached JWT is expired, refreshing", { flow });
      } else if (!this.isExpiringSoon(cached)) {
        this.logger.debug("Using cached JWT", { flow });
        return cached.token;
      }
    }

    return this.fetchToken(flow);
  }

  async refreshToken(flow: TradingFlowType): Promise<string> {
    this.cache.delete(flow);
    return this.fetchToken(flow);
  }

  invalidate(flow: TradingFlowType): void {
    this.cache.delete(flow);
    this.logger.info("JWT invalidated", { flow });
  }

  invalidateAll(): void {
    this.cache.clear();
    this.logger.info("All JWTs invalidated");
  }

  getCacheStatus(): { cachedFlows: TradingFlowType[]; inflightFlows: TradingFlowType[] } {
    return {
      cachedFlows: Array.from(this.cache.keys()),
      inflightFlows: Array.from(this.inflightRequests.keys()),
    };
  }

  private async fetchToken(flow: TradingFlowType): Promise<string> {
    // Deduplicate concurrent requests for the same flow
    const inflight = this.inflightRequests.get(flow);
    if (inflight) {
      this.logger.debug("Deduplicating JWT fetch", { flow });
      return inflight;
    }

    const request = this.doFetch(flow);
    this.inflightRequests.set(flow, request);

    try {
      return await request;
    } finally {
      this.inflightRequests.delete(flow);
    }
  }

  private async doFetch(flow: TradingFlowType): Promise<string> {
    const provider = this.flowOverrides?.[flow]?.jwtProvider ?? this.provider;

    const fetchFn = async (): Promise<string> => {
      this.logger.info("Fetching JWT", { flow, usingFlowOverride: provider !== this.provider });
      const token = await provider.getJWT(flow);
      const decoded = this.decodeExpiry(token);

      this.cache.set(flow, {
        token,
        expiresAt: decoded,
        fetchedAt: Date.now(),
      });

      this.telemetry.track("JWT_REFRESHED", flow);
      return token;
    };

    try {
      return this.circuitBreaker
        ? await this.circuitBreaker.execute(fetchFn)
        : await fetchFn();
    } catch (error: unknown) {
      if (error instanceof ZeroHashError) throw error;

      this.telemetry.track("JWT_FAILED", flow, {
        error: error instanceof Error ? error.message : "unknown",
      });

      throw new ZeroHashError(
        ErrorCode.JWT_FETCH_FAILED,
        `Failed to fetch JWT for flow ${flow}`,
        { flow, originalError: error }
      );
    }
  }

  private isExpired(cached: CachedToken): boolean {
    return Date.now() >= cached.expiresAt;
  }

  private isExpiringSoon(cached: CachedToken): boolean {
    return Date.now() >= cached.expiresAt - PREEMPTIVE_REFRESH_MS;
  }

  private decodeExpiry(token: string): number {
    const DEFAULT_TTL = Date.now() + 5 * 60 * 1000;

    try {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[1]) {
        return DEFAULT_TTL;
      }

      // JWTs use URL-safe base64 (RFC 7518): - → +, _ → /, add padding
      const urlUnsafe = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = urlUnsafe + "=".repeat((4 - (urlUnsafe.length % 4)) % 4);
      const decoded = atob(padded);

      const payload = JSON.parse(decoded) as { exp?: number };
      if (typeof payload.exp === "number") {
        return payload.exp * 1000;
      }

      return DEFAULT_TTL;
    } catch {
      this.logger.warn("Could not decode JWT expiry, using default TTL");
      return DEFAULT_TTL;
    }
  }
}
