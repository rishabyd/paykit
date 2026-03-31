import { Pool } from "pg";

import { createDatabase, type PayKitDatabase } from "../database/index";
import type { StripeProviderConfig, StripeRuntime } from "../providers/provider";
import { createStripeRuntime } from "../providers/stripe";
import type { PayKitLogger, PayKitOptions } from "../types/options";
import { normalizeSchema, type NormalizedSchema } from "../types/schema";
import { createPayKitLogger } from "./logger";

export interface PayKitContext {
  options: PayKitOptions;
  database: PayKitDatabase;
  provider: StripeProviderConfig;
  stripe: StripeRuntime;
  plans: NormalizedSchema;
  logger: PayKitLogger;
}

export async function createContext(options: PayKitOptions): Promise<PayKitContext> {
  if (!options.provider) {
    throw new Error("A provider is required");
  }

  if (options.basePath && !options.basePath.startsWith("/")) {
    throw new Error(`basePath must start with "/", received "${options.basePath}"`);
  }

  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;
  const database = await createDatabase(pool);
  const stripe = options.provider.runtime ?? createStripeRuntime(options.provider);

  return {
    options,
    database,
    provider: options.provider,
    stripe,
    plans: normalizeSchema(options.plans),
    logger: createPayKitLogger(options.logger),
  };
}
