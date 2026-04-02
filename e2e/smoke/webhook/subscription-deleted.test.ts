import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  type TestPayKit,
  waitForWebhook,
} from "../setup";

describe("subscription-deleted: Stripe cancels subscription directly", () => {
  let t: TestPayKit;
  let customerId: string;
  let providerSubscriptionId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM(t, {
      id: "test_sub_deleted",
      email: "sub-deleted@test.com",
      name: "Subscription Deleted Test",
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

    // Get provider subscription ID
    const subResult = await t.pool.query(
      `SELECT s.provider_subscription_id FROM paykit_subscription s
       JOIN paykit_customer_product cp ON cp.subscription_id = s.id
       WHERE cp.customer_id = $1 ORDER BY s.updated_at DESC LIMIT 1`,
      [customerId],
    );
    providerSubscriptionId = (subResult.rows[0] as { provider_subscription_id: string })
      .provider_subscription_id;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("when Stripe cancels a subscription directly, PayKit ends the product and activates free", async () => {
    try {
      const beforeCancel = new Date();

      // Cancel directly via Stripe API (simulates Stripe dashboard cancellation)
      await t.stripeClient.subscriptions.cancel(providerSubscriptionId);

      // Wait for the real subscription.deleted webhook
      await waitForWebhook(t.pool, "subscription.deleted", {
        after: beforeCancel,
        timeout: 30_000,
      });

      // Pro should be canceled/ended
      await expectProduct(t.pool, customerId, "pro", { status: "canceled" });

      // Free should be active (default plan activated)
      await expectProduct(t.pool, customerId, "free", { status: "active", hasPeriodEnd: false });
    } catch (error) {
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  });
});
