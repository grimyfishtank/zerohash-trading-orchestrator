import { ErrorCode } from "./ErrorCodes";

export interface ErrorContext {
  flow?: string;
  attempt?: number;
  originalError?: unknown;
  [key: string]: unknown;
}

export class ZeroHashError extends Error {
  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly timestamp: number;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
    super(message);
    this.name = "ZeroHashError";
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
    };
  }

  static fromUnknown(error: unknown, code: ErrorCode): ZeroHashError {
    if (error instanceof ZeroHashError) {
      return error;
    }

    const message =
      error instanceof Error ? error.message : "An unknown error occurred";

    return new ZeroHashError(code, message, { originalError: error });
  }
}
