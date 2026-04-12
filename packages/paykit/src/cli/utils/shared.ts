import type { Pool } from "pg";
import type StripeSdk from "stripe";

import type { createContext, PayKitContext } from "../../core/context";
import type { getPendingMigrationCount, migrateDatabase } from "../../database/index";
import type { dryRunSyncProducts, syncProducts } from "../../product/product-sync.service";
import type { PayKitOptions } from "../../types/options";
import type { NormalizedPlan } from "../../types/schema";
import type { detectPackageManager, getInstallCommand, getRunCommand } from "./detect";
import type {
  formatPlanLine,
  formatPrice,
  getConnectionString,
  getStripeAccountInfo,
} from "./format";
import type { getPayKitConfig } from "./get-config";
import type { capture } from "./telemetry";

export interface CliDeps {
  Pool: typeof Pool;
  StripeSdk: typeof StripeSdk;
  createContext: typeof createContext;
  getPendingMigrationCount: typeof getPendingMigrationCount;
  migrateDatabase: typeof migrateDatabase;
  dryRunSyncProducts: typeof dryRunSyncProducts;
  syncProducts: typeof syncProducts;
  formatPlanLine: typeof formatPlanLine;
  formatPrice: typeof formatPrice;
  getConnectionString: typeof getConnectionString;
  getStripeAccountInfo: typeof getStripeAccountInfo;
  getPayKitConfig: typeof getPayKitConfig;
  capture: typeof capture;
  detectPackageManager: typeof detectPackageManager;
  getInstallCommand: typeof getInstallCommand;
  getRunCommand: typeof getRunCommand;
}

export async function loadCliDeps(): Promise<CliDeps> {
  const [pg, stripe, context, database, productSync, format, getConfig, telemetry, detect] =
    await Promise.all([
      import("pg"),
      import("stripe"),
      import("../../core/context"),
      import("../../database/index"),
      import("../../product/product-sync.service"),
      import("../utils/format"),
      import("../utils/get-config"),
      import("../utils/telemetry"),
      import("../utils/detect"),
    ]);

  return {
    Pool: pg.Pool,
    StripeSdk: stripe.default,
    createContext: context.createContext,
    getPendingMigrationCount: database.getPendingMigrationCount,
    migrateDatabase: database.migrateDatabase,
    dryRunSyncProducts: productSync.dryRunSyncProducts,
    syncProducts: productSync.syncProducts,
    formatPlanLine: format.formatPlanLine,
    formatPrice: format.formatPrice,
    getConnectionString: format.getConnectionString,
    getStripeAccountInfo: format.getStripeAccountInfo,
    getPayKitConfig: getConfig.getPayKitConfig,
    capture: telemetry.capture,
    detectPackageManager: detect.detectPackageManager,
    getInstallCommand: detect.getInstallCommand,
    getRunCommand: detect.getRunCommand,
  };
}

export interface LoadedConfig {
  path: string;
  options: PayKitOptions;
}

export function createPool(deps: Pick<CliDeps, "Pool">, database: Pool | string): Pool {
  return typeof database === "string" ? new deps.Pool({ connectionString: database }) : database;
}

export interface ProductDiff {
  action: "created" | "updated" | "unchanged";
  id: string;
}

export function formatProductDiffs(
  diffs: ProductDiff[],
  plans: readonly NormalizedPlan[],
  deps: Pick<CliDeps, "formatPlanLine" | "formatPrice">,
): string[] {
  const plansById = new Map(plans.map((pl) => [pl.id, pl]));
  return diffs.map((diff) => {
    const plan = plansById.get(diff.id);
    const price = plan ? deps.formatPrice(plan.priceAmount ?? 0, plan.priceInterval) : "$0";
    return deps.formatPlanLine(diff.action, diff.id, price);
  });
}

export async function checkDatabase(
  database: Pool,
  deps: Pick<CliDeps, "getPendingMigrationCount">,
): Promise<{ ok: true; pendingMigrations: number } | { ok: false; message: string }> {
  try {
    await database.query("SELECT 1");
    const count = await deps.getPendingMigrationCount(database);
    return { ok: true, pendingMigrations: count };
  } catch (error) {
    const err = error as { message?: string; code?: string };
    const message = err.message || err.code || "Connection failed";
    return { ok: false, message };
  }
}

export interface StripeCheckResult {
  account: { ok: true; displayName: string; mode: string } | { ok: false; message: string };
  webhooks: Array<{ url: string }> | null;
}

export async function checkStripe(
  deps: Pick<CliDeps, "StripeSdk">,
  secretKey: string,
): Promise<StripeCheckResult> {
  const client = new deps.StripeSdk(secretKey);
  const mode =
    secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")
      ? "test mode"
      : "live mode";

  const [account, webhooks] = await Promise.all([
    client.accounts
      .retrieve()
      .then((acc) => ({
        ok: true as const,
        displayName:
          acc.settings?.dashboard?.display_name ||
          acc.business_profile?.name ||
          acc.id ||
          "unknown",
        mode,
      }))
      .catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      })),
    client.webhookEndpoints
      .list({ limit: 100 })
      .then((endpoints) => endpoints.data.filter((ep) => ep.status === "enabled"))
      .catch(() => null),
  ]);

  return { account, webhooks };
}

export async function loadProductDiffs(
  config: LoadedConfig,
  deps: Pick<CliDeps, "createContext" | "dryRunSyncProducts">,
): Promise<{ ctx: PayKitContext; diffs: ProductDiff[] }> {
  const ctx = await deps.createContext(config.options);
  const diffs = await deps.dryRunSyncProducts(ctx);
  return { ctx, diffs };
}
