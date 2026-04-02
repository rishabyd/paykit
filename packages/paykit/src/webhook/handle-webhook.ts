import { eq } from "drizzle-orm";

import type { PayKitContext } from "../core/context";
import { getTraceId, runWithTrace } from "../core/trace";
import { product } from "../database/schema";
import {
  activateScheduledSubscription,
  beginWebhookEvent,
  deleteMetadataById,
  deleteScheduledSubscriptionsInGroup,
  endSubscriptions,
  finishWebhookEvent,
  getActiveSubscriptionInGroup,
  getCurrentSubscriptions,
  getMetadataById,
  getScheduledSubscriptionsInGroup,
  getSubscriptionByProviderSubscriptionId,
  insertSubscriptionRecord,
  replaceSubscriptionSchedule,
  scheduleSubscriptionCancellation,
  syncSubscriptionBillingState,
  syncSubscriptionFromProvider,
  upsertInvoiceRecord,
} from "../services/billing-service";
import {
  deleteCustomerFromDatabase,
  findCustomerByProviderCustomerId,
  syncCustomer,
} from "../services/customer-service";
import {
  deletePaymentMethodByProviderId,
  syncPaymentMethodByProviderCustomer,
} from "../services/payment-method-service";
import { syncPaymentByProviderCustomer } from "../services/payment-service";
import {
  getDefaultProductInGroup,
  getLatestProductWithPrice,
  getProductByProviderPriceId,
} from "../services/product-service";
import { executePayKitPlan, executeStripeAction } from "../services/subscribe-service";
import { deserializeBillingPlan } from "../types/billing-plan";
import type {
  AnyNormalizedWebhookEvent,
  NormalizedWebhookEvent,
  WebhookApplyAction,
} from "../types/events";

export interface HandleWebhookInput {
  body: string;
  headers: Record<string, string>;
}

async function emitCustomerUpdated(ctx: PayKitContext, customerId: string): Promise<void> {
  const subscriptions = await getCurrentSubscriptions(ctx.database, customerId);
  const payload = { customerId, subscriptions };

  try {
    await ctx.options.on?.["customer.updated"]?.({
      name: "customer.updated",
      payload,
    });
    await ctx.options.on?.["*"]?.({
      event: {
        name: "customer.updated",
        payload,
      },
    });
  } catch (error) {
    // User event handlers must not poison webhook processing
    ctx.logger.error("error in customer.updated event handler:", error);
  }
}

function getSubscriptionEffectiveDate(input: {
  currentPeriodEndAt?: Date | null;
  currentPeriodStartAt?: Date | null;
}): Date {
  return input.currentPeriodStartAt ?? input.currentPeriodEndAt ?? new Date();
}

async function ensureScheduledDefaultPlan(
  ctx: PayKitContext,
  input: {
    customerId: string;
    group: string;
    startsAt: Date;
  },
): Promise<void> {
  const existingScheduled = await getScheduledSubscriptionsInGroup(ctx.database, {
    customerId: input.customerId,
    group: input.group,
  });
  if (existingScheduled.length > 0) {
    return;
  }

  const defaultPlan = await getDefaultProductInGroup(ctx.database, input.group, ctx.provider.id);
  if (!defaultPlan || defaultPlan.priceAmount !== null) {
    return;
  }

  const normalizedPlan = ctx.plans.plans.find((plan) => plan.id === defaultPlan.id);
  if (!normalizedPlan) {
    return;
  }

  await insertSubscriptionRecord(ctx.database, {
    customerId: input.customerId,
    planFeatures: normalizedPlan.includes,
    productInternalId: defaultPlan.internalId,
    startedAt: input.startsAt,
    status: "scheduled",
  });
}

async function activateScheduledSubscriptionForGroup(
  ctx: PayKitContext,
  input: {
    customerId: string;
    productGroup: string;
    productInternalId?: string | null;
    subscriptionStatus: string;
    subscriptionCurrentPeriodEndAt?: Date | null;
    subscriptionCurrentPeriodStartAt?: Date | null;
    providerId?: string | null;
    providerData?: Record<string, unknown> | null;
  },
): Promise<string | null> {
  const activationDate = getSubscriptionEffectiveDate({
    currentPeriodEndAt: input.subscriptionCurrentPeriodEndAt,
    currentPeriodStartAt: input.subscriptionCurrentPeriodStartAt,
  });
  const scheduledSubs = await getScheduledSubscriptionsInGroup(ctx.database, {
    customerId: input.customerId,
    group: input.productGroup,
  });

  const targetSub = scheduledSubs.find((scheduled) => {
    if (scheduled.startedAt && scheduled.startedAt > activationDate) {
      return false;
    }

    if (!input.productInternalId) {
      return true;
    }

    return scheduled.productInternalId === input.productInternalId;
  });

  if (!targetSub) {
    return null;
  }

  const activeSub = await getActiveSubscriptionInGroup(ctx.database, {
    customerId: input.customerId,
    group: input.productGroup,
  });

  if (activeSub && activeSub.id !== targetSub.id) {
    await endSubscriptions(ctx.database, [activeSub.id], {
      canceled: activeSub.canceled,
      endedAt: activationDate,
      status: "ended",
    });
  }

  await activateScheduledSubscription(ctx.database, {
    currentPeriodEndAt: input.subscriptionCurrentPeriodEndAt,
    currentPeriodStartAt: input.subscriptionCurrentPeriodStartAt,
    subscriptionId: targetSub.id,
    startedAt: targetSub.startedAt ?? activationDate,
    status: input.subscriptionStatus,
    providerId: input.providerId,
    providerData: input.providerData,
  });

  return targetSub.id;
}

function getProviderEventId(
  event: AnyNormalizedWebhookEvent,
  index: number,
  parentEventId: string | null,
): string {
  const payload = event.payload as Record<string, unknown>;
  const providerEventId = payload.providerEventId;
  if (typeof providerEventId === "string" && providerEventId.length > 0) {
    return providerEventId;
  }
  // Synthetic sub-events (e.g. from checkout expansion) include the parent's
  // provider event ID to avoid collisions across different webhook deliveries.
  const prefix = parentEventId ?? "unknown";
  return `${prefix}:${event.name}:${index}`;
}

async function finalizeSubscriptionCheckout(
  ctx: PayKitContext,
  event: NormalizedWebhookEvent<"checkout.completed">,
): Promise<string | null> {
  if (event.payload.mode !== "subscription") {
    return null;
  }

  const metadataId = event.payload.metadata?.paykit_metadata_id;
  if (!metadataId) {
    return null;
  }

  const storedMetadata = await getMetadataById(ctx.database, metadataId);
  if (!storedMetadata) {
    return null;
  }

  const metadataType =
    typeof storedMetadata.data.type === "string" ? storedMetadata.data.type : null;

  // --- New deferred billing plan path ---
  if (metadataType === "subscribe_deferred") {
    const billingPlan = deserializeBillingPlan(storedMetadata.data.billingPlan as unknown);
    const checkoutSubscription = event.payload.subscription ?? null;
    const checkoutInvoice = event.payload.invoice ?? null;

    // Cancel the old subscription if this was a checkout upgrade (e.g. pro → ultra).
    if (billingPlan.stripe.subscriptionAction.type !== "none") {
      await executeStripeAction(ctx, billingPlan.stripe.subscriptionAction);
    }

    await executePayKitPlan(
      ctx,
      ctx.provider.id,
      billingPlan.paykit,
      {
        invoice: checkoutInvoice,
        subscription: checkoutSubscription,
      },
      { deferred: true },
    );

    await deleteMetadataById(ctx.database, metadataId);
    return billingPlan.paykit.customerId;
  }

  // --- Legacy metadata path (backward compat for old subscribe_new / subscribe_upgrade) ---
  return finalizeLegacyCheckout(ctx, event, storedMetadata);
}

async function finalizeLegacyCheckout(
  ctx: PayKitContext,
  event: NormalizedWebhookEvent<"checkout.completed">,
  storedMetadata: { data: Record<string, unknown>; id: string },
): Promise<string | null> {
  const customerId =
    typeof storedMetadata.data.customerId === "string"
      ? storedMetadata.data.customerId
      : event.payload.metadata?.paykit_customer_id;
  const planId =
    typeof storedMetadata.data.planId === "string"
      ? storedMetadata.data.planId
      : event.payload.metadata?.paykit_plan_id;

  if (!customerId || !planId) {
    return null;
  }

  const storedPlan = await getLatestProductWithPrice(ctx.database, {
    id: planId,
    providerId: ctx.provider.id,
  });
  const normalizedPlan = ctx.plans.plans.find((plan) => plan.id === planId);
  const existingSub = event.payload.providerSubscriptionId
    ? await getSubscriptionByProviderSubscriptionId(ctx.database, {
        providerId: ctx.provider.id,
        providerSubscriptionId: event.payload.providerSubscriptionId,
      })
    : null;
  const checkoutSubscription = event.payload.subscription ?? null;
  const checkoutInvoice = event.payload.invoice ?? null;

  if (storedPlan && normalizedPlan) {
    const currentPeriodStartAt =
      checkoutSubscription?.currentPeriodStartAt ?? existingSub?.currentPeriodStartAt ?? null;
    const currentPeriodEndAt =
      checkoutSubscription?.currentPeriodEndAt ?? existingSub?.currentPeriodEndAt ?? null;
    const currentGroupActiveSub = storedPlan.group
      ? await getActiveSubscriptionInGroup(ctx.database, {
          customerId,
          group: storedPlan.group,
        })
      : null;

    const providerData = checkoutSubscription
      ? { subscriptionId: checkoutSubscription.providerSubscriptionId }
      : (existingSub?.providerData ?? null);

    // Use existing subscription or create a new one
    const targetSub =
      existingSub ??
      (await insertSubscriptionRecord(ctx.database, {
        currentPeriodEndAt,
        currentPeriodStartAt,
        customerId,
        planFeatures: normalizedPlan.includes,
        productInternalId: storedPlan.internalId,
        providerId: ctx.provider.id,
        providerData,
        startedAt: currentPeriodStartAt ?? new Date(),
        status: checkoutSubscription?.status ?? existingSub?.status ?? "active",
      }));

    if (
      currentGroupActiveSub &&
      currentGroupActiveSub.id !== targetSub.id &&
      currentGroupActiveSub.productInternalId !== targetSub.productInternalId
    ) {
      await endSubscriptions(ctx.database, [currentGroupActiveSub.id], {
        canceled: false,
        endedAt: currentPeriodStartAt ?? new Date(),
        status: "ended",
      });
    }

    await syncSubscriptionBillingState(ctx.database, {
      subscriptionId: targetSub.id,
      currentPeriodEndAt,
      currentPeriodStartAt,
      providerData: providerData ?? targetSub.providerData,
      startedAt: currentPeriodStartAt ?? targetSub.startedAt,
      status: checkoutSubscription?.status ?? existingSub?.status ?? targetSub.status,
    });

    if (checkoutSubscription) {
      await syncSubscriptionFromProvider(ctx.database, {
        subscriptionId: targetSub.id,
        providerSubscription: checkoutSubscription,
      });
    }

    if (checkoutInvoice) {
      await upsertInvoiceRecord(ctx.database, {
        customerId,
        invoice: checkoutInvoice,
        providerId: ctx.provider.id,
        subscriptionId: targetSub.id,
      });
    }
  }

  await deleteMetadataById(ctx.database, storedMetadata.id);
  return customerId;
}

async function applyAction(ctx: PayKitContext, action: WebhookApplyAction): Promise<string | null> {
  if (action.type === "customer.upsert") {
    await syncCustomer(ctx.database, action.data);
    return action.data.id;
  }

  if (action.type === "customer.delete") {
    await deleteCustomerFromDatabase(ctx.database, action.data.id);
    return action.data.id;
  }

  if (action.type === "payment_method.upsert") {
    await syncPaymentMethodByProviderCustomer(ctx.database, {
      paymentMethod: action.data.paymentMethod,
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });

    const customerRow = await findCustomerByProviderCustomerId(ctx.database, {
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });
    return customerRow?.id ?? null;
  }

  if (action.type === "payment_method.delete") {
    await deletePaymentMethodByProviderId(ctx.database, {
      providerId: ctx.provider.id,
      providerMethodId: action.data.providerMethodId,
    });
    return null;
  }

  if (action.type === "payment.upsert") {
    await syncPaymentByProviderCustomer(ctx.database, {
      payment: action.data.payment,
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });

    const customerRow = await findCustomerByProviderCustomerId(ctx.database, {
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });
    return customerRow?.id ?? null;
  }

  if (action.type === "subscription.upsert") {
    const customerRow = await findCustomerByProviderCustomerId(ctx.database, {
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });
    if (!customerRow) {
      return null;
    }

    const existingSub = await getSubscriptionByProviderSubscriptionId(ctx.database, {
      providerId: ctx.provider.id,
      providerSubscriptionId: action.data.subscription.providerSubscriptionId,
    });
    const storedProduct = action.data.subscription.providerPriceId
      ? await getProductByProviderPriceId(ctx.database, {
          providerId: ctx.provider.id,
          providerPriceId: action.data.subscription.providerPriceId,
        })
      : null;
    const normalizedPlan = storedProduct
      ? ctx.plans.plans.find((plan) => plan.id === storedProduct.id)
      : null;

    const providerData = {
      subscriptionId: action.data.subscription.providerSubscriptionId,
    };

    // Use existing subscription or create a new one
    const targetSub =
      existingSub ??
      (storedProduct && normalizedPlan
        ? await insertSubscriptionRecord(ctx.database, {
            currentPeriodEndAt: action.data.subscription.currentPeriodEndAt ?? null,
            currentPeriodStartAt: action.data.subscription.currentPeriodStartAt ?? null,
            customerId: customerRow.id,
            planFeatures: normalizedPlan.includes,
            productInternalId: storedProduct.internalId,
            providerId: ctx.provider.id,
            providerData,
            startedAt: action.data.subscription.currentPeriodStartAt ?? new Date(),
            status: action.data.subscription.status,
            trialEndsAt: null,
          })
        : null);

    if (!targetSub) {
      return customerRow.id;
    }

    // Sync subscription state from provider
    await syncSubscriptionFromProvider(ctx.database, {
      subscriptionId: targetSub.id,
      providerSubscription: action.data.subscription,
    });

    // Update provider data on the subscription
    await syncSubscriptionBillingState(ctx.database, {
      subscriptionId: targetSub.id,
      providerData,
    });

    // Detect a genuine resume: cancel_at_period_end went from true → false
    // AND the subscription is NOT now managed by a schedule. When a schedule is
    // created from a canceled subscription, Stripe un-cancels it automatically —
    // that is NOT a resume, it's a schedule taking over lifecycle management.
    const isGenuineResume =
      storedProduct &&
      existingSub?.cancelAtPeriodEnd &&
      !action.data.subscription.cancelAtPeriodEnd &&
      !action.data.subscription.providerSubscriptionScheduleId;

    if (isGenuineResume) {
      await deleteScheduledSubscriptionsInGroup(ctx.database, {
        customerId: customerRow.id,
        group: storedProduct.group,
      });

      const activeSub = await getActiveSubscriptionInGroup(ctx.database, {
        customerId: customerRow.id,
        group: storedProduct.group,
      });
      if (activeSub) {
        await replaceSubscriptionSchedule(ctx.database, {
          subscriptionId: activeSub.id,
          scheduledProductId: null,
        });
      }
    }

    if (storedProduct) {
      const activeSub = await getActiveSubscriptionInGroup(ctx.database, {
        customerId: customerRow.id,
        group: storedProduct.group,
      });

      const subStatus = action.data.subscription.status;
      const isTerminal =
        subStatus === "canceled" || subStatus === "ended" || subStatus === "unpaid";

      if (action.data.subscription.cancelAtPeriodEnd && activeSub) {
        await scheduleSubscriptionCancellation(ctx.database, {
          canceledAt: action.data.subscription.canceledAt ?? new Date(),
          currentPeriodEndAt:
            action.data.subscription.currentPeriodEndAt ?? activeSub.currentPeriodEndAt,
          subscriptionId: activeSub.id,
        });

        await ensureScheduledDefaultPlan(ctx, {
          customerId: customerRow.id,
          group: storedProduct.group,
          startsAt:
            action.data.subscription.currentPeriodEndAt ??
            activeSub.currentPeriodEndAt ??
            new Date(),
        });
      }

      // When the subscription reaches a terminal state (canceled/ended),
      // end the active subscription and activate the scheduled plan. This handles
      // the case where Stripe sends subscription.updated with status=canceled
      // instead of subscription.deleted (e.g. when using cancel_at).
      if (isTerminal && activeSub) {
        const effectiveDate = action.data.subscription.currentPeriodEndAt ?? new Date();

        await endSubscriptions(ctx.database, [activeSub.id], {
          canceled: true,
          endedAt: effectiveDate,
          status: "canceled",
        });

        await ensureScheduledDefaultPlan(ctx, {
          customerId: customerRow.id,
          group: storedProduct.group,
          startsAt: effectiveDate,
        });

        await activateScheduledSubscriptionForGroup(ctx, {
          customerId: customerRow.id,
          productGroup: storedProduct.group,
          subscriptionCurrentPeriodStartAt: effectiveDate,
          subscriptionStatus: "active",
        });
      } else {
        const activatedSubId = await activateScheduledSubscriptionForGroup(ctx, {
          customerId: customerRow.id,
          productGroup: storedProduct.group,
          productInternalId: storedProduct.internalId,
          subscriptionCurrentPeriodEndAt: action.data.subscription.currentPeriodEndAt,
          subscriptionCurrentPeriodStartAt: action.data.subscription.currentPeriodStartAt,
          subscriptionStatus: action.data.subscription.status,
          providerId: ctx.provider.id,
          providerData,
        });

        if (activatedSubId) {
          await syncSubscriptionFromProvider(ctx.database, {
            subscriptionId: activatedSubId,
            providerSubscription: action.data.subscription,
          });
        }
      }
    }

    return customerRow.id;
  }

  if (action.type === "subscription.delete") {
    const customerRow = await findCustomerByProviderCustomerId(ctx.database, {
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });
    if (!customerRow) {
      return null;
    }

    const existingSub = await getSubscriptionByProviderSubscriptionId(ctx.database, {
      providerId: ctx.provider.id,
      providerSubscriptionId: action.data.providerSubscriptionId,
    });
    if (!existingSub) {
      return customerRow.id;
    }

    const effectiveEndDate = existingSub.currentPeriodEndAt ?? new Date();

    // End the subscription
    await endSubscriptions(ctx.database, [existingSub.id], {
      canceled: true,
      endedAt: effectiveEndDate,
      status: "canceled",
    });

    const existingStoredProduct = await ctx.database.query.product.findFirst({
      where: eq(product.internalId, existingSub.productInternalId),
    });
    const productGroup = existingStoredProduct?.group ?? "";

    if (productGroup) {
      // Use the subscription's period end as the effective date — this is
      // when Stripe considers the subscription ended, which may differ from
      // wall-clock time (e.g. test clocks, delayed webhook delivery).
      const effectiveDate = existingSub.currentPeriodEndAt ?? new Date();

      await ensureScheduledDefaultPlan(ctx, {
        customerId: customerRow.id,
        group: productGroup,
        startsAt: effectiveDate,
      });

      await activateScheduledSubscriptionForGroup(ctx, {
        customerId: customerRow.id,
        productGroup,
        // Use the subscription's period end as the effective activation date
        // so scheduled products are found correctly, but don't set period
        // dates on the activated product (Free plans have no billing cycle).
        subscriptionCurrentPeriodStartAt: effectiveDate,
        subscriptionCurrentPeriodEndAt: null,
        subscriptionStatus: "active",
      });
    }

    return customerRow.id;
  }

  if (action.type === "invoice.upsert") {
    const customerRow = await findCustomerByProviderCustomerId(ctx.database, {
      providerCustomerId: action.data.providerCustomerId,
      providerId: ctx.provider.id,
    });
    if (!customerRow) {
      return null;
    }

    const subscriptionRecord = action.data.providerSubscriptionId
      ? await getSubscriptionByProviderSubscriptionId(ctx.database, {
          providerId: ctx.provider.id,
          providerSubscriptionId: action.data.providerSubscriptionId,
        })
      : null;

    await upsertInvoiceRecord(ctx.database, {
      customerId: customerRow.id,
      invoice: action.data.invoice,
      providerId: ctx.provider.id,
      subscriptionId: subscriptionRecord?.id ?? null,
    });
    return customerRow.id;
  }

  return null;
}

export async function handleWebhook(
  ctx: PayKitContext,
  input: HandleWebhookInput,
): Promise<{ received: true }> {
  return runWithTrace("wh", async () => {
    const startTime = Date.now();
    const events = await ctx.stripe.handleWebhook({
      body: input.body,
      headers: input.headers,
    });

    // Find the provider event ID from any event in the batch. For checkout
    // webhooks the synthetic sub-events come first (without providerEventId),
    // followed by the checkout.completed event that carries the Stripe event ID.
    let parentEventId: string | null = null;
    for (const evt of events) {
      const payload = evt.payload as Record<string, unknown>;
      if (typeof payload.providerEventId === "string" && payload.providerEventId.length > 0) {
        parentEventId = payload.providerEventId;
        break;
      }
    }

    const traceId = getTraceId();

    for (const [index, event] of events.entries()) {
      const providerEventId = getProviderEventId(event, index, parentEventId);

      ctx.logger.info(`webhook received: ${event.name}`, { providerEventId });

      const shouldProcess = await beginWebhookEvent(ctx.database, {
        payload: event.payload as Record<string, unknown>,
        providerEventId,
        providerId: ctx.provider.id,
        traceId,
        type: event.name,
      });
      if (!shouldProcess) {
        ctx.logger.info(`webhook skipped (duplicate): ${event.name}`, { providerEventId });
        continue;
      }

      try {
        // Run all DB mutations inside a transaction so a mid-way crash
        // doesn't leave partially applied state.
        const customerIds = await ctx.database.transaction(async (tx) => {
          const txCtx = { ...ctx, database: tx } as PayKitContext;
          const ids = new Set<string>();

          if (event.name === "checkout.completed") {
            ctx.logger.info("processing checkout.completed");
            const customerId = await finalizeSubscriptionCheckout(txCtx, event);
            if (customerId) {
              ids.add(customerId);
            }
          }

          for (const action of event.actions ?? []) {
            ctx.logger.info(`applying action: ${action.type}`);
            const customerId = await applyAction(txCtx, action);
            if (customerId) {
              ids.add(customerId);
            }
          }

          return ids;
        });

        // Emit user event handlers outside the transaction to avoid holding
        // locks while user code runs.
        for (const customerId of customerIds) {
          await emitCustomerUpdated(ctx, customerId);
        }

        const duration = Date.now() - startTime;
        ctx.logger.info(`webhook processed: ${event.name} (${String(duration)}ms)`);

        await finishWebhookEvent(ctx.database, {
          providerEventId,
          providerId: ctx.provider.id,
          status: "processed",
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorDetail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        ctx.logger.error(`webhook failed: ${event.name} (${String(duration)}ms)`, errorDetail);

        await finishWebhookEvent(ctx.database, {
          error: errorDetail,
          providerEventId,
          providerId: ctx.provider.id,
          status: "failed",
        });
        throw error;
      }
    }

    return { received: true };
  });
}
