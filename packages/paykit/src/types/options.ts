import type { Pool } from "pg";

import type { StripeProviderConfig } from "../providers/provider";
import type { PayKitEventHandlers } from "./events";
import type { PayKitPlugin } from "./plugin";
import type { PayKitPlansModule } from "./schema";

export interface PayKitLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface PayKitOptions {
  database: Pool | string;
  provider: StripeProviderConfig;
  plans?: PayKitPlansModule;
  basePath?: string;
  identify?: (request: Request) => Promise<{
    customerId: string;
    email?: string;
    name?: string;
  }>;
  on?: PayKitEventHandlers;
  plugins?: PayKitPlugin[];
  logger?: PayKitLogger;
}
