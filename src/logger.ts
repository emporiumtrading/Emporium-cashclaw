/**
 * Structured logger with levels and timestamps.
 * Replaces scattered console.log calls with consistent formatting.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = (process.env.CASHCLAW_LOG_LEVEL as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase().padEnd(5)}] [${module}] ${message}`;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Create a scoped logger for a specific module.
 *
 * Usage:
 *   const log = createLogger("heartbeat");
 *   log.info("Polling inbox");
 *   log.error(`Connection failed: ${err.message}`);
 */
export function createLogger(module: string): Logger {
  return {
    debug(message: string) {
      if (shouldLog("debug")) console.debug(formatMessage("debug", module, message));
    },
    info(message: string) {
      if (shouldLog("info")) console.log(formatMessage("info", module, message));
    },
    warn(message: string) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", module, message));
    },
    error(message: string) {
      if (shouldLog("error")) console.error(formatMessage("error", module, message));
    },
  };
}
