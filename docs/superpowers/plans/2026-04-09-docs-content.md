# Documentation Content Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write content for all 14 empty documentation pages (Concepts, Flows, Providers sections).

**Architecture:** Each task produces one `.mdx` doc page. Pages use the same components as the existing Get Started docs (Tabs, Tab, Callout, Steps, Step, PackageInstall, PackageRun). Code examples should be accurate to the actual API, sourced from `ob/api-design.md`, source types, and the demo app. Follow the writing guidance from `ob/spec.md`: say "plan" not "product", say "framework" not "platform", treat Stripe internals as implementation detail.

**Tech Stack:** MDX with fumadocs components, TypeScript code examples

**Terminology rules (from spec.md):**

- Say `framework`, `toolkit`, or `library`, never lead with `platform`
- Publicly say `plan`, not `product`
- Describe PayKit as embedded or in-app
- Treat Stripe primitives as implementation detail unless the topic is provider integration

**Writing style (modeled after Better Auth docs):**

- **No em dashes.** Use commas, periods, or "or" instead. Never use `—` anywhere.
- **Contractions.** Write "don't", "isn't", "can't", "you'll" instead of "do not", "is not", etc.
- **Short paragraphs.** 2-4 sentences max, then a break (list, code, or subheading).
- **Show code early.** Intro paragraph (1-2 sentences), then code. Don't write walls of text before showing anything.
- **Never write "here's an example" or "as shown below".** Instead: "To [action]:" then code immediately.
- **Active voice.** "You can disable..." not "Disabling can be done..."
- **Bullets for capabilities.** Don't describe feature lists in prose paragraphs.
- **Link inline.** Embed links where related concepts are mentioned, not in "see also" sections.
- **Callouts where they matter.** Place `<Callout>` right next to the relevant code or concept, not grouped at the bottom.
- **Connect to known patterns.** "Similar to how X works" helps readers build mental models.
- **Label code blocks with `title="filename"`** when the code belongs in a specific file.

**Available MDX components:** `<Tabs items={[...]}>`, `<Tab value="...">`, `<Callout type="info|warn">`, `<Steps>`, `<Step>`, `<PackageInstall package="..." />`, `<PackageRun command="..." />`

**Files:** All pages live in `landing/content/docs/`. Each task modifies exactly one `.mdx` file.

---

## Task Order

Tasks are ordered so that foundational concepts come first (plans, features, customers) before pages that build on them (subscriptions, entitlements). Flows come last since they reference multiple concepts.

---

### Task 1: Concepts, Plans & Features

**Files:**

- Modify: `landing/content/docs/concepts/plans-and-features.mdx`

**Context:** This is the most foundational concept page. It explains the `feature()` and `plan()` DSL, feature types (boolean, metered), plan groups, defaults, pricing, and how plans are passed to `createPayKit`.

**Content outline:**

1. Opening paragraph: Plans are the core billing unit. They define what your customers can subscribe to. Features are what plans grant.
2. **Defining features.** `feature()` with `id` and `type` (`boolean` | `metered`). ID rules: lowercase alphanumeric, dashes, underscores, max 64 chars.
3. **Including features in plans.** Boolean features: call with no args `proModels()`. Metered features: call with `{ limit, reset }` where reset is `day | week | month | year`.
4. **Defining plans.** `plan()` with `id`, `name` (optional, derived from id), `group`, `default`, `price`, `includes`. Show a complete example with free + pro + ultra.
5. **Plan groups.** Mutually exclusive sets. A customer has one active plan per group. Required when `default: true`.
6. **Default plans.** Fallback plan for a group (usually free). Must set `group`.
7. **Pricing.** `price: { amount, interval }` where interval is `month | year`. Amount is in dollars (max $999,999.99). Plans without `price` are free.
8. **Passing plans to PayKit.** `createPayKit({ plans: [free, pro, ultra] })`. Can also pass a module object (re-exports).
9. **Type inference.** Plan IDs and feature IDs infer from the `plans` array. Typos caught at compile time.

**Code examples to include:**

```ts
import { feature, plan } from "paykitjs";

// Boolean feature: grants access to something
const proModels = feature({ id: "pro_models", type: "boolean" });

// Metered feature: tracks usage with a limit
const messages = feature({ id: "messages", type: "metered" });
```

```ts
export const free = plan({
  id: "free",
  name: "Free",
  group: "base",
  default: true,
  includes: [messages({ limit: 100, reset: "month" })],
});

export const pro = plan({
  id: "pro",
  name: "Pro",
  group: "base",
  price: { amount: 19, interval: "month" },
  includes: [messages({ limit: 2_000, reset: "month" }), proModels()],
});

export const ultra = plan({
  id: "ultra",
  name: "Ultra",
  group: "base",
  price: { amount: 49, interval: "month" },
  includes: [messages({ limit: 10_000, reset: "month" }), proModels(), prioritySupport()],
});
```

```ts
// paykit.ts
import { free, pro, ultra } from "./plans";

export const paykit = createPayKit({
  // ...
  plans: [free, pro, ultra],
});

// Plan and feature IDs are now type-safe:
await paykit.subscribe({ customerId: "user_123", planId: "pro" }); // ✓
await paykit.subscribe({ customerId: "user_123", planId: "typo" }); // ✗ type error
```

- [ ] **Step 1:** Write the full page content in `plans-and-features.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly with `pnpm dev` and check `/docs/concepts/plans-and-features`

---

### Task 2: Concepts, Customers

**Files:**

- Modify: `landing/content/docs/concepts/customers.mdx`

**Context:** Customers are the app's own users/entities mapped to PayKit. The page covers creating, reading, listing, and deleting customers, plus the `identify` option for HTTP-based customer resolution.

**Content outline:**

1. Opening paragraph: A customer is your app's user or billing entity. PayKit links it to the payment provider internally, so your app works with its own customer ID.
2. **Creating customers.** `upsertCustomer({ id, email, name })`. Creates or updates. When a customer is created and a default plan exists, they're automatically subscribed.
3. **Getting a customer.** `getCustomer({ id })` returns the customer with current subscriptions and entitlements.
4. **Listing customers.** `listCustomers({ limit, offset, planIds })` with pagination.
5. **Deleting customers.** `deleteCustomer({ id })`.
6. **Customer identification (client).** The `identify` option on `createPayKit` resolves the authenticated customer from incoming HTTP requests. Required for client SDK usage. Show an example with a session-based auth library.
7. **Security note.** Callout: When requests go through the HTTP router, `identify()` is the trust boundary. Explicitly passed `customerId` must match `identify()` result.

**Code examples to include:**

Server-side upsert:

```ts
await paykit.upsertCustomer({
  id: "user_123",
  email: "jane@example.com",
  name: "Jane Doe",
});
```

Get customer with details:

```ts
const customer = await paykit.getCustomer({ id: "user_123" });

// customer.subscriptions: active subscriptions with planId, status, period dates
// customer.entitlements:  feature balances keyed by feature ID
```

List with filtering:

```ts
const { data, total, hasMore } = await paykit.listCustomers({
  limit: 50,
  offset: 0,
  planIds: ["pro", "ultra"],
});
```

Identify option:

```ts
export const paykit = createPayKit({
  // ...
  identify: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    return {
      customerId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  },
});
```

- [ ] **Step 1:** Write the full page content in `customers.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 3: Concepts, Subscriptions

**Files:**

- Modify: `landing/content/docs/concepts/subscriptions.mdx`

**Context:** This page explains `subscribe()` semantics in detail. It's the unified API that handles new subscriptions, upgrades, downgrades, cancellations, and resumptions.

**Content outline:**

1. Opening paragraph: `subscribe()` is the main transition API. It handles more than just starting a new subscription. It covers the full lifecycle.
2. **New subscription.** Free plan: instant local activation. Paid plan with payment method: direct. Paid plan without: returns `paymentUrl` for checkout.
3. **Result shape.** `{ paymentUrl, invoice, requiredAction }`. If `paymentUrl` is set, redirect the user.
4. **Upgrade.** Moving to a higher-priced plan in the same group. Immediate. Old plan ends, new starts.
5. **Downgrade.** Moving to a lower-priced plan. Scheduled for period end. Current plan stays active. Target stored as `scheduled`.
6. **Cancel to free.** Downgrading from paid to the default free plan follows the same scheduled pattern.
7. **Resume.** Subscribing to the already-active plan with a pending cancellation or downgrade clears it and resumes.
8. **No-op.** Subscribing to the already-active plan with no pending change is a no-op.
9. **Change scheduled target.** If a downgrade is already scheduled, subscribing to a different lower plan replaces the target.
10. **Server vs Client.** Show both usage patterns with Tabs.

**Code examples:** Server subscribe with all options, client subscribe, handling paymentUrl redirect, the full lifecycle table.

```ts
// Server
const result = await paykit.subscribe({
  customerId: "user_123",
  planId: "pro",
  successUrl: "https://myapp.com/billing/success",
  cancelUrl: "https://myapp.com/billing",
});

if (result.paymentUrl) {
  // Redirect user to provider checkout
}
```

```tsx
// Client (React)
const { paymentUrl } = await paykitClient.subscribe({
  planId: "pro",
});

if (paymentUrl) {
  window.location.href = paymentUrl;
}
```

Include a behavior summary table:

| Scenario                                      | Behavior                          |
| --------------------------------------------- | --------------------------------- |
| New subscription (free)                       | Activates immediately             |
| New subscription (paid, has payment method)   | Creates subscription directly     |
| New subscription (paid, no payment method)    | Returns `paymentUrl` for checkout |
| Upgrade (higher price, same group)            | Switches immediately              |
| Downgrade (lower price, same group)           | Scheduled for period end          |
| Cancel to default free plan                   | Scheduled for period end          |
| Re-subscribe to current plan (pending cancel) | Resumes, clears cancellation      |
| Re-subscribe to current plan (no changes)     | No-op                             |

- [ ] **Step 1:** Write the full page content in `subscriptions.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 4: Concepts, Entitlements

**Files:**

- Modify: `landing/content/docs/concepts/entitlements.mdx`

**Context:** Entitlements are the runtime access/balance a customer has for a feature. This page covers `check()` and `report()`, boolean vs metered behavior, and balance resets.

**Content outline:**

1. Opening paragraph: Entitlements represent what a customer can currently do based on their plan. They're derived from the active subscription.
2. **Checking access.** `check({ customerId, featureId })` returns `{ allowed, balance }`.
3. **Boolean features.** `check()` returns `{ allowed: true }` if the feature is included in the customer's plan. No balance tracking.
4. **Metered features.** `check()` returns `{ allowed, balance: { limit, remaining, resetAt, unlimited } }`. Allowed is `true` when `remaining > 0`.
5. **Reporting usage.** `report({ customerId, featureId, amount })` decrements balance. Returns `{ success, balance }`. Fails if insufficient balance.
6. **Balance resets.** Metered balances reset lazily. When a check or report happens after the reset time, the balance resets automatically. Reset intervals: `day`, `week`, `month`, `year`.
7. **Practical pattern.** Check, perform action, report. Show the AI chat example from quickstart.

```ts
// Check access
const { allowed, balance } = await paykit.check({
  customerId: "user_123",
  featureId: "messages",
});
// allowed: true
// balance: { limit: 2000, remaining: 1847, resetAt: 2026-05-01T00:00:00Z, unlimited: false }

// Boolean feature check
const { allowed } = await paykit.check({
  customerId: "user_123",
  featureId: "pro_models",
});
// allowed: true (no balance for boolean features)
```

```ts
// Report usage
const { success, balance } = await paykit.report({
  customerId: "user_123",
  featureId: "messages",
  amount: 1,
});
```

```ts
// Typical server-side pattern
export async function POST(request: Request) {
  const { allowed } = await paykit.check({
    customerId: userId,
    featureId: "messages",
  });

  if (!allowed) {
    return Response.json({ error: "Usage limit reached" }, { status: 403 });
  }

  const response = await generateChatResponse(input);

  await paykit.report({
    customerId: userId,
    featureId: "messages",
    amount: 1,
  });

  return Response.json(response);
}
```

- [ ] **Step 1:** Write the full page content in `entitlements.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 5: Concepts, Webhook Events

**Files:**

- Modify: `landing/content/docs/concepts/webhook-events.mdx`

**Context:** How PayKit handles provider webhooks and exposes app-level events. Two layers: (1) normalized webhook events from the provider, and (2) app-level events via the `on` option.

**Content outline:**

1. Opening paragraph: PayKit handles webhooks from your payment provider automatically. It verifies signatures, normalizes events, syncs local billing state, and then fires your application handlers.
2. **How it works.** Provider sends webhook, PayKit verifies the signature, normalizes it to an internal event, applies state changes (subscription, invoice, payment method updates), then fires your `on` handlers.
3. **App-level events.** The `on` option on `createPayKit`. Currently one event: `customer.updated`.
4. **`customer.updated`.** Fires after any subscription or entitlement change. Payload: `{ customerId, subscriptions }`.
5. **Wildcard handler.** `"*"` catches all events.
6. **Webhook route.** Already set up via the request handler (reference installation page).
7. **Idempotency.** Webhooks are recorded and processed idempotently. Duplicate provider events are skipped.
8. **Callout:** You don't need to manually handle Stripe webhook events. PayKit processes them internally and keeps your local billing state in sync.

```ts
export const paykit = createPayKit({
  // ...
  on: {
    "customer.updated": ({ payload }) => {
      console.log("Billing changed for", payload.customerId);
      console.log("Subscriptions:", payload.subscriptions);

      // Common use cases:
      // - Invalidate cached entitlements
      // - Send notification emails
      // - Update your app's access control
    },
  },
});
```

```ts
// Wildcard handler, catches all PayKit events
export const paykit = createPayKit({
  // ...
  on: {
    "*": ({ event }) => {
      console.log(event.name, event.payload);
    },
  },
});
```

- [ ] **Step 1:** Write the full page content in `webhook-events.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 6: Concepts, Database

**Files:**

- Modify: `landing/content/docs/concepts/database.mdx`

**Context:** PayKit stores billing state locally in PostgreSQL tables prefixed with `paykit_`. This page covers configuration, what's stored, and the push workflow.

**Content outline:**

1. Opening paragraph: PayKit uses your app's PostgreSQL database to store billing state locally. This means entitlement checks are fast local queries, not provider API calls.
2. **Configuration.** Pass a `pg.Pool` or a connection string to `createPayKit({ database })`.
3. **Tables.** PayKit creates tables prefixed with `paykit_`. Key tables: `customer`, `subscription`, `entitlement`, `product`, `feature`, `invoice`, `payment_method`, `webhook_event`. These are managed by PayKit, don't modify them directly.
4. **Migrations.** `paykitjs push` applies pending migrations. Run it on setup and whenever you change plan configuration.
5. **What's synced.** Subscriptions, invoices, payment methods, and customer-provider mappings are synced from webhooks. Plans and features are synced from your code config via `push`.
6. **Callout:** PayKit owns these tables. Don't write to them directly, use the PayKit API.

```ts
import { Pool } from "pg";

export const paykit = createPayKit({
  // Pass a pg.Pool
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  // ...
});
```

```ts
// Or pass a connection string directly
export const paykit = createPayKit({
  database: process.env.DATABASE_URL,
  // ...
});
```

- [ ] **Step 1:** Write the full page content in `database.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 7: Concepts, Payment Providers

**Files:**

- Modify: `landing/content/docs/concepts/payment-providers.mdx`

**Context:** The provider abstraction layer. Currently Stripe-only, but the architecture supports multiple providers.

**Content outline:**

1. Opening paragraph: PayKit uses a provider abstraction to communicate with payment processors. Your app works with plans, customers, and subscriptions. PayKit translates those to provider-native operations.
2. **How it works.** You install a provider adapter package and pass it to `createPayKit({ provider })`. The adapter handles all provider-specific API calls, webhook normalization, and product syncing.
3. **Stripe.** Currently the primary supported provider. Brief setup example, link to the Stripe provider page for details.
4. **Provider-native IDs stay internal.** Your app uses its own customer IDs and plan IDs. PayKit maps them to Stripe customer IDs, product IDs, and price IDs internally.
5. **Future providers.** Callout mentioning planned support for other providers (link to their respective pages).

```ts
import { stripe } from "@paykitjs/stripe";

export const paykit = createPayKit({
  // ...
  provider: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),
});
```

- [ ] **Step 1:** Write the full page content in `payment-providers.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 8: Concepts, Plugins

**Files:**

- Modify: `landing/content/docs/concepts/plugins.mdx`

**Context:** Plugins extend PayKit with additional endpoints. The main example is the `@paykitjs/dash` dashboard plugin.

**Content outline:**

1. Opening paragraph: Plugins extend PayKit by adding endpoints to its HTTP router. They're optional, and core PayKit works without any plugins.
2. **Using a plugin.** Install the package, pass to `createPayKit({ plugins: [...] })`.
3. **Dashboard plugin.** `@paykitjs/dash` adds an embedded billing dashboard. Install, configure, optionally add `authorize` for access control.
4. **Plugin interface.** A plugin is an object with `id` and optional `endpoints`. Endpoints are mounted under the PayKit base path.

```ts
import { dash } from "@paykitjs/dash";

export const paykit = createPayKit({
  // ...
  plugins: [
    dash({
      authorize: async (request) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session) throw new Error("Not authenticated");
      },
    }),
  ],
});
```

- [ ] **Step 1:** Write the full page content in `plugins.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 9: Concepts, Client

**Files:**

- Modify: `landing/content/docs/concepts/client.mdx`

**Context:** The client SDK (`createPayKitClient`) for browser-side usage. Type-safe, auto-infers methods from the server instance.

**Content outline:**

1. Opening paragraph: The PayKit client SDK lets you call billing operations from the browser. It's fully type-safe, and methods and their inputs are inferred from your server instance.
2. **Setup.** `createPayKitClient<typeof paykit>()`. Requires `identify` on the server for customer resolution.
3. **Available methods.** `subscribe`, `customerPortal`. No `customerId` needed since it's resolved from the request via `identify`.
4. **`subscribe`.** Same as server but without `customerId`. Returns `{ paymentUrl }`.
5. **`customerPortal`.** Opens the provider's customer portal. Returns `{ url }`.
6. **Custom base URL.** `createPayKitClient({ baseURL: "/custom/api" })` if you changed `basePath`.
7. **Type safety.** The client infers available plan IDs from the server instance type.

```ts
import { createPayKitClient } from "paykitjs/client";
import type { paykit } from "@/server/paykit";

export const paykitClient = createPayKitClient<typeof paykit>();
```

```tsx
// Subscribe from a React component
<Button
  onClick={async () => {
    const { paymentUrl } = await paykitClient.subscribe({
      planId: "pro", // type-safe, only valid plan IDs accepted
    });
    if (paymentUrl) {
      window.location.href = paymentUrl;
    }
  }}
>
  Upgrade to Pro
</Button>
```

```ts
// Open customer billing portal
const { url } = await paykitClient.customerPortal({
  returnUrl: window.location.href,
});
window.location.href = url;
```

- [ ] **Step 1:** Write the full page content in `client.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 10: Concepts, CLI

**Files:**

- Modify: `landing/content/docs/concepts/cli.mdx`

**Context:** The `paykitjs` CLI tool. Commands: `init`, `push`, `check`, `telemetry`.

**Content outline:**

1. Opening paragraph: PayKit includes a CLI tool for project setup, database migrations, and plan syncing.
2. **`paykitjs init`.** Interactive setup wizard. Scaffolds config file, plans, route handler, and optional client. Prompts for provider selection.
3. **`paykitjs push`.** Applies database migrations and syncs plan definitions to the database and provider. Run on initial setup and after changing plans.
4. **`paykitjs check`.** Validates configuration, database connection, migration status, provider connectivity, and sync status. Useful for CI or debugging.
5. **`paykitjs telemetry`.** Manage anonymous telemetry. Subcommands: `enable`, `disable`, `status`. Respects `PAYKIT_TELEMETRY_DISABLED` and `DO_NOT_TRACK` env vars.

All commands shown with `<PackageRun>` component.

- [ ] **Step 1:** Write the full page content in `cli.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 11: Concepts, TypeScript

**Files:**

- Modify: `landing/content/docs/concepts/typescript.mdx`

**Context:** PayKit's type inference system. Plan IDs and feature IDs are inferred from the `plans` config, providing compile-time safety.

**Content outline:**

1. Opening paragraph: PayKit is built with TypeScript-first design. Plan IDs, feature IDs, and method inputs are inferred from your configuration, so you don't need manual type definitions.
2. **Inferred plan and feature IDs.** When you pass plans to `createPayKit`, all methods narrow their ID parameters to only accept valid values. Show `subscribe({ planId: "typo" })` failing.
3. **The `$infer` helper.** `paykit.$infer.planId` and `paykit.$infer.featureId` expose the inferred union types for use elsewhere in your app.
4. **Client type safety.** `createPayKitClient<typeof paykit>()` carries the server's types to the client. Plan IDs are validated on the client too.
5. **Module re-exports.** Plans can be passed as an array or as a module object (useful with `import * as plans`).

```ts
// Types are inferred from your plans
export const paykit = createPayKit({
  plans: [free, pro, ultra],
  // ...
});

// planId only accepts "free" | "pro" | "ultra"
await paykit.subscribe({ customerId: "user_123", planId: "pro" });

// featureId only accepts "messages" | "pro_models" | "priority_support"
await paykit.check({ customerId: "user_123", featureId: "messages" });
```

```ts
// Use $infer to reference the types elsewhere
type PlanId = typeof paykit.$infer.planId;
// => "free" | "pro" | "ultra"

type FeatureId = typeof paykit.$infer.featureId;
// => "messages" | "pro_models" | "priority_support"
```

```ts
// Client inherits server types
import type { paykit } from "@/server/paykit";

const client = createPayKitClient<typeof paykit>();
await client.subscribe({ planId: "pro" }); // ✓ type-safe
```

- [ ] **Step 1:** Write the full page content in `typescript.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 12: Flows, Subscription Billing

**Files:**

- Modify: `landing/content/docs/flows/subscription-billing.mdx`

**Context:** End-to-end walkthrough of a complete subscription billing flow. This is a "how to" page that ties together concepts from plans, customers, subscriptions, and events.

**Content outline:**

1. Opening paragraph: This guide walks through a complete subscription billing flow, from defining plans to handling upgrades and cancellations.
2. **Step 1: Define plans.** Quick recap, link to plans-and-features.
3. **Step 2: Create a customer.** Server-side `upsertCustomer` or client-side via `identify`. Customer gets default free plan automatically.
4. **Step 3: Subscribe to a paid plan.** Show both server and client (Tabs). Handle the `paymentUrl` redirect for checkout.
5. **Step 4: Handle the webhook.** After checkout, PayKit receives the webhook, syncs the subscription, fires `customer.updated`.
6. **Step 5: Check entitlements.** Use `check()` to gate features.
7. **Step 6: Upgrade.** Call `subscribe()` with a higher plan. Immediate switch.
8. **Step 7: Downgrade.** Call `subscribe()` with a lower plan. Scheduled for period end.
9. **Step 8: Cancel.** Subscribe to the default free plan. Same scheduled behavior.
10. **Step 9: Listen to changes.** Use the `on` handler to react.

Each step has a focused code example. This page should read like a tutorial.

- [ ] **Step 1:** Write the full page content in `subscription-billing.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 13: Flows, Metered Usage

**Files:**

- Modify: `landing/content/docs/flows/metered-usage.mdx`

**Context:** End-to-end walkthrough of implementing usage-based billing with metered features.

**Content outline:**

1. Opening paragraph: This guide walks through implementing usage-based billing, covering how to define metered features, check balances, report consumption, and handle resets.
2. **Step 1: Define a metered feature.** `feature({ id: "messages", type: "metered" })` with `limit` and `reset`.
3. **Step 2: Include in plans with different limits.** Free: 100/month, Pro: 2000/month.
4. **Step 3: Check before consuming.** `check()` returns `allowed` and `balance`.
5. **Step 4: Perform the action.** Only if allowed.
6. **Step 5: Report usage.** `report()` with amount. Show error handling for insufficient balance.
7. **Step 6: Balance resets.** Explain lazy reset behavior. When the reset period passes, the next `check` or `report` automatically resets.
8. **Complete example.** Full API route handler (AI chat example).
9. **Callout:** Boolean features vs metered. If you just need on/off access, use `boolean` type instead.

- [ ] **Step 1:** Write the full page content in `metered-usage.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly

---

### Task 14: Providers, Stripe

**Files:**

- Modify: `landing/content/docs/providers/stripe.mdx`

**Context:** Stripe provider configuration page. How to set up the `@paykitjs/stripe` adapter, required env vars, webhook setup.

**Content outline:**

1. Opening paragraph: Stripe is PayKit's primary payment provider. The `@paykitjs/stripe` adapter handles all Stripe API interactions, webhook processing, and product syncing.
2. **Installation.** `<PackageInstall package="@paykitjs/stripe" />`
3. **Configuration.** `stripe({ secretKey, webhookSecret })`. Options: `currency` (default: USD).
4. **Environment variables.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. How to get them from Stripe Dashboard.
5. **Webhook setup.** In Stripe Dashboard, create a webhook endpoint pointing to `https://your-app.com/paykit/api/webhook`. Events to listen for (or just select all).
6. **Local development.** Use Stripe CLI: `stripe listen --forward-to localhost:3000/paykit/api/webhook`. The CLI prints the webhook secret.
7. **Product syncing.** `paykitjs push` creates/updates Stripe products and prices to match your plan definitions. You don't need to touch the Stripe Dashboard.
8. **Customer portal.** PayKit can open Stripe's customer portal for managing payment methods and invoices via `customerPortal()`.
9. **Testing mode.** Enable `testing: { enabled: true }` for test clock support during development.

```ts
import { stripe } from "@paykitjs/stripe";
import { createPayKit } from "paykitjs";

export const paykit = createPayKit({
  // ...
  provider: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),
});
```

Stripe CLI for local dev:

```bash
stripe listen --forward-to localhost:3000/paykit/api/webhook
```

- [ ] **Step 1:** Write the full page content in `stripe.mdx`
- [ ] **Step 2:** Verify the dev server renders correctly
