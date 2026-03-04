/**
 * Node.js JWT Server Example
 *
 * Demonstrates a minimal Express server that issues JWTs for ZeroHash flows.
 * In production, you would integrate with ZeroHash's participant API to generate
 * real JWTs. This example shows the pattern and security considerations.
 *
 * Prerequisites:
 *   - npm install express jsonwebtoken
 *   - npm install -D @types/express @types/jsonwebtoken
 */

import express, { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

// ── Configuration ───────────────────────────────────────────────────────────
// In production: load from secure vault / environment variables

const PORT = process.env["PORT"] ?? 3001;
const JWT_SECRET = process.env["ZH_JWT_SECRET"] ?? "";
const JWT_ISSUER = process.env["ZH_JWT_ISSUER"] ?? "your-partner-id";
const JWT_AUDIENCE = "zerohash";
const JWT_EXPIRY_SECONDS = 300; // 5 minutes

if (!JWT_SECRET) {
  console.error("FATAL: ZH_JWT_SECRET environment variable is required");
  process.exit(1);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface JWTRequestBody {
  flow: string;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
}

const ALLOWED_FLOWS = new Set([
  "ONBOARDING",
  "CRYPTO_BUY",
  "CRYPTO_SELL",
  "FIAT_DEPOSIT",
  "FIAT_WITHDRAWAL",
  "CRYPTO_WITHDRAWAL",
]);

// ── Middleware ───────────────────────────────────────────────────────────────

function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  // Replace with your actual authentication logic (session, bearer token, etc.)
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    next(new Error("Unauthorized"));
    return;
  }

  // Validate your own auth token here
  req.userId = "user-123"; // Replace with real user lookup
  next();
}

function rateLimiter() {
  const requests = new Map<string, { count: number; resetAt: number }>();
  const MAX_REQUESTS = 10;
  const WINDOW_MS = 60_000;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = req.userId ?? req.ip ?? "unknown";
    const now = Date.now();

    const entry = requests.get(key);
    if (!entry || now > entry.resetAt) {
      requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
      next();
      return;
    }

    if (entry.count >= MAX_REQUESTS) {
      res.status(429).json({ error: "Too many JWT requests. Try again later." });
      return;
    }

    entry.count++;
    next();
  };
}

// ── Application ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.post(
  "/api/zerohash/jwt",
  authMiddleware,
  rateLimiter(),
  (req: AuthenticatedRequest, res: Response): void => {
    const { flow } = req.body as JWTRequestBody;

    // Validate flow type
    if (!flow || !ALLOWED_FLOWS.has(flow)) {
      res.status(400).json({ error: `Invalid flow: ${flow}` });
      return;
    }

    // Build JWT claims
    const token = jwt.sign(
      {
        sub: req.userId,
        flow,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY_SECONDS }
    );

    res.json({
      token,
      expiresIn: JWT_EXPIRY_SECONDS,
    });
  }
);

// ── Health check ────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ── Error handler ───────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message === "Unauthorized") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.error("[JWT Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[JWT Server] Listening on port ${PORT}`);
  console.log(`[JWT Server] POST /api/zerohash/jwt`);
  console.log(`[JWT Server] GET  /health`);
});
