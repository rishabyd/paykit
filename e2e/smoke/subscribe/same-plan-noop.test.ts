import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  type TestPayKit,
  waitForWebhook,
} from "../setup";

describe("same-plan-noop: pro → pro", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM(t, {
      id: "test_noop",
      email: "noop@test.com",
      name: "Noop Test",
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro
    const b1 = new Date();
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
    await waitForWebhook(t.pool, "subscription.updated", { after: b1 });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("subscribing to the current plan with no pending changes is a noop", async () => {
    try {
      // Snapshot current state
      const before = await t.pool.query(
        `SELECT cp.id, cp.updated_at FROM paykit_customer_product cp
         JOIN paykit_product p ON p.internal_id = cp.product_internal_id
         WHERE cp.customer_id = $1 AND p.id = 'pro' AND cp.status = 'active'`,
        [customerId],
      );
      const beforeRow = before.rows[0] as { id: string; updated_at: string };
      expect(beforeRow).toBeDefined();

      const invoicesBefore = await t.pool.query(
        "SELECT count(*)::int as count FROM paykit_invoice WHERE customer_id = $1",
        [customerId],
      );
      const invoiceCountBefore = (invoicesBefore.rows[0] as { count: number }).count;

      // Action: subscribe to same plan
      await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      // Same product ID (no new row created)
      const after = await t.pool.query(
        `SELECT cp.id, cp.updated_at FROM paykit_customer_product cp
         JOIN paykit_product p ON p.internal_id = cp.product_internal_id
         WHERE cp.customer_id = $1 AND p.id = 'pro' AND cp.status = 'active'`,
        [customerId],
      );
      const afterRow = after.rows[0] as { id: string; updated_at: string };
      expect(afterRow.id).toBe(beforeRow.id);

      // No new invoices
      const invoicesAfter = await t.pool.query(
        "SELECT count(*)::int as count FROM paykit_invoice WHERE customer_id = $1",
        [customerId],
      );
      const invoiceCountAfter = (invoicesAfter.rows[0] as { count: number }).count;
      expect(invoiceCountAfter).toBe(invoiceCountBefore);
    } catch (error) {
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  });
});
