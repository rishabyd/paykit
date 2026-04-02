import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPayKitConfig } from "../../packages/paykit/src/cli/utils/get-config";
import { createContext } from "../../packages/paykit/src/core/context";
import {
  getPendingMigrationCount,
  migrateDatabase,
} from "../../packages/paykit/src/database/index";
import {
  dryRunSyncProducts,
  syncProducts,
} from "../../packages/paykit/src/services/product-sync-service";
import { createCliFixture, type CliTestFixture } from "./setup";

describe("paykitjs push", () => {
  let fixture: CliTestFixture;

  beforeAll(async () => {
    fixture = await createCliFixture("__paykit_cli_push");
  });

  afterAll(async () => {
    // Close any pool stored on globalThis by jiti
    const stored = (globalThis as Record<string, unknown>).__paykit_cli_push;
    if (stored && typeof stored === "object" && "end" in stored) {
      try {
        await (stored as { end: () => Promise<void> }).end();
      } catch {}
    }
    Reflect.deleteProperty(globalThis, "__paykit_cli_push");

    await fixture?.cleanup();
  });

  it("should apply migrations on a fresh database", async () => {
    const config = await getPayKitConfig({ cwd: fixture.cwd });
    try {
      const pending = await getPendingMigrationCount(config.options.database);
      expect(pending).toBeGreaterThan(0);

      await migrateDatabase(config.options.database);

      const pendingAfter = await getPendingMigrationCount(config.options.database);
      expect(pendingAfter).toBe(0);
    } finally {
      await config.options.database.end();
    }
  });

  it("should sync plans to the database and Stripe", async () => {
    const config = await getPayKitConfig({ cwd: fixture.cwd });
    try {
      const ctx = await createContext(config.options);
      const results = await syncProducts(ctx);

      // Should have synced 2 plans (free + pro)
      const synced = results.filter((r) => r.action !== "unchanged");
      expect(synced.length).toBe(2);

      // Verify plans exist in the database
      const pool = new pg.Pool({ connectionString: fixture.dbUrl });
      const dbResult = await pool.query(
        `SELECT id, name, "group", is_default FROM paykit_product ORDER BY id`,
      );
      expect(dbResult.rows).toEqual([
        { id: "free", name: "Free", group: "base", is_default: true },
        { id: "pro", name: "Pro", group: "base", is_default: false },
      ]);

      // Verify paid plan (pro) was synced to Stripe — free plans have no price
      // and are not synced to the provider
      const providerProducts = await pool.query(
        `SELECT pp.provider_product_id, p.id as plan_id FROM paykit_provider_product pp
         JOIN paykit_product p ON p.internal_id = pp.product_internal_id
         ORDER BY p.id`,
      );
      expect(providerProducts.rows.length).toBe(1);
      expect((providerProducts.rows[0] as { plan_id: string }).plan_id).toBe("pro");

      const stripeProduct = await fixture.stripeClient.products.retrieve(
        (providerProducts.rows[0] as { provider_product_id: string }).provider_product_id,
      );
      expect(stripeProduct.active).toBe(true);

      await pool.end();
    } finally {
      await config.options.database.end();
    }
  });

  it("should report nothing to do on second push", async () => {
    const config = await getPayKitConfig({ cwd: fixture.cwd });
    try {
      const ctx = await createContext(config.options);
      const diffs = await dryRunSyncProducts(ctx);

      const hasChanges = diffs.some((d) => d.action !== "unchanged");
      expect(hasChanges).toBe(false);
    } finally {
      await config.options.database.end();
    }
  });
});
