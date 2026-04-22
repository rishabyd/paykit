import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { invoice, product, subscription } from "../../../packages/paykit/src/database/schema";
import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectNoScheduledPlanInGroup,
  expectSingleActivePlanInGroup,
  subscribeCustomer,
  type TestPayKit,
} from "../setup";

describe("same-plan-noop: pro → pro", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_noop",
        email: "noop@test.com",
        name: "Noop Test",
      },
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro
    await subscribeCustomer({ t, customerId, planId: "pro" });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("subscribing to the current plan with no pending changes is a noop", async () => {
    try {
      // Snapshot current state
      const beforeRows = await t.database
        .select({ id: subscription.id, updatedAt: subscription.updatedAt })
        .from(subscription)
        .innerJoin(product, eq(product.internalId, subscription.productInternalId))
        .where(
          and(
            eq(subscription.customerId, customerId),
            eq(product.id, "pro"),
            eq(subscription.status, "active"),
          ),
        );
      const beforeRow = beforeRows[0];
      expect(beforeRow).toBeDefined();

      const invoicesBeforeRows = await t.database
        .select({ count: count() })
        .from(invoice)
        .where(eq(invoice.customerId, customerId));
      const invoiceCountBefore = invoicesBeforeRows[0]?.count ?? 0;

      // Action: subscribe to same plan
      await subscribeCustomer({ t, customerId, planId: "pro" });

      // Same product ID (no new row created)
      const afterRows = await t.database
        .select({ id: subscription.id, updatedAt: subscription.updatedAt })
        .from(subscription)
        .innerJoin(product, eq(product.internalId, subscription.productInternalId))
        .where(
          and(
            eq(subscription.customerId, customerId),
            eq(product.id, "pro"),
            eq(subscription.status, "active"),
          ),
        );
      const afterRow = afterRows[0];
      expect(afterRow!.id).toBe(beforeRow!.id);

      // No new invoices
      const invoicesAfterRows = await t.database
        .select({ count: count() })
        .from(invoice)
        .where(eq(invoice.customerId, customerId));
      const invoiceCountAfter = invoicesAfterRows[0]?.count ?? 0;
      expect(invoiceCountAfter).toBe(invoiceCountBefore);
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "pro",
      });
      await expectNoScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
      });
      await expectExactMeteredBalance({
        customerId,
        featureId: "messages",
        limit: 500,
        paykit: t.paykit,
        remaining: 500,
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
