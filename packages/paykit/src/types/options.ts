import type { Pool } from "pg";

import type { PayKitProvider } from "../providers/provider";
import type { PayKitEventHandlers } from "./events";

export type ProviderId<TProviders extends readonly PayKitProvider[]> = TProviders[number]["id"];

export interface PayKitOptions<
  TProviders extends readonly PayKitProvider[] = readonly PayKitProvider[],
> {
  database: Pool;
  providers: TProviders;
  logger?: {
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  on?: PayKitEventHandlers;
}
