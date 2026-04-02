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

describe("resubscribe-after-cancel: checkout after full cancellation", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM(t, {
      id: "test_resub",
      email: "resub@test.com",
      name: "Resubscribe Test",
    });
    customerId = customer.customerId;

    // Setup: subscribe Pro → cancel to Free → advance clock (full cancellation)
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

    // Advance past period end so subscription fully cancels
    const subResult = await t.pool.query(
      `SELECT s.current_period_end_at FROM paykit_subscription s
       JOIN paykit_customer_product cp ON cp.subscription_id = s.id
       WHERE cp.customer_id = $1 ORDER BY s.updated_at DESC LIMIT 1`,
      [customerId],
    );
    const periodEnd = new Date(
      (subResult.rows[0] as { current_period_end_at: string }).current_period_end_at,
    );
    const advanceTo = new Date(periodEnd.getTime() + 86_400_000);
    await advanceTestClock(t.stripeClient, t.testClockId, advanceTo.toISOString().split("T")[0]!);

    // Wait for Free to activate
    for (let i = 0; i < 60; i++) {
      const result = await t.pool.query(
        `SELECT cp.status FROM paykit_customer_product cp
         JOIN paykit_product p ON p.internal_id = cp.product_internal_id
         WHERE cp.customer_id = $1 AND p.id = 'free' AND cp.status = 'active'`,
        [customerId],
      );
      if (result.rows.length > 0) break;
      if (i === 59) throw new Error("Free never activated in setup");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Clear stale payment method (Stripe removes it on full cancellation)
    await t.pool.query("DELETE FROM paykit_payment_method WHERE customer_id = $1", [customerId]);
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("resubscribing after full cancellation requires checkout", async () => {
    try {
      const beforeCheckout = new Date();

      const result = await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      // Should require checkout (payment method was cleared)
      if (!result.paymentUrl) {
        throw new Error("Expected checkout URL but got direct subscription");
      }

      console.log("\n\n  ▶ Complete checkout at:\n  " + result.paymentUrl + "\n");

      // Wait for manual checkout completion
      await waitForWebhook(t.pool, "checkout.completed", {
        after: beforeCheckout,
        timeout: 120_000,
      });

      // Pro is active again
      await expectProduct(t.pool, customerId, "pro", { status: "active", hasPeriodEnd: true });
    } catch (error) {
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  });
});
