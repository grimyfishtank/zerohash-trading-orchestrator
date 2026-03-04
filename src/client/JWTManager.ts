import { ErrorCode } from "../errors/ErrorCodes";
import { ZeroHashError } from "../errors/ZeroHashError";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
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
    private readonly logger: Logger
  ) {}

  async getToken(flow: TradingFlowType): Promise<string> {
    const cached = this.cache.get(flow);

    if (cached && !this.isExpiringSoon(cached)) {
      this.logger.debug("Using cached JWT", { flow });
      return cached.token;
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
    try {
      this.logger.info("Fetching JWT", { flow });
      const token = await this.provider.getJWT(flow);
      const decoded = this.decodeExpiry(token);

      this.cache.set(flow, {
        token,
        expiresAt: decoded,
        fetchedAt: Date.now(),
      });

      this.telemetry.track("JWT_REFRESHED", flow);
      return token;
    } catch (error: unknown) {
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
