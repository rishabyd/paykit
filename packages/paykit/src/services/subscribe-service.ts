import type { PayKitContext } from "../core/context";
import { PayKitError, PAYKIT_ERROR_CODES } from "../core/errors";
import type { ProviderSubscription } from "../providers/provider";
import type {
  BillingPlan,
  PayKitBillingPlan,
  StripeCheckoutAction,
  StripeExecutionResult,
  StripeBillingPlan,
  StripeSubscriptionAction,
} from "../types/billing-plan";
import { serializeBillingPlan } from "../types/billing-plan";
import type { NormalizedPlan } from "../types/schema";
import {
  buildSubscribeResult,
  clearScheduledSubscriptionsInGroup,
  createMetadata,
  deleteScheduledSubscriptionsInGroup,
  endSubscriptions,
  getActiveSubscriptionInGroup,
  getScheduledSubscriptionsInGroup,
  getSubscriptionByProviderSubscriptionId,
  insertSubscriptionRecord,
  linkMetadataToCheckoutSession,
  replaceSubscriptionSchedule,
  type SubscribeResult,
  type SubscriptionWithCatalog,
  scheduleSubscriptionCancellation,
  syncSubscriptionBillingState,
  syncSubscriptionFromProvider,
  upsertInvoiceRecord,
} from "./billing-service";
import { upsertProviderCustomer } from "./customer-service";
import { getDefaultPaymentMethod } from "./payment-method-service";
import type { StoredProductWithPrice } from "./product-service";
import { getDefaultProductInGroup, getLatestProductWithPrice } from "./product-service";

interface SubscribeInput {
  cancelUrl?: string;
  customerId: string;
  forceCheckout?: boolean;
  planId: string;
  prorationBehavior?: "always_invoice" | "none";
  successUrl: string;
}

interface SubscribeContext {
  customerId: string;
  providerId: string;
  normalizedPlan: NormalizedPlan;
  storedPlan: StoredProductWithPrice;
  providerCustomerId: string;
  defaultPaymentMethod: unknown;
  activeSubscription: SubscriptionWithCatalog | null;
  scheduledSubscriptions: readonly SubscriptionWithCatalog[];
  isFreeTarget: boolean;
  isPaidTarget: boolean;
  isUpgrade: boolean;
  shouldUseCheckout: boolean;
  trialDays: number | null;
  prorationBehavior: "always_invoice" | "none";
  successUrl: string;
  cancelUrl?: string;
}

export async function subscribeToPlan(
  ctx: PayKitContext,
  input: SubscribeInput,
): Promise<SubscribeResult> {
  return ctx.logger.trace.run("sub", async () => {
    const startTime = Date.now();
    ctx.logger.info({ planId: input.planId, customerId: input.customerId }, "subscribe started");

    const subCtx = await setupSubscribeContext(ctx, input);
    const paykitPlan = computeBillingPlan(subCtx);

    const action =
      paykitPlan.updateSubscription?.status === "ended"
        ? "switch"
        : paykitPlan.updateSubscription?.canceled
          ? subCtx.isFreeTarget
            ? "cancel-to-free"
            : "downgrade"
          : paykitPlan.insertSubscriptions.length > 0 && !paykitPlan.updateSubscription
            ? "new"
            : subCtx.isUpgrade
              ? "upgrade"
              : "resume";
    ctx.logger.info({ action }, "subscribe plan computed");

    const stripePlan = evaluateStripePlan(subCtx, paykitPlan);
    const billingPlan: BillingPlan = { paykit: paykitPlan, stripe: stripePlan };
    const result = await executeBillingPlan(ctx, subCtx, billingPlan);

    const duration = Date.now() - startTime;
    ctx.logger.info({ action, duration }, "subscribe completed");

    return result;
  });
}

async function setupSubscribeContext(
  ctx: PayKitContext,
  input: SubscribeInput,
): Promise<SubscribeContext> {
  const providerId = ctx.provider.id;
  const normalizedPlan = ctx.plans.plans.find((plan) => plan.id === input.planId);
  const storedPlan = await getLatestProductWithPrice(ctx.database, {
    id: input.planId,
    providerId,
  });

  if (!normalizedPlan || !storedPlan) {
    throw PayKitError.from(
      "NOT_FOUND",
      PAYKIT_ERROR_CODES.PLAN_NOT_FOUND,
      `Plan "${input.planId}" not found`,
    );
  }

  const isFreeTarget = storedPlan.priceAmount === null;
  const isPaidTarget = !isFreeTarget;

  if (isPaidTarget && !storedPlan.providerPriceId) {
    throw PayKitError.from(
      "BAD_REQUEST",
      PAYKIT_ERROR_CODES.PLAN_NOT_SYNCED,
      `Plan "${input.planId}" is not synced with provider`,
    );
  }

  const { providerCustomerId } = await upsertProviderCustomer(ctx, {
    customerId: input.customerId,
  });
  const defaultPaymentMethod = await getDefaultPaymentMethod(ctx.database, {
    customerId: input.customerId,
    providerId,
  });

  const activeSubscription = storedPlan.group
    ? await getActiveSubscriptionInGroup(ctx.database, {
        customerId: input.customerId,
        group: storedPlan.group,
      })
    : null;

  const scheduledSubscriptions = storedPlan.group
    ? await getScheduledSubscriptionsInGroup(ctx.database, {
        customerId: input.customerId,
        group: storedPlan.group,
      })
    : [];

  const hasProviderSubscription =
    activeSubscription?.providerData != null &&
    typeof (activeSubscription.providerData as Record<string, unknown>).subscriptionId === "string";

  const activeAmount = activeSubscription?.priceAmount ?? 0;
  const targetAmount = storedPlan.priceAmount ?? 0;
  const isUpgrade =
    activeSubscription != null && hasProviderSubscription && targetAmount > activeAmount;

  const shouldUseCheckout =
    isPaidTarget && (input.forceCheckout === true || defaultPaymentMethod == null);

  return {
    activeSubscription,
    cancelUrl: input.cancelUrl,
    customerId: input.customerId,
    defaultPaymentMethod,
    isFreeTarget,
    isPaidTarget,
    isUpgrade,
    normalizedPlan,
    prorationBehavior: input.prorationBehavior ?? "always_invoice",
    providerCustomerId,
    providerId,
    scheduledSubscriptions,
    shouldUseCheckout,
    storedPlan,
    successUrl: input.successUrl,
    trialDays: normalizedPlan.trialDays,
  };
}

function computeBillingPlan(subCtx: SubscribeContext): PayKitBillingPlan {
  const { activeSubscription, scheduledSubscriptions, storedPlan, normalizedPlan } = subCtx;
  const now = new Date();

  const hasProviderSubscription =
    activeSubscription?.providerData != null &&
    typeof (activeSubscription.providerData as Record<string, unknown>).subscriptionId === "string";

  const basePlan: PayKitBillingPlan = {
    clearScheduledInGroup: false,
    customerId: subCtx.customerId,
    deleteScheduledInGroup: false,
    group: storedPlan.group,
    insertSubscriptions: [],
    updateSubscription: null,
  };

  // --- No active subscription: fresh subscription ---
  if (!activeSubscription) {
    const status = subCtx.isFreeTarget
      ? "active"
      : subCtx.trialDays && subCtx.trialDays > 0
        ? "trialing"
        : "active";

    const trialEndsAt =
      subCtx.trialDays && subCtx.trialDays > 0
        ? new Date(now.getTime() + subCtx.trialDays * 24 * 60 * 60 * 1000)
        : null;

    return {
      ...basePlan,
      insertSubscriptions: [
        {
          customerId: subCtx.customerId,
          planFeatures: normalizedPlan.includes,
          productInternalId: storedPlan.internalId,
          providerId: subCtx.providerId,
          startedAt: now,
          status,
          trialEndsAt,
        },
      ],
    };
  }

  // --- Same plan: resume or noop ---
  if (activeSubscription.planId === storedPlan.id) {
    const hasPendingChange = scheduledSubscriptions.length > 0 || activeSubscription.canceled;

    if (!hasProviderSubscription || !hasPendingChange) {
      return basePlan; // noop
    }

    // Resume: clear cancellation + delete scheduled subscriptions
    return {
      ...basePlan,
      deleteScheduledInGroup: true,
      updateSubscription: {
        canceled: false,
        canceledAt: null,
        subscriptionId: activeSubscription.id,
        endedAt: null,
        scheduledProductId: null,
        status: activeSubscription.status,
      },
    };
  }

  // --- No provider subscription (free→paid or free→free transition) ---
  if (!hasProviderSubscription) {
    const status = subCtx.isFreeTarget
      ? "active"
      : subCtx.trialDays && subCtx.trialDays > 0
        ? "trialing"
        : "active";

    const trialEndsAt =
      subCtx.trialDays && subCtx.trialDays > 0
        ? new Date(now.getTime() + subCtx.trialDays * 24 * 60 * 60 * 1000)
        : null;

    return {
      ...basePlan,
      insertSubscriptions: [
        {
          customerId: subCtx.customerId,
          planFeatures: normalizedPlan.includes,
          productInternalId: storedPlan.internalId,
          providerId: subCtx.providerId,
          startedAt: now,
          status,
          trialEndsAt,
        },
      ],
      updateSubscription: {
        canceled: false,
        canceledAt: null,
        subscriptionId: activeSubscription.id,
        endedAt: now,
        status: "ended",
      },
    };
  }

  // --- Downgrade or cancel-to-free (schedule at period end) ---
  if (subCtx.isFreeTarget || !subCtx.isUpgrade) {
    const currentPeriodEndAt = activeSubscription.currentPeriodEndAt;

    return {
      ...basePlan,
      clearScheduledInGroup: true,
      insertSubscriptions: [
        {
          customerId: subCtx.customerId,
          planFeatures: normalizedPlan.includes,
          productInternalId: storedPlan.internalId,
          providerId: subCtx.providerId,
          startedAt: currentPeriodEndAt ?? null,
          status: "scheduled",
        },
      ],
      updateSubscription: {
        canceled: true,
        canceledAt: now,
        subscriptionId: activeSubscription.id,
        endedAt: currentPeriodEndAt ?? null,
        scheduledProductId: storedPlan.internalId,
        status: activeSubscription.status,
      },
    };
  }

  // --- Upgrade (immediate) ---
  return {
    ...basePlan,
    deleteScheduledInGroup: true,
    insertSubscriptions: [
      {
        customerId: subCtx.customerId,
        planFeatures: normalizedPlan.includes,
        productInternalId: storedPlan.internalId,
        providerId: subCtx.providerId,
        startedAt: now,
        status: "active",
      },
    ],
    updateSubscription: {
      canceled: false,
      canceledAt: null,
      subscriptionId: activeSubscription.id,
      endedAt: now,
      status: "ended",
    },
  };
}

function getProviderSubId(sub: SubscriptionWithCatalog): string {
  return (sub.providerData as Record<string, unknown>)?.subscriptionId as string;
}

function getProviderSubScheduleId(sub: SubscriptionWithCatalog): string | null {
  return ((sub.providerData as Record<string, unknown>)?.subscriptionScheduleId as string) ?? null;
}

function evaluateStripePlan(
  subCtx: SubscribeContext,
  paykitPlan: PayKitBillingPlan,
): StripeBillingPlan {
  const noAction: StripeBillingPlan = {
    checkoutAction: { type: "none" },
    invoiceAction: { type: "none" },
    subscriptionAction: { type: "none" },
  };

  const { activeSubscription } = subCtx;
  const hasProviderSub =
    activeSubscription?.providerData != null &&
    typeof (activeSubscription.providerData as Record<string, unknown>).subscriptionId === "string";

  // Free plan only — no Stripe calls
  if (subCtx.isFreeTarget && !hasProviderSub) {
    return noAction;
  }

  // Noop (same plan, no changes)
  if (paykitPlan.insertSubscriptions.length === 0 && paykitPlan.updateSubscription === null) {
    return noAction;
  }

  // --- Resume ---
  if (
    activeSubscription &&
    activeSubscription.planId === subCtx.storedPlan.id &&
    paykitPlan.updateSubscription
  ) {
    return {
      ...noAction,
      subscriptionAction: {
        providerSubscriptionId: getProviderSubId(activeSubscription),
        providerSubscriptionScheduleId: getProviderSubScheduleId(activeSubscription),
        type: "resume",
      },
    };
  }

  // --- Cancel to free (with provider subscription) ---
  if (subCtx.isFreeTarget && activeSubscription && hasProviderSub) {
    return {
      ...noAction,
      subscriptionAction: {
        currentPeriodEndAt: activeSubscription.currentPeriodEndAt,
        providerSubscriptionId: getProviderSubId(activeSubscription),
        providerSubscriptionScheduleId: getProviderSubScheduleId(activeSubscription),
        type: "cancel",
      },
    };
  }

  // --- Downgrade (schedule change at period end) ---
  if (activeSubscription && hasProviderSub && !subCtx.isUpgrade && !subCtx.isFreeTarget) {
    return {
      ...noAction,
      subscriptionAction: {
        providerPriceId: subCtx.storedPlan.providerPriceId!,
        providerSubscriptionId: getProviderSubId(activeSubscription),
        providerSubscriptionScheduleId: getProviderSubScheduleId(activeSubscription),
        type: "schedule_change",
      },
    };
  }

  // --- Upgrade with existing subscription ---
  if (activeSubscription && hasProviderSub && subCtx.isUpgrade) {
    if (subCtx.shouldUseCheckout) {
      // Checkout creates a new subscription — cancel the old one after checkout succeeds.
      return {
        ...noAction,
        checkoutAction: buildCheckoutAction(subCtx),
        subscriptionAction: {
          currentPeriodEndAt: activeSubscription.currentPeriodEndAt,
          providerSubscriptionId: getProviderSubId(activeSubscription),
          providerSubscriptionScheduleId: getProviderSubScheduleId(activeSubscription),
          type: "cancel",
        },
      };
    }
    return {
      ...noAction,
      subscriptionAction: {
        prorationBehavior: subCtx.prorationBehavior,
        providerPriceId: subCtx.storedPlan.providerPriceId!,
        providerSubscriptionId: getProviderSubId(activeSubscription),
        type: "update",
      },
    };
  }

  // --- New subscription (no active, or active was free with no sub) ---
  if (subCtx.shouldUseCheckout) {
    return {
      ...noAction,
      checkoutAction: buildCheckoutAction(subCtx),
    };
  }

  return {
    ...noAction,
    subscriptionAction: {
      providerCustomerId: subCtx.providerCustomerId,
      providerPriceId: subCtx.storedPlan.providerPriceId!,
      trialPeriodDays: subCtx.trialDays ?? undefined,
      type: "create",
    },
  };
}

function buildCheckoutAction(subCtx: SubscribeContext): StripeCheckoutAction {
  return {
    cancelUrl: subCtx.cancelUrl,
    metadata: {
      paykit_customer_id: subCtx.customerId,
      paykit_plan_id: subCtx.storedPlan.id,
    },
    providerCustomerId: subCtx.providerCustomerId,
    providerPriceId: subCtx.storedPlan.providerPriceId!,
    successUrl: subCtx.successUrl,
    trialPeriodDays: subCtx.trialDays ?? undefined,
    type: "create",
  };
}

async function executeBillingPlan(
  ctx: PayKitContext,
  subCtx: SubscribeContext,
  billingPlan: BillingPlan,
): Promise<SubscribeResult> {
  const { stripe: stripePlan, paykit: paykitPlan } = billingPlan;

  // --- Checkout path: defer everything ---
  if (stripePlan.checkoutAction.type === "create") {
    return executeCheckoutPath(ctx, subCtx, billingPlan, stripePlan.checkoutAction);
  }

  // --- Direct path: execute Stripe then DB ---
  const stripeResult = await executeStripeAction(ctx, stripePlan.subscriptionAction);

  // Execute invoice action if needed
  if (stripePlan.invoiceAction.type === "create") {
    await ctx.stripe.createInvoice({
      autoAdvance: true,
      lines: stripePlan.invoiceAction.lines,
      providerCustomerId: stripePlan.invoiceAction.providerCustomerId,
    });
  }

  // Execute DB mutations
  await executePayKitPlan(ctx, subCtx.providerId, paykitPlan, stripeResult);

  return buildSubscribeResult({
    invoice: stripeResult.invoice,
    paymentUrl: stripeResult.paymentUrl,
    requiredAction: stripeResult.requiredAction,
  });
}

async function executeCheckoutPath(
  ctx: PayKitContext,
  subCtx: SubscribeContext,
  billingPlan: BillingPlan,
  checkoutAction: Extract<StripeCheckoutAction, { type: "create" }>,
): Promise<SubscribeResult> {
  const { id: metadataId } = await createMetadata(ctx.database, {
    data: {
      billingPlan: serializeBillingPlan(billingPlan),
      customerId: subCtx.customerId,
      planId: subCtx.storedPlan.id,
      type: "subscribe_deferred",
    },
    providerId: subCtx.providerId,
    type: "subscribe_deferred",
  });

  const checkoutResult = await ctx.stripe.createSubscriptionCheckout({
    cancelUrl: checkoutAction.cancelUrl,
    metadata: {
      ...checkoutAction.metadata,
      paykit_metadata_id: metadataId,
    },
    providerCustomerId: checkoutAction.providerCustomerId,
    providerPriceId: checkoutAction.providerPriceId,
    successUrl: checkoutAction.successUrl,
    trialPeriodDays: checkoutAction.trialPeriodDays,
  });

  await linkMetadataToCheckoutSession(ctx.database, {
    id: metadataId,
    providerCheckoutSessionId: checkoutResult.providerCheckoutSessionId,
  });

  return buildSubscribeResult({ paymentUrl: checkoutResult.paymentUrl });
}

export async function executeStripeAction(
  ctx: PayKitContext,
  action: StripeSubscriptionAction,
): Promise<StripeExecutionResult> {
  if (action.type === "none") {
    return { paymentUrl: null };
  }

  if (action.type === "create") {
    return ctx.stripe.createSubscription({
      providerCustomerId: action.providerCustomerId,
      providerPriceId: action.providerPriceId,
      trialPeriodDays: action.trialPeriodDays,
    });
  }

  if (action.type === "update") {
    return ctx.stripe.updateSubscription({
      prorationBehavior: action.prorationBehavior,
      providerPriceId: action.providerPriceId,
      providerSubscriptionId: action.providerSubscriptionId,
    });
  }

  if (action.type === "cancel") {
    return ctx.stripe.cancelSubscription({
      currentPeriodEndAt: action.currentPeriodEndAt,
      providerSubscriptionId: action.providerSubscriptionId,
      providerSubscriptionScheduleId: action.providerSubscriptionScheduleId,
    });
  }

  if (action.type === "schedule_change") {
    return ctx.stripe.scheduleSubscriptionChange({
      providerPriceId: action.providerPriceId,
      providerSubscriptionId: action.providerSubscriptionId,
      providerSubscriptionScheduleId: action.providerSubscriptionScheduleId,
    });
  }

  // resume
  return ctx.stripe.resumeSubscription({
    providerSubscriptionId: action.providerSubscriptionId,
    providerSubscriptionScheduleId: action.providerSubscriptionScheduleId,
  });
}

// Shared DB mutation executor — used by both direct path and webhook deferred path

export async function executePayKitPlan(
  ctx: PayKitContext,
  providerId: string,
  plan: PayKitBillingPlan,
  stripeResult: {
    subscription?: ProviderSubscription | null;
    invoice?: {
      providerInvoiceId: string;
      currency: string;
      status: string | null;
      totalAmount: number;
      hostedUrl?: string | null;
      periodStartAt?: Date | null;
      periodEndAt?: Date | null;
    } | null;
  },
  options?: { deferred?: boolean },
): Promise<void> {
  await ctx.database.transaction(async (tx) => {
    // 1. Clear scheduled subscriptions in group
    if (plan.clearScheduledInGroup && plan.group) {
      await clearScheduledSubscriptionsInGroup(tx, {
        customerId: plan.customerId,
        group: plan.group,
      });
    }

    // 2. Delete scheduled subscriptions in group
    if (plan.deleteScheduledInGroup && plan.group) {
      await deleteScheduledSubscriptionsInGroup(tx, {
        customerId: plan.customerId,
        group: plan.group,
      });
    }

    // 3. Update existing subscription
    if (plan.updateSubscription) {
      const upd = plan.updateSubscription;

      if (upd.status === "ended") {
        await endSubscriptions(tx, [upd.subscriptionId], {
          canceled: upd.canceled,
          endedAt: upd.endedAt ?? new Date(),
          status: "ended",
        });
      } else if (upd.canceled) {
        await scheduleSubscriptionCancellation(tx, {
          canceledAt: upd.canceledAt ?? new Date(),
          currentPeriodEndAt: upd.endedAt,
          subscriptionId: upd.subscriptionId,
        });
        if (upd.scheduledProductId !== undefined) {
          await replaceSubscriptionSchedule(tx, {
            subscriptionId: upd.subscriptionId,
            scheduledProductId: upd.scheduledProductId,
          });
        }
      } else {
        // Resume: clear cancellation
        await syncSubscriptionFromProvider(tx, {
          subscriptionId: upd.subscriptionId,
          providerSubscription: stripeResult.subscription
            ? stripeResult.subscription
            : { cancelAtPeriodEnd: false, providerSubscriptionId: "", status: upd.status },
        });
        await replaceSubscriptionSchedule(tx, {
          subscriptionId: upd.subscriptionId,
          scheduledProductId: null,
        });
        if (stripeResult.subscription) {
          await syncSubscriptionBillingState(tx, {
            subscriptionId: upd.subscriptionId,
            currentPeriodEndAt: stripeResult.subscription.currentPeriodEndAt,
            currentPeriodStartAt: stripeResult.subscription.currentPeriodStartAt,
            status: stripeResult.subscription.status,
          });
        }
      }
    }

    // 4. Insert new subscriptions and link invoices
    for (const insertOp of plan.insertSubscriptions) {
      // Scheduled subscriptions keep their own status and period dates — the Stripe
      // result describes the *existing* subscription (e.g. still "active" after
      // cancel), not the future scheduled subscription.
      const isScheduled = insertOp.status === "scheduled";
      const periodStart = isScheduled
        ? (insertOp.currentPeriodStartAt ?? null)
        : (stripeResult.subscription?.currentPeriodStartAt ??
          insertOp.currentPeriodStartAt ??
          null);
      const periodEnd = isScheduled
        ? (insertOp.currentPeriodEndAt ?? null)
        : (stripeResult.subscription?.currentPeriodEndAt ?? insertOp.currentPeriodEndAt ?? null);
      const status = isScheduled
        ? insertOp.status
        : (stripeResult.subscription?.status ?? insertOp.status);

      // Build providerData from the Stripe result for non-scheduled subscriptions
      const providerData =
        !isScheduled && stripeResult.subscription
          ? {
              subscriptionId: stripeResult.subscription.providerSubscriptionId,
              subscriptionScheduleId:
                stripeResult.subscription.providerSubscriptionScheduleId ?? null,
            }
          : null;

      // When a deferred checkout completes, the subscription.created webhook may
      // have already arrived and created the subscription record.
      // Detect this and reuse the existing row instead of inserting a duplicate.
      // Only applies in deferred (webhook) context — direct path always inserts.
      let subscriptionRow: { id: string } | null = null;
      if (options?.deferred && !isScheduled && stripeResult.subscription) {
        const existingSub = await getSubscriptionByProviderSubscriptionId(tx, {
          providerId,
          providerSubscriptionId: stripeResult.subscription.providerSubscriptionId,
        });
        if (existingSub) {
          subscriptionRow = { id: existingSub.id };
          await syncSubscriptionBillingState(tx, {
            subscriptionId: existingSub.id,
            currentPeriodEndAt: periodEnd,
            currentPeriodStartAt: periodStart,
            providerData,
            status,
          });
        }
      }

      if (!subscriptionRow) {
        subscriptionRow = await insertSubscriptionRecord(tx, {
          currentPeriodEndAt: periodEnd,
          currentPeriodStartAt: periodStart,
          customerId: insertOp.customerId,
          planFeatures: insertOp.planFeatures,
          productInternalId: insertOp.productInternalId,
          providerId,
          providerData,
          startedAt: insertOp.startedAt,
          status,
          trialEndsAt: insertOp.trialEndsAt ?? null,
        });
      }

      // Link invoice to the subscription record
      if (stripeResult.subscription && stripeResult.invoice && !isScheduled) {
        await upsertInvoiceRecord(tx, {
          customerId: insertOp.customerId,
          invoice: stripeResult.invoice,
          providerId,
          subscriptionId: subscriptionRow.id,
        });
      }
    }
  });
}

export async function resolveFallbackSuccessPlanId(
  ctx: PayKitContext,
  group: string,
): Promise<string | null> {
  const fallback = await getDefaultProductInGroup(ctx.database, group, ctx.provider.id);
  return fallback?.id ?? null;
}
