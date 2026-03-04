# ZeroHash Trading Orchestrator

Production-ready TypeScript orchestration layer for integrating the ZeroHash Web SDK (`zh-web-sdk`) in embedded trading and on/off-ramp environments.

## Overview

The ZeroHash Web SDK provides UI flows for:

- Onboarding
- Crypto Buy
- Crypto Sell
- Crypto Withdrawals
- Fiat Deposits
- Fiat Withdrawals

While the SDK makes launching these flows straightforward, production implementations in fintech and embedded trading environments typically require additional lifecycle management, guardrails, and observability.

This project provides a structured orchestration layer that sits on top of the ZeroHash SDK to support production-grade integrations.

**It does not replace the SDK.**
It reduces integration entropy around it.

## Why This Exists

In real-world embedded finance environments, teams must manage:

- JWT lifecycle and refresh timing
- Modal state conflicts
- Retry handling and failure recovery
- Analytics instrumentation and funnel tracking
- Environment configuration (cert vs prod)
- Version compatibility safeguards
- Structured error propagation

Without coordination, these responsibilities get scattered across components and product surfaces.

This wrapper centralizes those concerns into a typed, observable orchestration client.

## What Problem It Solves

The ZeroHash SDK handles UI flows effectively.

However, in production environments:

- JWT expiration can interrupt conversion flows
- Multiple modals can conflict or overlap
- Errors may not propagate consistently
- Funnel metrics are difficult to instrument cleanly
- Integration logic becomes fragmented across teams

This project abstracts that operational complexity into a single lifecycle-managed client that enforces consistency and reliability.

## Core Responsibilities

The orchestration layer provides:

- Centralized JWT management
- Single-flow modal enforcement
- Typed flow configuration
- Structured error handling
- Event emission for analytics
- Environment isolation (cert / prod)
- Version-aware safety guards
- Extensible hooks for partner customization

## Design Principles

- **Security-first** — no client-side token assumptions
- **Observable by default** — meaningful lifecycle events emitted
- **Single-responsibility orchestration** — one flow at a time
- **Strict typing** — no implicit `any`, fully typed interfaces
- **Extensible by design** — ready for feature flags and experimentation
- **Production-safe defaults** — retries, guarded state transitions

## Architecture Philosophy

The goal was not to wrap methods for convenience.

The goal was to introduce structure.

As embedded trading platforms scale, integrations can become inconsistent across teams and surfaces. A thin orchestration layer:

- Protects against misuse
- Reduces partner implementation variance
- Improves reliability
- Creates leverage for product experimentation
- Improves conversion tracking

It's the difference between a demo integration and something you can confidently ship in a regulated fintech environment.

## Architecture

```
┌─────────────────────────────────────────────┐
│           ZeroHashTradingClient              │
│  ┌──────────┐ ┌────────────┐ ┌───────────┐  │
│  │JWTManager│ │ModalManager│ │VersionGuard│ │
│  └────┬─────┘ └─────┬──────┘ └───────────┘  │
│       │              │                        │
│  ┌────┴────────┐ ┌───┴──────┐ ┌───────────┐  │
│  │ Conversion  │ │ Slippage │ │   Rate    │  │
│  │  Tracker    │ │  Guard   │ │  Limiter  │  │
│  └─────────────┘ └──────────┘ └───────────┘  │
│       │              │                        │
│  ┌────┴──────────────┴────────────────────┐  │
│  │         EventBus / Telemetry           │  │
│  └────────────────────────────────────────┘  │
│       │              │                        │
│  ┌────┴─────┐  ┌─────┴──────┐                │
│  │  retry   │  │   logger   │                │
│  └──────────┘  └────────────┘                │
└──────────────────┬──────────────────────────┘
                   │
            ┌──────┴──────┐
            │  zh-web-sdk │
            └─────────────┘
```

### Folder Structure

```
src/
├── client/
│   ├── ZeroHashTradingClient.ts   # Primary consumer interface
│   ├── ModalManager.ts            # Single-modal state machine
│   ├── JWTManager.ts              # Token lifecycle + caching
│   ├── VersionGuard.ts            # Semantic version validation
│   ├── ConversionTracker.ts       # Funnel analytics engine
│   ├── SlippageGuard.ts           # Price deviation protection
│   ├── RateLimiter.ts             # Sliding window rate control
│   └── types.ts                   # All type definitions
├── telemetry/
│   ├── EventBus.ts                # Typed pub/sub event system
│   └── TelemetryHooks.ts         # Event payloads + integrator hooks
├── errors/
│   ├── ZeroHashError.ts           # Structured error class
│   └── ErrorCodes.ts              # Exhaustive error code enum
├── utils/
│   ├── retry.ts                   # Configurable retry with backoff
│   └── logger.ts                  # Leveled logger factory
└── index.ts                       # Barrel exports
```

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/grimyfishtank/zerohash-trading-orchestrator.git
cd zerohash-trading-orchestrator
npm install
npm run build
```

Then reference it from your project via a relative path, workspace link, or `npm link`:

```bash
# From your consuming project
npm link ../zerohash-trading-orchestrator
```

`zh-web-sdk` is a **peer dependency** — it must be installed by the consuming application.

## Quick Start

```typescript
import {
  ZeroHashTradingClient,
  type JWTProvider,
} from "@zerohash/trading-orchestrator";

const jwtProvider: JWTProvider = {
  async getJWT(flow) {
    const res = await fetch("/api/zerohash/jwt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow }),
    });
    const data = await res.json();
    return data.token;
  },
};

const client = new ZeroHashTradingClient({
  zeroHashAppsURL: "https://apps.zerohash.com",
  environment: "cert",
  jwtProvider,
});

await client.initialize();
await client.openFlow("CRYPTO_BUY");
```

## Configuration

```typescript
const client = new ZeroHashTradingClient({
  // Required
  zeroHashAppsURL: "https://apps.zerohash.com",
  environment: "prod",
  jwtProvider: myJWTProvider,

  // Telemetry — forward events to your analytics stack
  telemetry: {
    onEvent: (payload) => analytics.track(payload.event, payload),
    enrichMetadata: () => ({ sessionId: getSessionId() }),
  },

  // Retry behavior
  retry: {
    enabled: true,
    maxRetries: 3,
    backoffStrategy: "exponential",
    baseDelayMs: 500,
  },

  // SDK version enforcement
  versionConstraint: {
    minVersion: "1.0.0",
    maxVersion: "2.0.0",
  },

  // Feature flags
  featureFlags: {
    enableRetry: true,
    enableVersionCheck: true,
    enableTelemetry: true,
    enableConversionTracking: true,
    enableSlippageGuard: true,
    enableRateLimiting: true,
  },

  // Partner metadata injected into every modal
  partnerMetadata: {
    partnerId: "acme-corp",
    platform: "web",
  },

  // Per-flow configuration overrides
  flowOverrides: {
    CRYPTO_BUY: {
      metadata: { campaign: "summer-promo" },
    },
  },

  // Conversion tracking hooks
  conversion: {
    onStepCompleted: (event) => analytics.track("conversion_step", event),
    onFunnelCompleted: (flow, durationMs) =>
      analytics.track("conversion_complete", { flow, durationMs }),
    onFunnelAbandoned: (flow, lastStep, durationMs) =>
      analytics.track("conversion_abandoned", { flow, lastStep, durationMs }),
  },

  // Slippage protection (opt-in via featureFlags.enableSlippageGuard)
  slippage: {
    maxTolerancePercent: 0.02, // 2%
    action: "warn", // "warn" | "block" | "prompt"
    onSlippageDetected: (event) => console.warn("Slippage:", event),
  },

  // Per-flow slippage overrides
  slippageOverrides: {
    CRYPTO_BUY: { maxTolerancePercent: 0.01 }, // Tighter for buys
  },

  // Client-side rate limiting (opt-in via featureFlags.enableRateLimiting)
  rateLimit: {
    maxOperations: 5,
    windowMs: 60_000,
    strategy: "reject", // "reject" | "queue"
  },

  logLevel: "info",
});
```

## Event System

Subscribe to lifecycle events for observability:

```typescript
// Subscribe
const unsubscribe = client.on("FLOW_OPENED", (payload) => {
  console.log("Flow opened:", payload);
});

// Available events: FLOW_OPENED, FLOW_CLOSED, JWT_REFRESHED, ERROR

// Unsubscribe when done
unsubscribe();
```

The telemetry system emits fine-grained internal events (`RETRY_ATTEMPT`, `VERSION_MISMATCH`, `MODAL_CONFLICT_DETECTED`, etc.) via the `telemetry.onEvent` callback.

## Conversion Tracking

The orchestrator includes a built-in conversion funnel engine. It automatically tracks `FLOW_INITIATED`, `JWT_ACQUIRED`, and `MODAL_DISPLAYED` steps. You can record additional steps and mark completion:

```typescript
// Record user interaction or transaction progress
client.recordConversionStep("CRYPTO_BUY", "USER_INTERACTED", {
  asset: "BTC",
  amount: 500,
});

client.recordConversionStep("CRYPTO_BUY", "TRANSACTION_SUBMITTED");
client.recordConversionStep("CRYPTO_BUY", "TRANSACTION_CONFIRMED");

// Mark the funnel as successfully completed
client.completeConversion("CRYPTO_BUY");
```

When a flow is closed via `closeFlow()`, the funnel is automatically marked as abandoned. All steps emit telemetry events (`CONVERSION_STEP`, `CONVERSION_COMPLETED`, `CONVERSION_ABANDONED`) for downstream analytics.

## Slippage Protection

Enable slippage guards to protect users from adverse price movements between quote and execution:

```typescript
const event = client.evaluateSlippage("CRYPTO_BUY", 42_000, 42_900);

if (event) {
  // Slippage exceeded tolerance
  console.log(`${(event.slippagePercent * 100).toFixed(2)}% slippage`);
}
```

Actions:
- `"warn"` — returns the `SlippageEvent` for the caller to handle
- `"block"` — throws `ZeroHashError` with code `SLIPPAGE_EXCEEDED`
- `"prompt"` — returns the event (caller should show a confirmation UI)

Per-flow overrides allow tighter tolerances on specific flows via `slippageOverrides`.

## Rate Limiting

Client-side rate limiting protects against accidental rapid-fire operations (e.g. double-clicks, retry storms):

```typescript
const client = new ZeroHashTradingClient({
  // ...
  featureFlags: { enableRateLimiting: true },
  rateLimit: {
    maxOperations: 5,
    windowMs: 60_000,
    strategy: "reject", // or "queue" to defer excess operations
  },
});
```

When `strategy` is `"reject"`, exceeding the limit throws `ZeroHashError` with code `RATE_LIMITED`. When `"queue"`, excess operations are deferred until a slot opens in the sliding window.

## Error Model

All errors are instances of `ZeroHashError` with a typed `code`:

```typescript
import { ZeroHashError, ErrorCode } from "@zerohash/trading-orchestrator";

try {
  await client.openFlow("CRYPTO_BUY");
} catch (error) {
  if (error instanceof ZeroHashError) {
    switch (error.code) {
      case ErrorCode.JWT_FETCH_FAILED:
        // Handle token failure
        break;
      case ErrorCode.MODAL_CONFLICT:
        // Another modal is already open
        break;
      case ErrorCode.SDK_NOT_INITIALIZED:
        // Client not initialized
        break;
    }
  }
}
```

### Error Codes

| Code | Description |
|---|---|
| `JWT_EXPIRED` | Token has expired |
| `JWT_FETCH_FAILED` | JWTProvider threw or returned an invalid token |
| `MODAL_CONFLICT` | Attempted to open a modal while one is already active |
| `MODAL_CLOSE_FAILED` | Modal close operation failed |
| `SDK_NOT_INITIALIZED` | `initialize()` was not called before use |
| `VERSION_INCOMPATIBLE` | SDK version outside allowed range |
| `NETWORK_ERROR` | Network-level failure |
| `FLOW_NOT_ACTIVE` | Attempted to close a flow that is not the active flow |
| `INITIALIZATION_FAILED` | SDK initialization threw an error |
| `RETRY_EXHAUSTED` | All retry attempts failed |
| `RATE_LIMITED` | Client-side rate limit exceeded |
| `SLIPPAGE_EXCEEDED` | Price slippage beyond configured tolerance |

## Security Considerations

- **JWTs must be issued server-side.** Never expose signing secrets to the browser. See `examples/NodeJWTServerExample.ts`.
- **Short-lived tokens.** The orchestrator supports preemptive refresh — issue tokens with a 5-minute expiry and let the JWTManager handle rotation.
- **Rate limit JWT endpoints.** The example server includes a per-user rate limiter.
- **Validate flow types server-side.** Only issue tokens for flows the user is authorized to access.
- **Use `cert` environment** for all non-production deployments.

## Testability

The client accepts a `ZeroHashSDKFactory` as a second constructor parameter, allowing full SDK substitution in tests:

```typescript
const mockSDK: ZeroHashSDKInstance = {
  async init() {},
  async openModal() {},
  async closeModal() {},
  isModalOpen: () => false,
  version: "1.2.0",
};

const client = new ZeroHashTradingClient(config, () => mockSDK);
```

## Versioning Strategy

This package follows [Semantic Versioning](https://semver.org/):

- **Major** — breaking changes to `TradingClientConfig` or public API
- **Minor** — new flows, events, or configuration options
- **Patch** — bug fixes, retry logic improvements, internal refactors

The `VersionGuard` enforces compatibility with the underlying `zh-web-sdk` at initialization time to prevent runtime surprises.

## Who This Is For

This project may be useful for:

- Fintech platforms embedding crypto trading
- Wallets integrating on/off-ramp providers
- Neobanks exploring embedded crypto
- Teams looking to improve SDK ergonomics
- Product managers designing scalable integration patterns

## Examples

- [`examples/ReactIntegrationExample.tsx`](examples/ReactIntegrationExample.tsx) — React hook + component with full lifecycle management
- [`examples/NodeJWTServerExample.ts`](examples/NodeJWTServerExample.ts) — Express JWT issuance server with rate limiting

## FAQ

### Is this a replacement for the ZeroHash SDK?

No.

It is an orchestration layer that coordinates how the SDK is used in production environments. It depends on the official ZeroHash Web SDK and does not redistribute it.

### Why build this instead of using the SDK directly?

The SDK handles UI flows.

This layer handles lifecycle, observability, guardrails, and integration reliability. It centralizes operational complexity so application code stays clean and predictable.

### Why TypeScript?

Embedded trading integrations benefit from strict typing:

- Safer flow configuration
- Stronger JWT handling contracts
- Clear modal state definitions
- Reduced integration ambiguity across teams

Type safety becomes increasingly valuable as more flows and edge cases are introduced.

### What makes this "production-ready"?

- JWT lifecycle coordination
- Single-modal enforcement
- Structured error surface
- Analytics event emission
- Version-aware safety boundaries
- Extensible architecture for future flow expansion

## License

MIT

## Disclaimer

This project is an independent orchestration layer built on top of the ZeroHash Web SDK.

ZeroHash and the ZeroHash Web SDK are the property of ZeroHash Holdings Ltd. This repository does not include or redistribute the ZeroHash SDK.
