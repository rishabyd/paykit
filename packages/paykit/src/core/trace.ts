import { AsyncLocalStorage } from "node:async_hooks";

import { generateId } from "./utils";

interface TraceContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(prefix: string, fn: () => T | Promise<T>): T | Promise<T> {
  const traceId = generateId(prefix, 12);
  return storage.run({ traceId }, fn);
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
