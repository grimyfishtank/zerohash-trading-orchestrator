import { describe, it, expect, vi } from "vitest";
import { SlippageGuard, type SlippageConfig, type FlowSlippageOverrides } from "../client/SlippageGuard";
import { createMockLogger } from "./helpers";
import { ZeroHashError } from "../errors/ZeroHashError";

describe("SlippageGuard", () => {
  const logger = createMockLogger();

  function createGuard(
    config?: Partial<SlippageConfig>,
    overrides?: FlowSlippageOverrides
  ) {
    return new SlippageGuard(config, overrides, logger);
  }

  it("returns null when slippage is within tolerance", () => {
    const guard = createGuard();
    const result = guard.evaluate("CRYPTO_BUY", 100, 101);
    expect(result).toBeNull();
  });

  it("returns SlippageEvent when slippage exceeds tolerance", () => {
    const guard = createGuard();
    const result = guard.evaluate("CRYPTO_BUY", 100, 103);
    expect(result).not.toBeNull();
    expect(result!.flow).toBe("CRYPTO_BUY");
    expect(result!.expectedPrice).toBe(100);
    expect(result!.actualPrice).toBe(103);
  });

  it("throws ZeroHashError with SLIPPAGE_EXCEEDED when action is block", () => {
    const guard = createGuard({ action: "block" });
    expect(() => guard.evaluate("CRYPTO_BUY", 100, 103)).toThrowError(
      ZeroHashError
    );
    try {
      guard.evaluate("CRYPTO_BUY", 100, 103);
    } catch (e) {
      expect((e as ZeroHashError).code).toBe("SLIPPAGE_EXCEEDED");
    }
  });

  it("returns event when action is prompt", () => {
    const guard = createGuard({ action: "prompt" });
    const result = guard.evaluate("CRYPTO_BUY", 100, 103);
    expect(result).not.toBeNull();
    expect(result!.flow).toBe("CRYPTO_BUY");
  });

  it("uses per-flow overrides", () => {
    const guard = createGuard(undefined, {
      CRYPTO_BUY: { maxTolerancePercent: 0.01 },
    });
    // 1.5% slippage — within default 2% but exceeds 1% override
    const result = guard.evaluate("CRYPTO_BUY", 100, 101.5);
    expect(result).not.toBeNull();
  });

  it("calls onSlippageDetected callback", () => {
    const callback = vi.fn();
    const guard = createGuard({ onSlippageDetected: callback });
    guard.evaluate("CRYPTO_BUY", 100, 103);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ flow: "CRYPTO_BUY" })
    );
  });

  it("swallows callback errors", () => {
    const callback = vi.fn(() => {
      throw new Error("callback boom");
    });
    const guard = createGuard({ onSlippageDetected: callback });
    // Should not throw even though callback throws
    const result = guard.evaluate("CRYPTO_BUY", 100, 103);
    expect(result).not.toBeNull();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("returns null for invalid prices", () => {
    const guard = createGuard();
    expect(guard.evaluate("CRYPTO_BUY", 0, 100)).toBeNull();
    expect(guard.evaluate("CRYPTO_BUY", 100, -1)).toBeNull();
  });
});
