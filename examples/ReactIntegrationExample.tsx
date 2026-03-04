/**
 * React Integration Example
 *
 * Demonstrates how to integrate ZeroHashTradingClient into a React application
 * with proper lifecycle management, JWT provider injection, and event listening.
 *
 * Prerequisites:
 *   - npm install @zerohash/trading-orchestrator zh-web-sdk react
 *   - A backend server that issues JWTs (see NodeJWTServerExample.ts)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ZeroHashTradingClient,
  type JWTProvider,
  type TradingClientConfig,
  type TradingEventPayload,
  type TradingFlowType,
} from "@zerohash/trading-orchestrator";

// ── JWT Provider ────────────────────────────────────────────────────────────
// Fetches JWTs from your backend. Never expose signing secrets to the client.

const jwtProvider: JWTProvider = {
  async getJWT(flow: TradingFlowType): Promise<string> {
    const response = await fetch("/api/zerohash/jwt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow }),
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`JWT fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as { token: string };
    return data.token;
  },
};

// ── Client Configuration ────────────────────────────────────────────────────

const clientConfig: TradingClientConfig = {
  zeroHashAppsURL: "https://apps.zerohash.com",
  environment: "cert",
  jwtProvider,
  telemetry: {
    onEvent(payload: TradingEventPayload) {
      // Forward to your analytics provider
      console.log("[Analytics]", payload.event, payload);
    },
  },
  retry: {
    enabled: true,
    maxRetries: 2,
    backoffStrategy: "exponential",
  },
  versionConstraint: {
    minVersion: "1.0.0",
  },
  partnerMetadata: {
    partnerId: "your-partner-id",
    platform: "web",
  },
};

// ── Custom Hook ─────────────────────────────────────────────────────────────

function useZeroHashTrading(config: TradingClientConfig) {
  const clientRef = useRef<ZeroHashTradingClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFlow, setActiveFlow] = useState<TradingFlowType | null>(null);

  useEffect(() => {
    const client = new ZeroHashTradingClient(config);
    clientRef.current = client;

    // Subscribe to events
    const unsubOpen = client.on("FLOW_OPENED", () => {
      setActiveFlow(client.activeFlow);
    });

    const unsubClose = client.on("FLOW_CLOSED", () => {
      setActiveFlow(null);
    });

    const unsubError = client.on("ERROR", (payload) => {
      const event = payload as TradingEventPayload;
      setError(event.metadata?.errorMessage as string);
    });

    // Initialize
    client
      .initialize()
      .then(() => setReady(true))
      .catch((err: Error) => setError(err.message));

    return () => {
      unsubOpen();
      unsubClose();
      unsubError();
      client.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFlow = useCallback(async (flow: TradingFlowType) => {
    setError(null);
    try {
      await clientRef.current?.openFlow(flow);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to open flow");
    }
  }, []);

  const closeFlow = useCallback((flow: TradingFlowType) => {
    clientRef.current?.closeFlow(flow);
  }, []);

  return { ready, error, activeFlow, openFlow, closeFlow };
}

// ── React Component ─────────────────────────────────────────────────────────

export default function TradingDashboard() {
  const { ready, error, activeFlow, openFlow, closeFlow } =
    useZeroHashTrading(clientConfig);

  if (!ready) {
    return <div>Initializing trading SDK...</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2>ZeroHash Trading</h2>

      {error && (
        <div
          role="alert"
          style={{ padding: 12, background: "#fee", border: "1px solid #c00", borderRadius: 4, marginBottom: 16 }}
        >
          {error}
        </div>
      )}

      {activeFlow && (
        <div style={{ marginBottom: 16 }}>
          <span>Active: {activeFlow}</span>
          <button onClick={() => closeFlow(activeFlow)} style={{ marginLeft: 8 }}>
            Close
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <FlowButton label="Buy Crypto" flow="CRYPTO_BUY" onOpen={openFlow} disabled={activeFlow !== null} />
        <FlowButton label="Sell Crypto" flow="CRYPTO_SELL" onOpen={openFlow} disabled={activeFlow !== null} />
        <FlowButton label="Deposit Fiat" flow="FIAT_DEPOSIT" onOpen={openFlow} disabled={activeFlow !== null} />
        <FlowButton label="Withdraw Fiat" flow="FIAT_WITHDRAWAL" onOpen={openFlow} disabled={activeFlow !== null} />
        <FlowButton label="Withdraw Crypto" flow="CRYPTO_WITHDRAWAL" onOpen={openFlow} disabled={activeFlow !== null} />
        <FlowButton label="Onboarding" flow="ONBOARDING" onOpen={openFlow} disabled={activeFlow !== null} />
      </div>
    </div>
  );
}

function FlowButton({
  label,
  flow,
  onOpen,
  disabled,
}: {
  label: string;
  flow: TradingFlowType;
  onOpen: (flow: TradingFlowType) => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={() => onOpen(flow)}
      disabled={disabled}
      style={{
        padding: "10px 20px",
        borderRadius: 6,
        border: "1px solid #ccc",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
