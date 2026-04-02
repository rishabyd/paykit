import { describe, expect, it } from "vitest";

import type { PayKitContext } from "../core/context";
import { paymentMethod } from "../database/schema";
import { createPayKit, feature, plan } from "../index";
import { syncCustomer } from "../services/customer-service";
import { syncProducts } from "../services/product-sync-service";
import { createMigratedTestPool, mockProvider } from "../test-utils";

const messagesFeature = feature({
  id: "messages",
  type: "metered",
});

const free = plan({
  default: true,
  group: "base",
  id: "free",
  includes: [messagesFeature({ limit: 50, reset: "month" })],
});

const pro = plan({
  group: "base",
  id: "pro",
  includes: [messagesFeature({ limit: 1000, reset: "month" })],
  price: { amount: 20, interval: "month" },
});

describe("subscribe", () => {
  it("should start checkout-backed subscription attaches when no default payment method exists", async () => {
    const pool = await createMigratedTestPool();
    const paykit = createPayKit({
      database: pool,
      plans: { free, pro },
      provider: mockProvider(),
    });

    const ctx = (await paykit.$context) as PayKitContext;
    await syncProducts(ctx);
    await syncCustomer(ctx.database, {
      email: "checkout@example.com",
      id: "user_checkout",
      name: "Checkout User",
    });

    const result = await paykit.subscribe({
      customerId: "user_checkout",
      planId: "pro",
      successUrl: "https://example.com/billing/success",
    });

    expect(result.paymentUrl).toContain("checkout/subscription");

    const metadataRows = await pool.query(`
      select type
      from paykit_metadata
      where type = 'subscribe_new'
    `);
    expect(metadataRows.rows).toHaveLength(1);
  });

  it("should create subscription rows for direct subscription attaches", async () => {
    const pool = await createMigratedTestPool();
    const paykit = createPayKit({
      database: pool,
      plans: { free, pro },
      provider: mockProvider(),
    });

    const ctx = (await paykit.$context) as PayKitContext;
    await syncProducts(ctx);
    await syncCustomer(ctx.database, {
      email: "direct@example.com",
      id: "user_direct",
      name: "Direct User",
    });
    await ctx.database.insert(paymentMethod).values({
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
      customerId: "user_direct",
      deletedAt: null,
      expiryMonth: 10,
      expiryYear: 2030,
      id: "pm_local_123",
      isDefault: true,
      last4: "4242",
      providerId: "mock",
      providerMethodId: "pm_mock_default",
      type: "card",
      updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    });

    const result = await paykit.subscribe({
      customerId: "user_direct",
      planId: "pro",
      successUrl: "https://example.com/billing/success",
    });

    expect(result.paymentUrl).toBeNull();
    expect(result.invoice?.providerInvoiceId).toBe("inv_mock_price_pro_2000");

    const subscriptions = await pool.query(`
      select status
      from paykit_subscription
      where customer_id = 'user_direct'
    `);

    expect(subscriptions.rows).toHaveLength(1);
    expect((subscriptions.rows[0] as { status: string }).status).toBe("active");
  });

  it("should replace an active free plan with a paid subscription attach", async () => {
    const pool = await createMigratedTestPool();
    const paykit = createPayKit({
      database: pool,
      plans: { free, pro },
      provider: mockProvider(),
    });

    const ctx = (await paykit.$context) as PayKitContext;
    await syncProducts(ctx);
    await syncCustomer(ctx.database, {
      email: "free-to-pro@example.com",
      id: "user_free_to_pro",
      name: "Free To Pro",
    });

    await paykit.subscribe({
      customerId: "user_free_to_pro",
      planId: "free",
      successUrl: "https://example.com/billing/success",
    });

    await ctx.database.insert(paymentMethod).values({
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
      customerId: "user_free_to_pro",
      deletedAt: null,
      expiryMonth: 10,
      expiryYear: 2030,
      id: "pm_local_free_to_pro",
      isDefault: true,
      last4: "4242",
      providerId: "mock",
      providerMethodId: "pm_mock_default",
      type: "card",
      updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    });

    const result = await paykit.subscribe({
      customerId: "user_free_to_pro",
      planId: "pro",
      successUrl: "https://example.com/billing/success",
    });

    expect(result.paymentUrl).toBeNull();

    const subscriptions = await pool.query(`
      select status
      from paykit_subscription
      where customer_id = 'user_free_to_pro'
      order by created_at asc
    `);

    expect(subscriptions.rows).toHaveLength(2);
    expect((subscriptions.rows[0] as { status: string }).status).toBe("ended");
    expect((subscriptions.rows[1] as { status: string }).status).toBe("active");
  });

  it("should materialize subscription state from webhook events", async () => {
    const pool = await createMigratedTestPool();
    const provider = mockProvider({
      id: "stripe",
      runtime: {
        async handleWebhook() {
          return [
            {
              actions: [
                {
                  data: {
                    providerCustomerId: "cus_user_webhook_sub",
                    subscription: {
                      cancelAtPeriodEnd: false,
                      providerPriceId: "price_pro",
                      providerSubscriptionId: "sub_stripe_123",
                      status: "active",
                    },
                  },
                  type: "subscription.upsert" as const,
                },
              ],
              name: "subscription.updated" as const,
              payload: {
                providerCustomerId: "cus_user_webhook_sub",
                subscription: {
                  cancelAtPeriodEnd: false,
                  providerPriceId: "price_pro",
                  providerSubscriptionId: "sub_stripe_123",
                  status: "active",
                },
              },
            },
          ];
        },
        async syncProduct(data) {
          return { providerProductId: `prod_${data.id}`, providerPriceId: "price_pro" };
        },
      },
    });

    const paykit = createPayKit({
      database: pool,
      plans: { free, pro },
      provider,
    });
    const ctx = (await paykit.$context) as PayKitContext;
    await syncProducts(ctx);

    await syncCustomer(ctx.database, {
      email: "webhook-sub@example.com",
      id: "user_webhook_sub",
      name: "Webhook Sub User",
    });
    await pool.query(`
      UPDATE paykit_customer
      SET provider = '{"stripe": {"id": "cus_user_webhook_sub"}}'::jsonb
      WHERE id = 'user_webhook_sub'
    `);

    await paykit.handleWebhook({
      body: "{}",
      headers: {},
    });

    const subscriptions = await pool.query(`
      select status
      from paykit_subscription
      where customer_id = 'user_webhook_sub'
    `);
    expect(subscriptions.rows).toHaveLength(1);
    expect((subscriptions.rows[0] as { status: string }).status).toBe("active");
  });
});
