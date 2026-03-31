import type { PayKitLogger } from "../types/options";
import { getTraceId } from "./trace";

const defaultConsoleLogger: PayKitLogger = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export function createPayKitLogger(userLogger?: PayKitLogger): PayKitLogger {
  const base = userLogger ?? defaultConsoleLogger;

  function prefix(): string {
    const traceId = getTraceId();
    return traceId ? `[${traceId}]` : "[paykit]";
  }

  return {
    debug(message, ...args) {
      base.debug(`${prefix()} ${message}`, ...args);
    },
    info(message, ...args) {
      base.info(`${prefix()} ${message}`, ...args);
    },
    warn(message, ...args) {
      base.warn(`${prefix()} ${message}`, ...args);
    },
    error(message, ...args) {
      base.error(`${prefix()} ${message}`, ...args);
    },
  };
}
