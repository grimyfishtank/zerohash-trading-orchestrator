export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(
  prefix: string,
  minLevel: LogLevel = "info"
): Logger {
  const shouldLog = (level: LogLevel): boolean =>
    LOG_PRIORITY[level] >= LOG_PRIORITY[minLevel];

  const format = (level: LogLevel, message: string): string =>
    `[${prefix}][${level.toUpperCase()}] ${message}`;

  return {
    debug(message, meta) {
      if (shouldLog("debug")) console.debug(format("debug", message), meta ?? "");
    },
    info(message, meta) {
      if (shouldLog("info")) console.info(format("info", message), meta ?? "");
    },
    warn(message, meta) {
      if (shouldLog("warn")) console.warn(format("warn", message), meta ?? "");
    },
    error(message, meta) {
      if (shouldLog("error")) console.error(format("error", message), meta ?? "");
    },
  };
}
