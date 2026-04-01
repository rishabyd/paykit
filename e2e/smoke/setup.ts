import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import { stripe } from "@paykitjs/stripe";
import { config } from "dotenv";
import { createPayKit, feature, plan } from "paykitjs";
import pg from "pg";
import Stripe from "stripe";

import type { PayKitContext } from "../../packages/paykit/src/core/context";
import { migrateDatabase } from "../../packages/paykit/src/database/index";
import { syncPaymentMethodByProviderCustomer } from "../../packages/paykit/src/services/payment-method-service";
import { syncProducts } from "../../packages/paykit/src/services/product-sync-service";

// Load env from repo root
config({ path: path.resolve(import.meta.dirname, "../../.env") });
config({ path: path.resolve(import.meta.dirname, "../../.env.local"), override: true });

const WEBHOOK_PORT = 4567;

// ---------------------------------------------------------------------------
// Test plans
// ---------------------------------------------------------------------------

const messagesFeature = feature({ id: "messages", type: "metered" });
const proModelsFeature = feature({ id: "pro_models", type: "boolean" });
const prioritySupportFeature = feature({ id: "priority_support", type: "boolean" });

export const freePlan = plan({
  default: true,
  group: "base",
  id: "free",
  name: "Free",
  includes: [messagesFeature({ limit: 100, reset: "month" })],
});

export const proPlan = plan({
  group: "base",
  id: "pro",
  name: "Pro",
  includes: [messagesFeature({ limit: 2_000, reset: "month" }), proModelsFeature()],
  price: { amount: 19, interval: "month" },
});

export const ultraPlan = plan({
  group: "base",
  id: "ultra",
  name: "Ultra",
  includes: [
    messagesFeature({ limit: 10_000, reset: "month" }),
    proModelsFeature(),
    prioritySupportFeature(),
  ],
  price: { amount: 49, interval: "month" },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PoolLike = pg.Pool;

export interface TestPayKit {
  paykit: ReturnType<typeof createPayKit>;
  pool: PoolLike;
  ctx: PayKitContext;
  stripeClient: Stripe;
  testClockId: string;
  dbPath: string;
  server: Server;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// createTestPayKit
// ---------------------------------------------------------------------------

export async function createTestPayKit(): Promise<TestPayKit> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set");
  }

  const stripeClient = new Stripe(secretKey);

  // 1. Create a fresh test database
  const dbName = `paykit_smoke_${String(Date.now())}`;
  const adminPool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/postgres",
  });
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
  await adminPool.end();

  const dbUrl = (process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/postgres").replace(
    /\/[^/]*$/,
    `/${dbName}`,
  );
  const pool = new pg.Pool({ connectionString: dbUrl });

  // 2. Run migrations
  await migrateDatabase(pool);

  // 3. Create test clock
  const clock = await stripeClient.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `smoke-${String(Date.now())}`,
  });

  // 4. Create PayKit instance with real Stripe
  const stripeProvider = stripe({ secretKey, webhookSecret });
  const paykit = createPayKit({
    database: pool,
    plans: { free: freePlan, pro: proPlan, ultra: ultraPlan },
    provider: stripeProvider,
  });

  const ctx = (await paykit.$context) as PayKitContext;

  // Override upsertCustomer to attach test clock
  ctx.stripe.upsertCustomer = async (data) => {
    const customer = await stripeClient.customers.create({
      email: data.email,
      metadata: { customerId: data.id, ...data.metadata },
      name: data.name,
      test_clock: clock.id,
    });
    return { providerCustomerId: customer.id };
  };

  // Override createSubscription to use allow_incomplete. The default
  // payment_behavior: "default_incomplete" requires client-side payment
  // confirmation which isn't possible in automated tests.
  ctx.stripe.createSubscription = async (data) => {
    const sub = await stripeClient.subscriptions.create({
      customer: data.providerCustomerId,
      items: [{ price: data.providerPriceId }],
      payment_behavior: "allow_incomplete",
      expand: ["latest_invoice"],
      ...(data.trialPeriodDays && data.trialPeriodDays > 0
        ? { trial_period_days: data.trialPeriodDays }
        : {}),
    });

    const firstItem = sub.items.data[0];
    const periodStart = firstItem?.current_period_start ?? null;
    const periodEnd = firstItem?.current_period_end ?? null;
    const latestInvoice = sub.latest_invoice;
    const invoice =
      latestInvoice && typeof latestInvoice !== "string"
        ? {
            currency: latestInvoice.currency,
            hostedUrl: latestInvoice.hosted_invoice_url ?? null,
            periodEndAt: latestInvoice.period_end
              ? new Date(latestInvoice.period_end * 1000)
              : null,
            periodStartAt: latestInvoice.period_start
              ? new Date(latestInvoice.period_start * 1000)
              : null,
            providerInvoiceId: latestInvoice.id,
            status: latestInvoice.status,
            totalAmount: latestInvoice.total,
          }
        : null;

    return {
      invoice,
      paymentUrl: null,
      subscription: {
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at != null ? new Date(sub.canceled_at * 1000) : null,
        currentPeriodEndAt: periodEnd != null ? new Date(periodEnd * 1000) : null,
        currentPeriodStartAt: periodStart != null ? new Date(periodStart * 1000) : null,
        endedAt: sub.ended_at != null ? new Date(sub.ended_at * 1000) : null,
        providerSubscriptionId: sub.id,
        providerSubscriptionScheduleId: null,
        status: sub.status,
      },
    };
  };

  // 5. Start webhook server BEFORE syncing products — product sync
  // creates Stripe products which fires webhooks immediately
  const server = startWebhookServer(paykit);

  // 6. Sync products to Stripe
  await syncProducts(ctx);

  return {
    paykit,
    pool,
    ctx,
    stripeClient,
    testClockId: clock.id,
    dbPath: dbUrl,
    server,
    cleanup: async () => {
      // Delete test clock first — Stripe fires cleanup webhooks
      await stripeClient.testHelpers.testClocks.del(clock.id).catch(() => {});
      // Wait for cleanup webhooks to arrive and be processed
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      server.close();
      await pool.end();
      // Drop the test database
      const cleanupPool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/postgres",
      });
      await cleanupPool.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
      await cleanupPool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Customer helper
// ---------------------------------------------------------------------------

/**
 * Creates a PayKit customer and subscribes to Free (triggers Stripe customer
 * creation on the test clock). No payment method attached — first paid
 * subscribe will go through checkout.
 */
export async function createTestCustomer(
  t: TestPayKit,
  input: { id: string; email: string; name: string },
): Promise<{ customerId: string; providerCustomerId: string }> {
  // Create customer in PayKit DB
  await t.paykit.upsertCustomer(input);

  // Subscribe to free plan — this triggers Stripe customer creation via
  // our test clock override and assigns the default free plan
  await t.paykit.subscribe({
    customerId: input.id,
    planId: "free",
    successUrl: "https://example.com/success",
  });

  // Now the provider_customer mapping exists
  const result = await t.pool.query(
    "SELECT provider_customer_id FROM paykit_provider_customer WHERE customer_id = $1 LIMIT 1",
    [input.id],
  );
  const providerCustomerId = (result.rows[0] as { provider_customer_id: string })
    .provider_customer_id;

  return { customerId: input.id, providerCustomerId };
}

/**
 * Fakes a checkout completion. After paykit.subscribe() returns a paymentUrl
 * (checkout session), this:
 * 1. Retrieves the checkout session from Stripe
 * 2. Attaches a test payment method and creates a real subscription
 * 3. Feeds a crafted checkout.completed event to PayKit's webhook handler
 */
export async function fakeCheckoutCompletion(
  t: TestPayKit,
  paymentUrl: string,
  providerCustomerId: string,
): Promise<void> {
  // Extract checkout session ID from the URL
  const url = new URL(paymentUrl);
  const pathParts = url.pathname.split("/");
  const sessionId = pathParts[pathParts.length - 1] ?? "";

  // Retrieve the session to get metadata
  const session = await t.stripeClient.checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata ?? {};

  // Attach test payment method
  const pm = await t.stripeClient.paymentMethods.attach("pm_card_visa", {
    customer: providerCustomerId,
  });
  await t.stripeClient.customers.update(providerCustomerId, {
    invoice_settings: { default_payment_method: pm.id },
  });

  // Sync payment method into PayKit DB
  await syncPaymentMethodByProviderCustomer(t.ctx.database, {
    paymentMethod: {
      providerMethodId: pm.id,
      type: pm.type,
      last4: pm.card?.last4,
      expiryMonth: pm.card?.exp_month,
      expiryYear: pm.card?.exp_year,
      isDefault: true,
    },
    providerCustomerId,
    providerId: t.ctx.provider.id,
  });

  // Get the price from the session line items
  const lineItems = await t.stripeClient.checkout.sessions.listLineItems(sessionId);
  const stripePriceId = lineItems.data[0]?.price?.id;
  if (!stripePriceId) {
    throw new Error("No price found on checkout session");
  }

  // Create real subscription via Stripe API
  const sub = await t.stripeClient.subscriptions.create({
    customer: providerCustomerId,
    items: [{ price: stripePriceId }],
    metadata,
    expand: ["latest_invoice"],
  });

  const firstItem = sub.items.data[0];
  const periodStart = firstItem?.current_period_start ?? null;
  const periodEnd = firstItem?.current_period_end ?? null;

  const latestInvoice = sub.latest_invoice;
  const normalizedInvoice =
    latestInvoice && typeof latestInvoice !== "string"
      ? {
          currency: latestInvoice.currency,
          hostedUrl: latestInvoice.hosted_invoice_url ?? null,
          periodEndAt: latestInvoice.period_end ? new Date(latestInvoice.period_end * 1000) : null,
          periodStartAt: latestInvoice.period_start
            ? new Date(latestInvoice.period_start * 1000)
            : null,
          providerInvoiceId: latestInvoice.id,
          status: latestInvoice.status,
          totalAmount: latestInvoice.total,
        }
      : undefined;

  const normalizedSub = {
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at != null ? new Date(sub.canceled_at * 1000) : null,
    currentPeriodEndAt: periodEnd != null ? new Date(periodEnd * 1000) : null,
    currentPeriodStartAt: periodStart != null ? new Date(periodStart * 1000) : null,
    endedAt: sub.ended_at != null ? new Date(sub.ended_at * 1000) : null,
    providerSubscriptionId: sub.id,
    providerSubscriptionScheduleId: null,
    status: sub.status,
  };

  // Expire the original checkout session since we bypassed it
  await t.stripeClient.checkout.sessions.expire(sessionId).catch(() => {});

  // Override handleWebhook to return our crafted checkout.completed event.
  // Use a sentinel in the body to identify our fake request vs real webhooks.
  const fakeId = `fake_${String(Date.now())}`;
  const originalHandleWebhook = t.ctx.stripe.handleWebhook.bind(t.ctx.stripe);
  t.ctx.stripe.handleWebhook = async (data) => {
    // Only intercept our fake request, let real webhooks pass through
    if (!data.body.includes(fakeId)) {
      return originalHandleWebhook(data);
    }
    // Restore after consuming
    t.ctx.stripe.handleWebhook = originalHandleWebhook;

    return [
      {
        name: "checkout.completed" as const,
        payload: {
          checkoutSessionId: session.id,
          invoice: normalizedInvoice,
          metadata,
          mode: "subscription" as const,
          paymentStatus: "paid",
          providerCustomerId,
          providerEventId: `evt_fake_checkout_${String(Date.now())}`,
          providerSubscriptionId: sub.id,
          status: "complete",
          subscription: normalizedSub,
        },
      },
    ];
  };

  // Send a fake webhook request with sentinel so the override can identify it
  const response = await fetch(
    `http://localhost:${String(WEBHOOK_PORT)}/paykit/api/webhook/stripe`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed", id: fakeId }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    // Restore handler if our request failed
    t.ctx.stripe.handleWebhook = originalHandleWebhook;
    throw new Error(`Fake checkout webhook failed (${String(response.status)}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Webhook server
// ---------------------------------------------------------------------------

function startWebhookServer(paykit: ReturnType<typeof createPayKit>): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString();

    const url = new URL(req.url ?? "/", `http://localhost:${String(WEBHOOK_PORT)}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    try {
      const response = await paykit.handler(request);
      res.writeHead(response.status);
      res.end(await response.text());
    } catch (error) {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : "Internal error");
    }
  });

  server.listen(WEBHOOK_PORT);
  return server;
}

// ---------------------------------------------------------------------------
// Clock + webhook helpers
// ---------------------------------------------------------------------------

export async function advanceTestClock(
  stripeClient: Stripe,
  testClockId: string,
  toDate: string,
): Promise<void> {
  const frozenTime = Math.floor(new Date(toDate).getTime() / 1000);
  await stripeClient.testHelpers.testClocks.advance(testClockId, {
    frozen_time: frozenTime,
  });

  // Poll until clock is ready
  for (let i = 0; i < 60; i++) {
    const clock = await stripeClient.testHelpers.testClocks.retrieve(testClockId);
    if (clock.status === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Test clock ${testClockId} did not reach 'ready' status`);
}

export async function waitForWebhook(
  pool: PoolLike,
  eventType: string,
  options?: { timeout?: number; after?: Date },
): Promise<Record<string, unknown>> {
  const timeout = options?.timeout ?? 15_000;
  const after = options?.after ?? new Date(0);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await pool.query(
      `SELECT * FROM paykit_webhook_event
       WHERE type = $1 AND status IN ('processed', 'failed')
         AND received_at > $2
       ORDER BY received_at DESC LIMIT 1`,
      [eventType, after.toISOString()],
    );

    const row = result.rows[0];
    if (row) {
      if (row.status === "failed") {
        throw new Error(`Webhook ${eventType} failed: ${String(row.error)}`);
      }
      return row;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for webhook: ${eventType}`);
}

/**
 * Manually fires a subscription.updated event for a renewal.
 * Retrieves the current subscription from Stripe and normalizes it.
 */
export async function fakeSubscriptionUpdatedEvent(
  t: TestPayKit,
  providerSubscriptionId: string,
  providerCustomerId: string,
): Promise<void> {
  const sub = await t.stripeClient.subscriptions.retrieve(providerSubscriptionId);
  const firstItem = sub.items.data[0];
  const periodStart = firstItem?.current_period_start ?? null;
  const periodEnd = firstItem?.current_period_end ?? null;

  const providerPriceId = firstItem?.price?.id ?? null;

  const normalizedSub = {
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at != null ? new Date(sub.canceled_at * 1000) : null,
    currentPeriodEndAt: periodEnd != null ? new Date(periodEnd * 1000) : null,
    currentPeriodStartAt: periodStart != null ? new Date(periodStart * 1000) : null,
    endedAt: sub.ended_at != null ? new Date(sub.ended_at * 1000) : null,
    providerPriceId,
    providerSubscriptionId: sub.id,
    providerSubscriptionScheduleId: null,
    status: sub.status,
  };

  const fakeId = `fake_renewed_${String(Date.now())}`;
  const originalHandleWebhook = t.ctx.stripe.handleWebhook.bind(t.ctx.stripe);
  t.ctx.stripe.handleWebhook = async (data) => {
    if (!data.body.includes(fakeId)) {
      return originalHandleWebhook(data);
    }
    t.ctx.stripe.handleWebhook = originalHandleWebhook;
    return [
      {
        name: "subscription.updated" as const,
        actions: [
          {
            type: "subscription.upsert" as const,
            data: { providerCustomerId, subscription: normalizedSub },
          },
        ],
        payload: {
          providerCustomerId,
          providerEventId: `evt_${fakeId}`,
          subscription: normalizedSub,
        },
      },
    ];
  };

  const response = await fetch(
    `http://localhost:${String(WEBHOOK_PORT)}/paykit/api/webhook/stripe`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "customer.subscription.updated", id: fakeId }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Fake subscription.updated webhook failed (${String(response.status)}): ${text}`,
    );
  }
}

/**
 * Manually fires a subscription.deleted event to PayKit's webhook handler.
 * Needed because stripe listen doesn't reliably forward test clock lifecycle events.
 */
export async function fakeSubscriptionDeletedEvent(
  t: TestPayKit,
  providerSubscriptionId: string,
  providerCustomerId: string,
): Promise<void> {
  const fakeId = `fake_deleted_${String(Date.now())}`;
  const originalHandleWebhook = t.ctx.stripe.handleWebhook.bind(t.ctx.stripe);
  t.ctx.stripe.handleWebhook = async (data) => {
    if (!data.body.includes(fakeId)) {
      return originalHandleWebhook(data);
    }
    t.ctx.stripe.handleWebhook = originalHandleWebhook;
    return [
      {
        name: "subscription.deleted" as const,
        actions: [
          {
            type: "subscription.delete" as const,
            data: { providerCustomerId, providerSubscriptionId },
          },
        ],
        payload: {
          providerCustomerId,
          providerEventId: `evt_${fakeId}`,
          providerSubscriptionId,
        },
      },
    ];
  };

  const response = await fetch(
    `http://localhost:${String(WEBHOOK_PORT)}/paykit/api/webhook/stripe`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "customer.subscription.deleted", id: fakeId }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Fake subscription.deleted webhook failed (${String(response.status)}): ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Failure dump
// ---------------------------------------------------------------------------

export async function dumpStateOnFailure(pool: PoolLike, dbPath: string): Promise<void> {
  console.error("\n=== SMOKE TEST FAILURE — DB STATE DUMP ===");
  console.error(`Database path: ${dbPath}\n`);

  const tables = [
    { name: "paykit_customer", query: "SELECT id, email, name FROM paykit_customer" },
    {
      name: "paykit_customer_product",
      query: `SELECT id, customer_id, status, canceled, started_at, ended_at,
              current_period_start_at, current_period_end_at, scheduled_product_id
              FROM paykit_customer_product ORDER BY created_at DESC`,
    },
    {
      name: "paykit_subscription",
      query: `SELECT id, status, cancel_at_period_end, current_period_start_at,
              current_period_end_at, canceled_at, ended_at
              FROM paykit_subscription ORDER BY updated_at DESC`,
    },
    {
      name: "paykit_webhook_event",
      query: `SELECT type, status, error, trace_id, received_at
              FROM paykit_webhook_event ORDER BY received_at DESC LIMIT 10`,
    },
  ];

  for (const table of tables) {
    try {
      const result = await pool.query(table.query);
      console.error(`\n--- ${table.name} ---`);
      if (result.rows.length === 0) {
        console.error("  (empty)");
      } else {
        for (const row of result.rows) {
          console.error(JSON.stringify(row, null, 2));
        }
      }
    } catch {
      console.error(`\n--- ${table.name} --- (query failed)`);
    }
  }

  console.error("\n=== END DUMP ===\n");
}
