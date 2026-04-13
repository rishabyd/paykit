import path from "node:path";

import * as p from "@clack/prompts";
import { Command } from "commander";
import { Pool } from "pg";
import picocolors from "picocolors";

import { createContext } from "../../core/context";
import { getPendingMigrationCount } from "../../database/index";
import { dryRunSyncProducts } from "../../product/product-sync.service";
import { formatPlanLine, formatPrice, getConnectionString } from "../utils/format";
import { getPayKitConfig } from "../utils/get-config";
import { capture } from "../utils/telemetry";

async function statusAction(options: { config?: string; cwd: string }): Promise<void> {
  const cwd = path.resolve(options.cwd);

  p.intro("paykit status");

  // Config section
  let config;
  try {
    config = await getPayKitConfig({ configPath: options.config, cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`Config\n  ${picocolors.red("✖")} ${message}`);
    p.outro("Fix config issues before continuing");
    process.exit(1);
  }

  const planCount = config.options.plans ? Object.values(config.options.plans).length : 0;
  const hasProvider = Boolean(config.options.provider);

  p.log.info(
    `Config\n` +
      `  ${picocolors.green("✔")} ${picocolors.dim(config.path)}\n` +
      `  ${picocolors.green("✔")} ${String(planCount)} product${planCount === 1 ? "" : "s"} defined\n` +
      `  ${hasProvider ? picocolors.green("✔") : picocolors.red("✖")} ${hasProvider ? "Provider configured" : "No provider configured"}`,
  );

  if (!hasProvider) {
    p.outro("Fix config issues before continuing");
    process.exit(1);
  }

  // Database section
  const database =
    typeof config.options.database === "string"
      ? new Pool({ connectionString: config.options.database })
      : config.options.database;
  const connStr = getConnectionString(database as never);
  let pendingMigrations = 0;

  try {
    await database.query("SELECT 1");
    pendingMigrations = await getPendingMigrationCount(database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(`Database\n  ${picocolors.red("✖")} ${connStr}\n  ${message}`);
    p.outro("Fix database issues before continuing");
    await database.end();
    process.exit(1);
  }

  const migrationStatus =
    pendingMigrations > 0
      ? `${picocolors.red("✖")} Schema needs migration`
      : `${picocolors.green("✔")} Schema up to date`;

  p.log.info(`Database\n  ${picocolors.green("✔")} ${connStr}\n  ${migrationStatus}`);

  p.log.info(
    `Provider\n` +
      `  ${picocolors.green("✔")} ${config.options.provider.name} (${config.options.provider.id})`,
  );

  // Products section — skip when migrations are pending (tables may not exist)
  if (pendingMigrations > 0) {
    p.log.info(
      `Products\n  ${picocolors.dim("?")} Cannot check sync status until migrations are applied`,
    );
  } else {
    const ctx = await createContext(config.options);
    const diffs = await dryRunSyncProducts(ctx);

    if (diffs.length === 0) {
      p.log.info(`Products\n  ${picocolors.dim("No products defined")}`);
    } else {
      const allSynced = diffs.every((d) => d.action === "unchanged");
      const header = allSynced
        ? `${picocolors.green("✔")} All synced`
        : `${picocolors.red("✖")} Not synced (run ${picocolors.bold("paykitjs push")})`;

      const planLines = diffs.map((diff) => {
        const plan = ctx.plans.plans.find((pl) => pl.id === diff.id);
        const price = plan ? formatPrice(plan.priceAmount ?? 0, plan.priceInterval) : "$0";
        return formatPlanLine(diff.action, diff.id, price);
      });

      p.log.info(`Products\n  ${header}\n${planLines.join("\n")}`);
    }
  }

  capture("cli_command", {
    command: "status",
    needsMigration: pendingMigrations > 0,
  });

  // Final
  if (pendingMigrations > 0) {
    p.outro(`Run ${picocolors.bold("paykitjs push")} to apply migrations and sync plans`);
  } else {
    p.outro("Everything looks good");
  }

  await database.end();
}

export const statusCommand = new Command("status")
  .description("Check PayKit configuration and sync status")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd(),
  )
  .option("--config <config>", "the path to the PayKit configuration file to load.")
  .action(statusAction);
