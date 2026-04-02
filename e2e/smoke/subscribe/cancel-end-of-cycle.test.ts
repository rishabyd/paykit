import { afterAll, beforeAll, describe, it } from "vitest";

import {
  advanceTestClock,
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  type TestPayKit,
  waitForWebhook,
} from "../setup";

describe("cancel-end-of-cycle: pro → free + clock advance", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM(t, {
      id: "test_cancel_eoc",
      email: "cancel-eoc@test.com",
      name: "Cancel EOC Test",
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro, then schedule downgrade to Free
    const b1 = new Date();
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
    await waitForWebhook(t.pool, "subscription.updated", { after: b1 });

    const b2 = new Date();
    await t.paykit.subscribe({
      customerId,
      planId: "free",
      successUrl: "https://example.com/success",
    });
    await waitForWebhook(t.pool, "subscription.updated", { after: b2 });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("advancing past period end activates the free plan", async () => {
    try {
      // Get period end to advance past
      const subResult = await t.pool.query(
        `SELECT s.current_period_end_at FROM paykit_subscription s
         JOIN paykit_customer_product cp ON cp.subscription_id = s.id
         WHERE cp.customer_id = $1
         ORDER BY s.updated_at DESC LIMIT 1`,
        [customerId],
      );
      const periodEnd = new Date(
        (subResult.rows[0] as { current_period_end_at: string }).current_period_end_at,
      );

      // Advance clock 1 day past period end
      const advanceTo = new Date(periodEnd.getTime() + 86_400_000);
      await advanceTestClock(t.stripeClient, t.testClockId, advanceTo.toISOString().split("T")[0]!);

      // Poll until Free is active (real subscription.deleted webhook)
      for (let i = 0; i < 60; i++) {
        const result = await t.pool.query(
          `SELECT cp.status FROM paykit_customer_product cp
           JOIN paykit_product p ON p.internal_id = cp.product_internal_id
           WHERE cp.customer_id = $1 AND p.id = 'free' AND cp.status = 'active'`,
          [customerId],
        );
        if (result.rows.length > 0) break;
        if (i === 59) throw new Error("Free plan never activated after clock advance");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Pro is canceled/ended
      await expectProduct(t.pool, customerId, "pro", { status: "canceled" });

      // Free is active with no period end (no billing cycle)
      await expectProduct(t.pool, customerId, "free", {
        status: "active",
        hasPeriodEnd: false,
      });
    } catch (error) {
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  });
});
