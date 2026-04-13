# Payment Provider Adapter Layer

## Problem

PayKit is hardcoded to Stripe. The `StripeRuntime` interface, `ctx.stripe` context field, and `StripeProviderConfig` type all couple the core to a single provider. To support Polar, Paddle, LemonSqueezy, PayPal, and others, the core needs a generic provider abstraction.

## Decisions

- **One provider per PayKit instance.** Multi-provider (routing between Stripe and Polar in one app) is out of scope. If someone needs both, they create two PayKit instances.
- **Each provider is a separate `@paykitjs/*` package.** Keeps core lean, avoids SDK bloat, scales to many providers, enables community contributions.
- **No shared base config type.** Each provider function returns its own custom config shape. The only shared contract is the `PaymentProvider` interface that the adapter must implement.
- **Currency is hardcoded to USD.** Multi-currency is not supported. Remove `currency` from provider config.
- **Provider identification uses `id` + `name`.** `id` is lowercase (`"stripe"`), `name` is display name (`"Stripe"`). No `kind` field.
- **Capability design deferred to Polar implementation.** Flat vs namespaced vs capability sets will be decided when we hit real API divergence. For now, all 19 methods stay on one interface.
- **Two-phase rollout.** Phase 1: refactor to generic layer (Stripe only). Phase 2: implement Polar adapter (separate effort).

## Phase 1: Generic Payment Provider Layer

### Core Interface

Rename `StripeRuntime` to `PaymentProvider`. This is the contract every provider adapter must implement:

```ts
interface PaymentProvider {
  readonly id: string; // "stripe", "polar"
  readonly name: string; // "Stripe", "Polar"

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

### Context Changes

```ts
// Before
interface PayKitContext {
  provider: StripeProviderConfig;
  stripe: StripeRuntime;
}

// After
interface PayKitContext {
  provider: PaymentProvider;
}
```

The config (secret keys, etc.) is consumed by the adapter factory and does not need to live on context. Only the instantiated adapter is on `ctx`.

### Provider Config Pattern

Each provider package exports a factory function that returns its own config type. The config includes an `adapter` factory that core calls to instantiate the `PaymentProvider`:

```ts
// @paykitjs/stripe
export function stripe(options: { secretKey: string; webhookSecret: string }): {
  id: "stripe";
  name: "Stripe";
  createAdapter(): PaymentProvider;
};

// @paykitjs/polar (future)
export function polar(options: { accessToken: string; webhookSecret: string }): {
  id: "polar";
  name: "Polar";
  createAdapter(): PaymentProvider;
};
```

Core calls `config.createAdapter()` during context creation. The returned `PaymentProvider` is what goes on `ctx.provider`.

### Files Changed

**Core (`packages/paykit`):**

| File                                           | Change                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/provider.ts`                    | Rename `StripeRuntime` → `PaymentProvider`. Remove `StripeProviderConfig`, `StripeProviderOptions`. Keep all `Provider*` normalized types. Remove `currency` references.                                                                                 |
| `src/providers/stripe.ts`                      | Move entirely to `@paykitjs/stripe` package. Core becomes provider-agnostic.                                                                                                                                                                             |
| `src/core/context.ts`                          | `ctx.stripe` → `ctx.provider`. Call `config.createAdapter()` instead of `createStripeRuntime()`. Remove `StripeProviderConfig` imports.                                                                                                                  |
| `src/subscription/subscription.service.ts`     | `ctx.stripe.*` → `ctx.provider.*` (8 call sites)                                                                                                                                                                                                         |
| `src/customer/customer.service.ts`             | `ctx.stripe.*` → `ctx.provider.*` (4 call sites)                                                                                                                                                                                                         |
| `src/payment-method/payment-method.service.ts` | `ctx.stripe.*` → `ctx.provider.*`                                                                                                                                                                                                                        |
| `src/webhook/webhook.service.ts`               | `ctx.stripe.*` → `ctx.provider.*`                                                                                                                                                                                                                        |
| `src/product/product-sync.service.ts`          | `ctx.stripe.*` → `ctx.provider.*`                                                                                                                                                                                                                        |
| `src/testing/testing.service.ts`               | `ctx.stripe.*` → `ctx.provider.*`                                                                                                                                                                                                                        |
| `src/types/options.ts`                         | Replace `PayKitProvider = StripeProviderConfig` with `PayKitProvider = { id: string; name: string; createAdapter(): PaymentProvider }`. This is the minimal contract core needs — provider packages can extend it with whatever custom fields they want. |
| `src/index.ts`                                 | Update exports: remove Stripe-specific types, export `PaymentProvider`                                                                                                                                                                                   |

**Stripe package (`packages/stripe`):**

| File                     | Change                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stripe-provider.ts` | Absorb `providers/stripe.ts` from core. Implement `PaymentProvider` interface. Export `stripe()` factory that returns config with `createAdapter()`. |

### Normalized Types (unchanged)

These types stay exactly as they are — they're already provider-agnostic:

- `ProviderCustomer`
- `ProviderSubscription`
- `ProviderSubscriptionResult`
- `ProviderInvoice`
- `ProviderPaymentMethod`
- `ProviderTestClock`
- `ProviderRequiredAction`
- `NormalizedWebhookEvent` / `NormalizedWebhookEventMap`
- `WebhookApplyAction`

### What Doesn't Change

- Database schema — untouched
- User-facing API (`subscribe()`, `check()`, `handleWebhook()`, etc.) — untouched
- Webhook event types — untouched
- Plan/feature/entitlement system — untouched
- CLI — untouched
- Dashboard package — untouched

### User-Facing DX

Stays nearly identical:

```ts
// Before
import { stripe } from "@paykitjs/stripe";
const paykit = createPayKit({
  provider: stripe({ secretKey: "...", webhookSecret: "..." }),
  // ...
});

// After — same thing, just works with any provider
import { stripe } from "@paykitjs/stripe";
const paykit = createPayKit({
  provider: stripe({ secretKey: "...", webhookSecret: "..." }),
  // ...
});
```

## Phase 2: Polar Adapter (separate effort)

- New `packages/polar` → `@paykitjs/polar`
- Implements `PaymentProvider` against Polar's API
- Polar is built on Stripe, so high interface overlap expected
- Capability design (flat vs namespaced, optional methods) will be decided here based on real API differences
- May trigger refinements to the `PaymentProvider` interface

## Out of Scope

- Multi-currency support
- Multi-provider per instance
- One-off purchases (until that feature is implemented)
- Capability/feature detection system (deferred to Phase 2)
