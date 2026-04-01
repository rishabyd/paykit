import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  advanceTestClock,
  createTestCustomer,
  createTestPayKit,
  dumpStateOnFailure,
  fakeCheckoutCompletion,
  type TestPayKit,
  waitForWebhook,
} from "./setup";

describe("subscription lifecycle", () => {
  let t: TestPayKit;
  let customerId: string;
  let providerCustomerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomer(t, {
      id: "test_user_1",
      email: "smoke@test.com",
      name: "Smoke Test User",
    });
    customerId = customer.customerId;
    providerCustomerId = customer.providerCustomerId;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  // Poll until the subscription is active in PayKit's DB
  async function waitForSubscriptionActive(pool: typeof t.pool, custId: string, timeout = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await pool.query(
        `SELECT s.status FROM paykit_subscription s
         JOIN paykit_customer_product cp ON cp.subscription_id = s.id
         WHERE cp.customer_id = $1
         ORDER BY s.updated_at DESC LIMIT 1`,
        [custId],
      );
      const row = result.rows[0] as { status: string } | undefined;
      if (row?.status === "active") return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for subscription to become active");
  }

  // Helper to query customer products
  async function getCustomerProducts() {
    const result = await t.pool.query(
      `SELECT cp.id, p.id as plan_id, cp.status, cp.canceled, cp.started_at,
              cp.ended_at, cp.current_period_start_at, cp.current_period_end_at,
              cp.scheduled_product_id
       FROM paykit_customer_product cp
       JOIN paykit_product p ON p.internal_id = cp.product_internal_id
       WHERE cp.customer_id = $1
       ORDER BY cp.created_at DESC`,
      [customerId],
    );
    return result.rows as Array<{
      id: string;
      plan_id: string;
      status: string;
      canceled: boolean;
      started_at: string | null;
      ended_at: string | null;
      current_period_start_at: string | null;
      current_period_end_at: string | null;
      scheduled_product_id: string | null;
    }>;
  }

  async function getSubscription() {
    const result = await t.pool.query(
      `SELECT s.* FROM paykit_subscription s
       JOIN paykit_customer_product cp ON cp.subscription_id = s.id
       WHERE cp.customer_id = $1 AND s.status != 'canceled'
       ORDER BY s.updated_at DESC LIMIT 1`,
      [customerId],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  async function getInvoiceCount() {
    const result = await t.pool.query(
      `SELECT count(*)::int as count FROM paykit_invoice
       WHERE customer_id = $1`,
      [customerId],
    );
    return (result.rows[0] as { count: number }).count;
  }

  // Wrap each step to dump state on failure
  async function step(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      console.error(`\nStep failed: ${name}`);
      await dumpStateOnFailure(t.pool, t.dbPath);
      throw error;
    }
  }

  it("full subscription lifecycle", async () => {
    // ─── Step 1: Sign up → Free plan auto-assigned ───
    await step("sign up → free plan", async () => {
      const products = await getCustomerProducts();
      const freeProduct = products.find((p) => p.plan_id === "free");

      expect(freeProduct).toBeDefined();
      expect(freeProduct!.status).toBe("active");
      expect(freeProduct!.current_period_end_at).toBeNull();
    });

    // ─── Step 2: Subscribe to Pro (via checkout) ───
    await step("subscribe to pro (checkout)", async () => {
      const result = await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      // No payment method → should return checkout URL
      expect(result.paymentUrl).not.toBeNull();

      // Fake the checkout completion (creates real subscription + feeds webhook)
      await fakeCheckoutCompletion(t, result.paymentUrl!, providerCustomerId);

      const products = await getCustomerProducts();
      const pro = products.find((p) => p.plan_id === "pro" && p.status === "active");
      const free = products.find((p) => p.plan_id === "free" && p.status === "ended");

      expect(pro).toBeDefined();
      expect(pro!.current_period_end_at).not.toBeNull();
      expect(free).toBeDefined();

      const invoices = await getInvoiceCount();
      expect(invoices).toBeGreaterThanOrEqual(1);
    });

    // ─── Step 3: Upgrade Pro → Ultra (immediate) ───
    await step("upgrade pro → ultra", async () => {
      const beforeUpgrade = new Date();

      await t.paykit.subscribe({
        customerId,
        planId: "ultra",
        successUrl: "https://example.com/success",
      });

      // Wait for subscription update webhook
      await waitForSubscriptionActive(t.pool, customerId);

      const products = await getCustomerProducts();
      const ultra = products.find((p) => p.plan_id === "ultra" && p.status === "active");
      const pro = products.find(
        (p) => p.plan_id === "pro" && p.status === "ended" && p.ended_at !== null,
      );

      expect(ultra).toBeDefined();
      expect(ultra!.current_period_end_at).not.toBeNull();
      expect(pro).toBeDefined();
    });

    // ─── Step 4: Downgrade Ultra → Pro (scheduled) ───
    await step("downgrade ultra → pro (scheduled)", async () => {
      const beforeDowngrade = new Date();

      await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      await waitForWebhook(t.pool, "subscription.updated", { after: beforeDowngrade });

      const products = await getCustomerProducts();
      const ultra = products.find((p) => p.plan_id === "ultra" && p.status === "active");
      const scheduledPro = products.find((p) => p.plan_id === "pro" && p.status === "scheduled");

      expect(ultra).toBeDefined();
      expect(ultra!.canceled).toBe(true);
      expect(scheduledPro).toBeDefined();
    });

    // ─── Step 5: Resume Ultra (cancel the downgrade to Pro) ───
    await step("resume ultra", async () => {
      await t.paykit.subscribe({
        customerId,
        planId: "ultra",
        successUrl: "https://example.com/success",
      });

      const products = await getCustomerProducts();
      const ultra = products.find((p) => p.plan_id === "ultra" && p.status === "active");
      const scheduledPro = products.find((p) => p.plan_id === "pro" && p.status === "scheduled");

      expect(ultra).toBeDefined();
      expect(ultra!.canceled).toBe(false);
      expect(scheduledPro).toBeUndefined();
    });

    // ─── Step 6: Downgrade Ultra → Free + advance clock ───
    await step("downgrade ultra → free + advance clock", async () => {
      const beforeDowngrade = new Date();

      await t.paykit.subscribe({
        customerId,
        planId: "free",
        successUrl: "https://example.com/success",
      });

      await waitForWebhook(t.pool, "subscription.updated", { after: beforeDowngrade });

      const products = await getCustomerProducts();
      const ultra = products.find((p) => p.plan_id === "ultra" && p.status === "active");
      const scheduledFree = products.find((p) => p.plan_id === "free" && p.status === "scheduled");

      expect(ultra).toBeDefined();
      expect(ultra!.canceled).toBe(true);
      expect(scheduledFree).toBeDefined();

      // Cancel the subscription directly via Stripe API (test clocks don't
      // reliably fire lifecycle events through stripe listen)
      const subProviderResult = await t.pool.query(
        `SELECT s.provider_subscription_id FROM paykit_subscription s
         JOIN paykit_customer_product cp ON cp.subscription_id = s.id
         WHERE cp.customer_id = $1
         ORDER BY s.updated_at DESC LIMIT 1`,
        [customerId],
      );
      const providerSubId = (subProviderResult.rows[0] as { provider_subscription_id: string })
        .provider_subscription_id;

      // Immediately cancel (not at period end) to simulate period expiry
      await t.stripeClient.subscriptions.cancel(providerSubId);

      // Feed the subscription.deleted event to PayKit
      const { fakeSubscriptionDeletedEvent } = await import("./setup");
      await fakeSubscriptionDeletedEvent(t, providerSubId, providerCustomerId);

      const updatedProducts = await getCustomerProducts();
      const canceledUltra = updatedProducts.find(
        (p) => p.plan_id === "ultra" && (p.status === "canceled" || p.status === "ended"),
      );
      const activeFree = updatedProducts.find((p) => p.plan_id === "free" && p.status === "active");

      expect(canceledUltra).toBeDefined();
      expect(activeFree).toBeDefined();
      expect(activeFree!.current_period_end_at).toBeNull();
    });

    // ─── Step 7: Upgrade Free → Pro ───
    await step("upgrade free → pro", async () => {
      const result = await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      // Customer has payment method, so may go direct or checkout
      if (result.paymentUrl) {
        await fakeCheckoutCompletion(t, result.paymentUrl, providerCustomerId);
      }
      await waitForSubscriptionActive(t.pool, customerId, 20_000);

      const products = await getCustomerProducts();
      const activePro = products.find((p) => p.plan_id === "pro" && p.status === "active");

      expect(activePro).toBeDefined();
      expect(activePro!.current_period_end_at).not.toBeNull();
    });

    // TODO: Step 8 (renewal) — needs investigation. Test clock advances
    // work in Stripe but faked webhook events don't update period dates
    // in PayKit's DB reliably. Will add once the root cause is identified.
  });
});
