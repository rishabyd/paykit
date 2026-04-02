import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  advanceTestClock,
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  type TestPayKit,
  waitForWebhook,
} from "../setup";

describe("renewal: pro subscription renews after 1 month", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM(t, {
      id: "test_renewal",
      email: "renewal@test.com",
      name: "Renewal Test",
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

  it("advancing clock 1 month rolls period dates forward", async () => {
    try {
      // Record current period end
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

      // Poll until period dates change (real subscription.updated webhook)
      let newPeriodEnd = periodEnd;
      for (let i = 0; i < 60; i++) {
        const result = await t.pool.query(
          `SELECT s.current_period_end_at FROM paykit_subscription s
           JOIN paykit_customer_product cp ON cp.subscription_id = s.id
           WHERE cp.customer_id = $1 AND s.status = 'active'
           ORDER BY s.updated_at DESC LIMIT 1`,
          [customerId],
        );
        const row = result.rows[0] as { current_period_end_at: string } | undefined;
        if (row) {
          const end = new Date(row.current_period_end_at);
          if (end.getTime() > periodEnd.getTime()) {
            newPeriodEnd = end;
            break;
          }
        }
        if (i === 59) throw new Error("Period dates never rolled forward after clock advance");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Period end moved forward
      expect(newPeriodEnd.getTime()).toBeGreaterThan(periodEnd.getTime());

      // Pro is still active
      await expectProduct(t.pool, customerId, "pro", { status: "active" });
    } catch (error) {
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  });
});
