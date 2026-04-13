# Payment Provider Adapter Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PayKit's provider layer pluggable by replacing the hardcoded Stripe integration with a generic `PaymentProvider` interface, enabling future provider adapters (Polar, Paddle, etc.).

**Architecture:** Rename `StripeRuntime` → `PaymentProvider` interface in core. Move Stripe SDK implementation from core into `@paykitjs/stripe`. Update context to call a provider factory (`createAdapter()`) instead of directly instantiating the Stripe SDK. Replace all `ctx.stripe.*` calls with `ctx.provider.*`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Turbo

---

## File Structure

### Core (`packages/paykit/src`)

| File                                   | Action | Responsibility                                                                                                                                                              |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers/provider.ts`                | Modify | Rename `StripeRuntime` → `PaymentProvider`. Remove `StripeProviderConfig`, `StripeProviderOptions`. Add `PayKitProviderConfig` type. Keep all `Provider*` normalized types. |
| `providers/stripe.ts`                  | Delete | Entire Stripe implementation moves to `@paykitjs/stripe`.                                                                                                                   |
| `core/context.ts`                      | Modify | Replace `StripeProviderConfig`/`StripeRuntime` with `PaymentProvider`/`PayKitProviderConfig`. Call `config.createAdapter()`.                                                |
| `core/__tests__/context.test.ts`       | Modify | Update mocks and types to match new interface.                                                                                                                              |
| `types/options.ts`                     | Modify | Replace `StripeProviderConfig` with `PayKitProviderConfig`.                                                                                                                 |
| `index.ts`                             | Modify | Remove `StripeProviderConfig`/`StripeProviderOptions` exports. Add `PaymentProvider`/`PayKitProviderConfig` exports.                                                        |
| `subscription/subscription.service.ts` | Modify | `ctx.stripe.*` → `ctx.provider.*` (8 call sites).                                                                                                                           |
| `customer/customer.service.ts`         | Modify | `ctx.stripe.*` → `ctx.provider.*` (4 call sites).                                                                                                                           |
| `webhook/webhook.service.ts`           | Modify | `ctx.stripe.*` → `ctx.provider.*` (1 call site).                                                                                                                            |
| `product/product-sync.service.ts`      | Modify | `ctx.stripe.*` → `ctx.provider.*` (1 call site).                                                                                                                            |
| `testing/testing.service.ts`           | Modify | `ctx.stripe.*` → `ctx.provider.*` (2 call sites).                                                                                                                           |
| `package.json`                         | Modify | Remove `stripe` from dependencies.                                                                                                                                          |

### Stripe package (`packages/stripe/src`)

| File                       | Action  | Responsibility                                                                                                  |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `stripe-provider.ts`       | Rewrite | Absorb full Stripe implementation from core. Export `stripe()` factory returning config with `createAdapter()`. |
| `index.ts`                 | Modify  | Update re-exports.                                                                                              |
| `__tests__/stripe.test.ts` | Move    | Move from core's `providers/__tests__/stripe.test.ts`.                                                          |
| `package.json`             | Modify  | Add `stripe` SDK dependency (moved from core).                                                                  |

---

### Task 1: Define PaymentProvider interface and PayKitProviderConfig

**Files:**

- Modify: `packages/paykit/src/providers/provider.ts`

- [ ] **Step 1: Rename StripeRuntime to PaymentProvider and add id/name**

In `packages/paykit/src/providers/provider.ts`, rename the `StripeRuntime` interface to `PaymentProvider` and add `id`/`name` readonly fields:

```ts
export interface PaymentProvider {
  readonly id: string;
  readonly name: string;

  upsertCustomer(data: {
    createTestClock?: boolean;
    id: string;
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ providerCustomer: ProviderCustomer }>;

  deleteCustomer(data: { providerCustomerId: string }): Promise<void>;

  getTestClock(data: { testClockId: string }): Promise<ProviderTestClock>;

  advanceTestClock(data: { testClockId: string; frozenTime: Date }): Promise<ProviderTestClock>;

  attachPaymentMethod(data: {
    providerCustomerId: string;
    returnURL: string;
  }): Promise<{ url: string }>;

  createSubscriptionCheckout(data: {
    providerCustomerId: string;
    providerPriceId: string;
    successUrl: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<{ paymentUrl: string; providerCheckoutSessionId: string }>;

  createSubscription(data: {
    providerCustomerId: string;
    providerPriceId: string;
  }): Promise<ProviderSubscriptionResult>;

  updateSubscription(data: {
    providerPriceId: string;
    providerSubscriptionId: string;
  }): Promise<ProviderSubscriptionResult>;

  createInvoice(data: {
    providerCustomerId: string;
    lines: Array<{ amount: number; description: string }>;
    autoAdvance?: boolean;
  }): Promise<ProviderInvoice>;

  scheduleSubscriptionChange(data: {
    providerPriceId?: string | null;
    providerSubscriptionScheduleId?: string | null;
    providerSubscriptionId: string;
  }): Promise<ProviderSubscriptionResult>;

  cancelSubscription(data: {
    currentPeriodEndAt?: Date | null;
    providerSubscriptionId: string;
    providerSubscriptionScheduleId?: string | null;
  }): Promise<ProviderSubscriptionResult>;

  listActiveSubscriptions(data: {
    providerCustomerId: string;
  }): Promise<Array<{ providerSubscriptionId: string }>>;

  resumeSubscription(data: {
    providerSubscriptionId: string;
    providerSubscriptionScheduleId?: string | null;
  }): Promise<ProviderSubscriptionResult>;

  detachPaymentMethod(data: { providerMethodId: string }): Promise<void>;

  syncProduct(data: {
    id: string;
    name: string;
    priceAmount: number;
    priceInterval?: string | null;
    existingProviderProductId?: string | null;
    existingProviderPriceId?: string | null;
  }): Promise<{ providerProductId: string; providerPriceId: string }>;

  handleWebhook(data: {
    body: string;
    headers: Record<string, string>;
  }): Promise<NormalizedWebhookEvent[]>;

  createPortalSession(data: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}
```

- [ ] **Step 2: Replace StripeProviderConfig/Options with PayKitProviderConfig**

Remove `StripeProviderOptions`, `StripeProviderConfig`, and the `PayKitProvider` type alias. Replace with:

```ts
export interface PayKitProviderConfig {
  id: string;
  name: string;
  createAdapter(): PaymentProvider;
}
```

The final `provider.ts` file should export:

- `ProviderCustomer`, `ProviderCustomerMap`, `ProviderTestClock`, `ProviderPaymentMethod`, `ProviderInvoice`, `ProviderRequiredAction`, `ProviderSubscription`, `ProviderSubscriptionResult` (all unchanged)
- `PaymentProvider` (renamed from `StripeRuntime`)
- `PayKitProviderConfig` (replaces `StripeProviderConfig`)

Remove the `currency` field entirely — it was on `StripeProviderOptions` which no longer exists in core.

- [ ] **Step 3: Verify the file compiles**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm typecheck 2>&1 | head -50`

Expected: Type errors in downstream files that still reference `StripeRuntime`/`StripeProviderConfig`/`ctx.stripe` — this is correct, we fix those next.

---

### Task 2: Update context to use PaymentProvider

**Files:**

- Modify: `packages/paykit/src/core/context.ts`
- Modify: `packages/paykit/src/types/options.ts`

- [ ] **Step 1: Update options.ts**

Replace the `StripeProviderConfig` import and usage in `packages/paykit/src/types/options.ts`:

```ts
import type { PayKitProviderConfig } from "../providers/provider";
```

Change the `provider` field type:

```ts
provider: PayKitProviderConfig;
```

- [ ] **Step 2: Update context.ts**

Replace `packages/paykit/src/core/context.ts` with:

```ts
import { Pool } from "pg";

import { createDatabase, type PayKitDatabase } from "../database/index";
import type { PayKitProviderConfig, PaymentProvider } from "../providers/provider";
import type { PayKitOptions } from "../types/options";
import { normalizeSchema, type NormalizedSchema } from "../types/schema";
import { PayKitError, PAYKIT_ERROR_CODES } from "./errors";
import { createPayKitLogger, type PayKitInternalLogger } from "./logger";

export interface PayKitContext {
  options: PayKitOptions;
  database: PayKitDatabase;
  provider: PaymentProvider;
  plans: NormalizedSchema;
  logger: PayKitInternalLogger;
}

export async function createContext(options: PayKitOptions): Promise<PayKitContext> {
  if (!options.provider) {
    throw PayKitError.from("BAD_REQUEST", PAYKIT_ERROR_CODES.PROVIDER_REQUIRED);
  }

  if (options.basePath && !options.basePath.startsWith("/")) {
    throw PayKitError.from(
      "BAD_REQUEST",
      PAYKIT_ERROR_CODES.BASEPATH_INVALID,
      `basePath must start with "/", received "${options.basePath}"`,
    );
  }

  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;
  const database = await createDatabase(pool);
  const provider = options.provider.createAdapter();

  return {
    options,
    database,
    provider,
    plans: normalizeSchema(options.plans),
    logger: createPayKitLogger(options.logging),
  };
}
```

Key changes:

- `PayKitContext.provider` is now `PaymentProvider` (the adapter instance, not the config)
- Removed `stripe` field from context
- Calls `options.provider.createAdapter()` instead of `createStripeRuntime()`
- Removed import of `createStripeRuntime`

---

### Task 3: Rename ctx.stripe to ctx.provider in all service files

**Files:**

- Modify: `packages/paykit/src/subscription/subscription.service.ts`
- Modify: `packages/paykit/src/customer/customer.service.ts`
- Modify: `packages/paykit/src/webhook/webhook.service.ts`
- Modify: `packages/paykit/src/product/product-sync.service.ts`
- Modify: `packages/paykit/src/testing/testing.service.ts`

- [ ] **Step 1: Update subscription.service.ts**

Replace all 8 occurrences of `ctx.stripe.` with `ctx.provider.` in `packages/paykit/src/subscription/subscription.service.ts`:

| Line | Before                                  | After                                     |
| ---- | --------------------------------------- | ----------------------------------------- |
| 225  | `ctx.stripe.cancelSubscription`         | `ctx.provider.cancelSubscription`         |
| 721  | `ctx.stripe.resumeSubscription`         | `ctx.provider.resumeSubscription`         |
| 782  | `ctx.stripe.createSubscription`         | `ctx.provider.createSubscription`         |
| 839  | `ctx.stripe.createSubscription`         | `ctx.provider.createSubscription`         |
| 881  | `ctx.stripe.cancelSubscription`         | `ctx.provider.cancelSubscription`         |
| 934  | `ctx.stripe.scheduleSubscriptionChange` | `ctx.provider.scheduleSubscriptionChange` |
| 991  | `ctx.stripe.updateSubscription`         | `ctx.provider.updateSubscription`         |
| 1028 | `ctx.stripe.createSubscriptionCheckout` | `ctx.provider.createSubscriptionCheckout` |

Also rename the local variable `stripeResult` → `providerResult` at lines 721, 782, 839, 881, 934, 991 (and all their usages within the same function scope).

- [ ] **Step 2: Update customer.service.ts**

Replace all 4 occurrences of `ctx.stripe.` with `ctx.provider.` in `packages/paykit/src/customer/customer.service.ts`:

| Line | Before                               | After                                  |
| ---- | ------------------------------------ | -------------------------------------- |
| 387  | `ctx.stripe.upsertCustomer`          | `ctx.provider.upsertCustomer`          |
| 442  | `ctx.stripe.listActiveSubscriptions` | `ctx.provider.listActiveSubscriptions` |
| 446  | `ctx.stripe.cancelSubscription`      | `ctx.provider.cancelSubscription`      |
| 450  | `ctx.stripe.deleteCustomer`          | `ctx.provider.deleteCustomer`          |

Also update the error log message at line 452 from `"failed to clean up Stripe customer"` to `"failed to clean up provider customer"`.

- [ ] **Step 3: Update webhook.service.ts**

Replace the 1 occurrence of `ctx.stripe.` with `ctx.provider.` in `packages/paykit/src/webhook/webhook.service.ts`:

| Line | Before                     | After                        |
| ---- | -------------------------- | ---------------------------- |
| 214  | `ctx.stripe.handleWebhook` | `ctx.provider.handleWebhook` |

- [ ] **Step 4: Update product-sync.service.ts**

Replace the 1 occurrence of `ctx.stripe.` with `ctx.provider.` in `packages/paykit/src/product/product-sync.service.ts`:

| Line | Before                   | After                      |
| ---- | ------------------------ | -------------------------- |
| 156  | `ctx.stripe.syncProduct` | `ctx.provider.syncProduct` |

Also rename `providerResult` is already the variable name here, so no variable rename needed.

- [ ] **Step 5: Update testing.service.ts**

Replace the 2 occurrences of `ctx.stripe.` with `ctx.provider.` in `packages/paykit/src/testing/testing.service.ts`:

| Line | Before                        | After                           |
| ---- | ----------------------------- | ------------------------------- |
| 28   | `ctx.stripe.getTestClock`     | `ctx.provider.getTestClock`     |
| 68   | `ctx.stripe.advanceTestClock` | `ctx.provider.advanceTestClock` |

- [ ] **Step 6: Verify no remaining ctx.stripe references**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && grep -r "ctx\.stripe" packages/paykit/src/ --include="*.ts" | grep -v "__tests__" | grep -v "node_modules"`

Expected: No output (zero matches).

---

### Task 4: Move Stripe implementation to @paykitjs/stripe

**Files:**

- Delete: `packages/paykit/src/providers/stripe.ts`
- Delete: `packages/paykit/src/providers/__tests__/stripe.test.ts`
- Rewrite: `packages/stripe/src/stripe-provider.ts`
- Modify: `packages/stripe/src/index.ts`
- Create: `packages/stripe/src/__tests__/stripe.test.ts`

- [ ] **Step 1: Copy stripe.ts to @paykitjs/stripe and adapt**

Copy the contents of `packages/paykit/src/providers/stripe.ts` (897 lines) into `packages/stripe/src/stripe-provider.ts`.

Update imports to reference `paykitjs` instead of relative paths:

```ts
// Before (in core)
import { PayKitError, PAYKIT_ERROR_CODES } from "../core/errors";
import type { NormalizedWebhookEvent } from "../types/events";
import type { ProviderTestClock, StripeProviderConfig, StripeRuntime } from "./provider";

// After (in @paykitjs/stripe)
import { PayKitError, PAYKIT_ERROR_CODES } from "paykitjs";
import type { NormalizedWebhookEvent, PaymentProvider, ProviderTestClock } from "paykitjs";
```

Replace all references to `StripeRuntime` with `PaymentProvider` and `StripeProviderConfig` with a local `StripeOptions` interface:

```ts
export interface StripeOptions {
  secretKey: string;
  webhookSecret: string;
}
```

Update `createStripeProvider` to return `PaymentProvider` (adding `id` and `name` to the returned object):

```ts
export function createStripeProvider(client: StripeSdk, options: StripeOptions): PaymentProvider {
  return {
    id: "stripe",
    name: "Stripe",
    // ... all existing methods unchanged
  };
}
```

Remove `createStripeRuntime` — it gets replaced by the factory in the `stripe()` function.

Replace the old `assertStripeTestKey` references from `StripeProviderConfig` to `StripeOptions`.

- [ ] **Step 2: Update the stripe() factory function**

In `packages/stripe/src/stripe-provider.ts`, update the `stripe()` export:

```ts
import type { PayKitProviderConfig, PaymentProvider } from "paykitjs";
import StripeSdk from "stripe";

export function stripe(options: StripeOptions): PayKitProviderConfig {
  return {
    id: "stripe",
    name: "Stripe",
    createAdapter(): PaymentProvider {
      return createStripeProvider(new StripeSdk(options.secretKey), options);
    },
  };
}
```

- [ ] **Step 3: Update index.ts exports**

Update `packages/stripe/src/index.ts`:

```ts
export { stripe } from "./stripe-provider";
export type { StripeOptions } from "./stripe-provider";
```

- [ ] **Step 4: Move the stripe test**

Move `packages/paykit/src/providers/__tests__/stripe.test.ts` to `packages/stripe/src/__tests__/stripe.test.ts`.

Update imports:

```ts
// Before
import { PAYKIT_ERROR_CODES } from "../../core/errors";
import { createStripeProvider } from "../stripe";

// After
import { PAYKIT_ERROR_CODES } from "paykitjs";
import { createStripeProvider } from "../stripe-provider";
```

Update the test provider config objects to remove `kind` field and use the new `StripeOptions` shape (just `secretKey` + `webhookSecret`, no `id`/`kind`/`currency`).

- [ ] **Step 5: Delete the old files from core**

Delete:

- `packages/paykit/src/providers/stripe.ts`
- `packages/paykit/src/providers/__tests__/stripe.test.ts`

- [ ] **Step 6: Update package.json dependencies**

In `packages/paykit/package.json`, remove the `"stripe"` dependency:

```diff
-    "stripe": "^19.1.0",
```

In `packages/stripe/package.json`, add the `"stripe"` dependency:

```json
"dependencies": {
  "paykitjs": "workspace:*",
  "stripe": "^19.1.0"
}
```

---

### Task 5: Update core exports

**Files:**

- Modify: `packages/paykit/src/index.ts`

- [ ] **Step 1: Update index.ts exports**

In `packages/paykit/src/index.ts`, update the provider exports block:

```ts
// Before
export type {
  ProviderCustomer,
  ProviderCustomerMap,
  PayKitProvider,
  ProviderTestClock,
  StripeProviderConfig,
  StripeProviderOptions,
} from "./providers/provider";

// After
export type {
  PayKitProviderConfig,
  PaymentProvider,
  ProviderCustomer,
  ProviderCustomerMap,
  ProviderTestClock,
} from "./providers/provider";
```

---

### Task 6: Update tests

**Files:**

- Modify: `packages/paykit/src/core/__tests__/context.test.ts`

- [ ] **Step 1: Rewrite context.test.ts**

The test currently mocks `createStripeRuntime`. The new context calls `config.createAdapter()` on the provider config directly, so the test approach changes — no more module mock for the stripe provider.

```ts
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PayKitProviderConfig, PaymentProvider } from "../../providers/provider";

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  createPayKitLogger: vi.fn(),
}));

vi.mock("../../database/index", () => ({
  createDatabase: mocks.createDatabase,
}));

vi.mock("../logger", () => ({
  createPayKitLogger: mocks.createPayKitLogger,
}));

import { createContext } from "../context";

describe("core/context", () => {
  beforeEach(() => {
    mocks.createDatabase.mockReset();
    mocks.createPayKitLogger.mockReset();
    mocks.createDatabase.mockResolvedValue({ kind: "database" });
    mocks.createPayKitLogger.mockReturnValue({ kind: "logger" });
  });

  it("passes logging options into the logger factory", async () => {
    const logging = {
      level: "debug",
    } as const;
    const database = {} as Pool;
    const adapter = { id: "test", name: "Test" } as unknown as PaymentProvider;
    const provider: PayKitProviderConfig = {
      id: "test",
      name: "Test",
      createAdapter: () => adapter,
    };

    const context = await createContext({
      database,
      logging,
      provider,
    });

    expect(mocks.createDatabase).toHaveBeenCalledWith(database);
    expect(mocks.createPayKitLogger).toHaveBeenCalledWith(logging);
    expect(context.logger).toEqual({ kind: "logger" });
    expect(context.provider).toBe(adapter);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm vitest run 2>&1 | tail -30`

Expected: All tests pass.

---

### Task 7: Verify everything builds and passes

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm typecheck 2>&1`

Expected: No type errors.

- [ ] **Step 2: Run lint**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm lint 2>&1`

Expected: No lint errors.

- [ ] **Step 3: Run build**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm build 2>&1`

Expected: Builds successfully.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && pnpm vitest run 2>&1`

Expected: All tests pass.

- [ ] **Step 5: Verify no remaining Stripe references in core**

Run: `cd /Users/maxktz/.superset/worktrees/paykit/maxktz/provider-adapter-paykit-research && grep -rn "stripe\|Stripe" packages/paykit/src/ --include="*.ts" | grep -v "node_modules" | grep -v "__tests__"`

Expected: Zero matches. Core should have no Stripe references.
