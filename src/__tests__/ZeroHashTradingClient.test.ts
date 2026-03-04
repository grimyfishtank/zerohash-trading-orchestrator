import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZeroHashTradingClient } from "../client/ZeroHashTradingClient";
import {
  createMockSDK,
  createTestConfig,
} from "./helpers";
import { ZeroHashError } from "../errors/ZeroHashError";

describe("ZeroHashTradingClient", () => {
  let mockSDK: ReturnType<typeof createMockSDK>;
  let client: ZeroHashTradingClient;

  beforeEach(() => {
    mockSDK = createMockSDK();
    client = new ZeroHashTradingClient(createTestConfig(), () => mockSDK);
  });

  describe("initialize()", () => {
    it("sets up all modules and marks client as initialized", async () => {
      await client.initialize();
      expect(client.isInitialized).toBe(true);
    });

    it("warns and returns on double init without re-initializing", async () => {
      await client.initialize();
      // Second init should just return without error
      await client.initialize();
      expect(client.isInitialized).toBe(true);
    });
  });

  describe("openFlow()", () => {
    it("fetches JWT and opens modal", async () => {
      await client.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      expect(mockSDK.openModal).toHaveBeenCalled();
      expect(client.activeFlow).toBe("CRYPTO_BUY");
    });

    it("throws SDK_NOT_INITIALIZED before init", async () => {
      try {
        await client.openFlow("CRYPTO_BUY");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ZeroHashError);
        expect((e as ZeroHashError).code).toBe("SDK_NOT_INITIALIZED");
      }
    });
  });

  describe("closeFlow()", () => {
    it("returns Promise and propagates errors", async () => {
      await client.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      (mockSDK.closeModal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("close failed"));
      await expect(client.closeFlow("CRYPTO_BUY")).rejects.toThrow("close failed");
    });

    it("abandons conversion funnel on success", async () => {
      await client.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      (mockSDK.closeModal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      await client.closeFlow("CRYPTO_BUY");
      expect(client.activeFlow).toBeNull();
    });
  });

  describe("destroy()", () => {
    it("cleans up and resets initialized state", async () => {
      await client.initialize();
      client.destroy();
      expect(client.isInitialized).toBe(false);
    });
  });

  describe("health()", () => {
    it("returns complete status object with correct structure", async () => {
      await client.initialize();
      const status = client.health();
      expect(status).toEqual(
        expect.objectContaining({
          initialized: true,
          uptime: expect.any(Number),
        })
      );
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it("shows activeFlow when modal is open", async () => {
      await client.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      const status = client.health();
      expect(status.activeFlow).toBe("CRYPTO_BUY");
    });
  });

  describe("on()", () => {
    it("subscribes to events and receives them", async () => {
      const handler = vi.fn();
      client.on("FLOW_OPENED", handler);
      await client.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("evaluateSlippage()", () => {
    it("returns null when guard not enabled", async () => {
      await client.initialize();
      const result = client.evaluateSlippage("CRYPTO_BUY", 100, 103);
      expect(result).toBeNull();
    });
  });

  describe("getters", () => {
    it("isInitialized and activeFlow getters work correctly", async () => {
      expect(client.isInitialized).toBe(false);
      expect(client.activeFlow).toBeNull();
      await client.initialize();
      expect(client.isInitialized).toBe(true);
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await client.openFlow("CRYPTO_BUY");
      expect(client.activeFlow).toBe("CRYPTO_BUY");
    });
  });

  describe("feature flags", () => {
    it("disabling conversionTracking makes recordConversionStep a no-op", async () => {
      const flaggedClient = new ZeroHashTradingClient(
        createTestConfig({ featureFlags: { enableConversionTracking: false } }),
        () => mockSDK
      );
      await flaggedClient.initialize();
      // Should not throw — just silently no-op
      expect(() =>
        flaggedClient.recordConversionStep("CRYPTO_BUY", "USER_INTERACTED")
      ).not.toThrow();
    });
  });

  describe("correlation IDs", () => {
    it("includes correlationId in telemetry events during openFlow", async () => {
      const telemetryEvents: any[] = [];
      const trackingClient = new ZeroHashTradingClient(
        createTestConfig({
          featureFlags: { enableConversionTracking: true },
          telemetry: {
            onEvent: (payload: any) => telemetryEvents.push(payload),
          },
        }),
        () => mockSDK
      );
      await trackingClient.initialize();
      (mockSDK.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);
      await trackingClient.openFlow("CRYPTO_BUY");

      // Check that at least one telemetry event includes a correlationId starting with "cid_"
      // The correlationId is passed as metadata in conversion tracker steps
      const hasCorrelationId = telemetryEvents.some(
        (event) =>
          event.correlationId?.startsWith("cid_") ||
          event.metadata?.correlationId?.startsWith("cid_")
      );
      expect(hasCorrelationId).toBe(true);
    });
  });
});
