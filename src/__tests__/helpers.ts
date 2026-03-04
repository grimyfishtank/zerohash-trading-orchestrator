import { vi } from "vitest";
import type { TelemetryEmitter } from "../telemetry/TelemetryHooks";
import type { Logger } from "../utils/logger";
import type { JWTProvider, TradingClientConfig, TradingFlowType, ZeroHashSDKInstance } from "../client/types";

export function createMockSDK(overrides?: Partial<ZeroHashSDKInstance>): ZeroHashSDKInstance {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    openModal: vi.fn().mockResolvedValue(undefined),
    closeModal: vi.fn().mockResolvedValue(undefined),
    isModalOpen: vi.fn().mockReturnValue(false),
    version: "1.2.0",
    ...overrides,
  };
}

export function createMockJWTProvider(token?: string): JWTProvider {
  const jwt = token ?? createTestJWT(Math.floor(Date.now() / 1000) + 300);
  return {
    getJWT: vi.fn().mockResolvedValue(jwt),
  };
}

export function createMockTelemetry(): TelemetryEmitter & { track: ReturnType<typeof vi.fn> } {
  return {
    track: vi.fn(),
  };
}

export function createMockLogger(): Logger & { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Creates a real JWT string with a configurable exp claim.
 * @param expUnixSeconds - the "exp" claim value (seconds since epoch)
 */
export function createTestJWT(expUnixSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub: "test-user", flow: "CRYPTO_BUY", exp: expUnixSeconds }));
  const signature = "test-signature";
  return `${header}.${payload}.${signature}`;
}

export function createTestConfig(overrides?: Partial<TradingClientConfig>) {
  return {
    zeroHashAppsURL: "https://apps.zerohash.com",
    environment: "cert" as const,
    jwtProvider: createMockJWTProvider(),
    ...overrides,
  };
}

export const FLOWS: TradingFlowType[] = [
  "ONBOARDING", "CRYPTO_BUY", "CRYPTO_SELL",
  "FIAT_DEPOSIT", "FIAT_WITHDRAWAL", "CRYPTO_WITHDRAWAL",
];

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
