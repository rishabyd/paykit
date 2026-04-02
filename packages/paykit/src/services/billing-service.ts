import { and, eq, inArray, sql } from "drizzle-orm";

import { generateId } from "../core/utils";
import type { PayKitDatabase } from "../database";
import { entitlement, invoice, metadata, subscription, webhookEvent } from "../database/schema";
import type {
  ProviderInvoice,
  ProviderRequiredAction,
  ProviderSubscription,
} from "../providers/provider";
import type { NormalizedInvoice, NormalizedSubscription } from "../types/events";
import type { StoredInvoice, StoredSubscription } from "../types/models";
import type { NormalizedPlanFeature } from "../types/schema";

export interface SubscribeResult {
  invoice?: {
    currency: string;
    hostedUrl: string | null;
    providerInvoiceId: string;
    status: string | null;
    totalAmount: number;
  };
  paymentUrl: string | null;
  requiredAction?: ProviderRequiredAction | null;
}

const TIMESTAMP_KEYS = [
  "startedAt",
  "trialEndsAt",
  "currentPeriodStartAt",
  "currentPeriodEndAt",
  "canceledAt",
  "endedAt",
  "createdAt",
  "updatedAt",
] as const;

function coerceTimestamps<T extends Record<string, unknown>>(row: T): T {
  for (const key of TIMESTAMP_KEYS) {
    if (key in row && row[key] != null && typeof row[key] === "string") {
      (row as Record<string, unknown>)[key] = new Date(row[key] as string);
    }
  }
  return row;
}

export interface SubscriptionWithCatalog extends StoredSubscription {
  planId: string;
  planGroup: string;
  planIsDefault: boolean;
  planName: string;
  priceAmount: number | null;
  priceInterval: string | null;
  providerPriceId: string | null;
}

function addResetInterval(date: Date, resetInterval: string): Date {
  const next = new Date(date);
  if (resetInterval === "day") next.setUTCDate(next.getUTCDate() + 1);
  if (resetInterval === "week") next.setUTCDate(next.getUTCDate() + 7);
  if (resetInterval === "month") {
    const day = next.getUTCDate();
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getUTCDate() !== day) next.setUTCDate(0);
  }
  if (resetInterval === "year") {
    const day = next.getUTCDate();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    if (next.getUTCDate() !== day) next.setUTCDate(0);
  }
  return next;
}

function normalizeInvoice(
  source: ProviderInvoice | NormalizedInvoice,
): SubscribeResult["invoice"] | undefined {
  return {
    currency: source.currency,
    hostedUrl: source.hostedUrl ?? null,
    providerInvoiceId: source.providerInvoiceId,
    status: source.status,
    totalAmount: source.totalAmount,
  };
}

type ProviderProductMap = Record<string, { productId: string; priceId: string | null }>;

export async function getActiveSubscriptionInGroup(
  database: PayKitDatabase,
  input: { customerId: string; group: string },
): Promise<SubscriptionWithCatalog | null> {
  const result = (await database.execute(sql`
    select
      s.id,
      s.customer_id as "customerId",
      s.product_internal_id as "productInternalId",
      s.provider_id as "providerId",
      s.provider_data as "providerData",
      s.status,
      s.canceled,
      s.cancel_at_period_end as "cancelAtPeriodEnd",
      s.started_at as "startedAt",
      s.trial_ends_at as "trialEndsAt",
      s.current_period_start_at as "currentPeriodStartAt",
      s.current_period_end_at as "currentPeriodEndAt",
      s.canceled_at as "canceledAt",
      s.ended_at as "endedAt",
      s.scheduled_product_id as "scheduledProductId",
      s.quantity,
      s.created_at as "createdAt",
      s.updated_at as "updatedAt",
      p.id as "planId",
      p.name as "planName",
      p."group" as "planGroup",
      p.is_default as "planIsDefault",
      p.price_amount as "priceAmount",
      p.price_interval as "priceInterval",
      p.provider as "productProvider"
    from paykit_subscription s
    inner join paykit_product p on p.internal_id = s.product_internal_id
    where s.customer_id = ${input.customerId}
      and p."group" = ${input.group}
      and s.status in ('active', 'trialing', 'past_due')
      and (s.ended_at is null or s.ended_at > now())
    order by s.created_at desc
    limit 1
  `)) as unknown as {
    rows: Array<SubscriptionWithCatalog & { productProvider: ProviderProductMap }>;
  };

  const row = result.rows[0];
  if (!row) return null;
  const { productProvider, ...rest } = row;
  return coerceTimestamps({
    ...rest,
    providerPriceId: Object.values(productProvider ?? {})[0]?.priceId ?? null,
  });
}

export async function getScheduledSubscriptionsInGroup(
  database: PayKitDatabase,
  input: { customerId: string; group: string },
): Promise<readonly SubscriptionWithCatalog[]> {
  const result = (await database.execute(sql`
    select
      s.id,
      s.customer_id as "customerId",
      s.product_internal_id as "productInternalId",
      s.provider_id as "providerId",
      s.provider_data as "providerData",
      s.status,
      s.canceled,
      s.cancel_at_period_end as "cancelAtPeriodEnd",
      s.started_at as "startedAt",
      s.trial_ends_at as "trialEndsAt",
      s.current_period_start_at as "currentPeriodStartAt",
      s.current_period_end_at as "currentPeriodEndAt",
      s.canceled_at as "canceledAt",
      s.ended_at as "endedAt",
      s.scheduled_product_id as "scheduledProductId",
      s.quantity,
      s.created_at as "createdAt",
      s.updated_at as "updatedAt",
      p.id as "planId",
      p.name as "planName",
      p."group" as "planGroup",
      p.is_default as "planIsDefault",
      p.price_amount as "priceAmount",
      p.price_interval as "priceInterval",
      p.provider as "productProvider"
    from paykit_subscription s
    inner join paykit_product p on p.internal_id = s.product_internal_id
    where s.customer_id = ${input.customerId}
      and p."group" = ${input.group}
      and s.status = 'scheduled'
      and s.ended_at is null
    order by s.created_at desc
  `)) as unknown as {
    rows: Array<SubscriptionWithCatalog & { productProvider: ProviderProductMap }>;
  };

  return result.rows.map((row) => {
    const { productProvider, ...rest } = row;
    return coerceTimestamps({
      ...rest,
      providerPriceId: Object.values(productProvider ?? {})[0]?.priceId ?? null,
    });
  });
}

export async function getSubscriptionByProviderSubscriptionId(
  database: PayKitDatabase,
  input: { providerId: string; providerSubscriptionId: string },
): Promise<StoredSubscription | null> {
  const result = (await database.execute(sql`
    select
      id,
      customer_id as "customerId",
      product_internal_id as "productInternalId",
      provider_id as "providerId",
      provider_data as "providerData",
      status,
      canceled,
      cancel_at_period_end as "cancelAtPeriodEnd",
      started_at as "startedAt",
      trial_ends_at as "trialEndsAt",
      current_period_start_at as "currentPeriodStartAt",
      current_period_end_at as "currentPeriodEndAt",
      canceled_at as "canceledAt",
      ended_at as "endedAt",
      scheduled_product_id as "scheduledProductId",
      quantity,
      created_at as "createdAt",
      updated_at as "updatedAt"
    from paykit_subscription
    where provider_id = ${input.providerId}
      and provider_data->>'subscriptionId' = ${input.providerSubscriptionId}
    limit 1
  `)) as unknown as { rows: StoredSubscription[] };

  const row = result.rows[0];
  return row ? coerceTimestamps(row) : null;
}

export async function getSubscriptionById(
  database: PayKitDatabase,
  subscriptionId: string,
): Promise<StoredSubscription | null> {
  return (
    (await database.query.subscription.findFirst({
      where: eq(subscription.id, subscriptionId),
    })) ?? null
  );
}

export async function createMetadata(
  database: PayKitDatabase,
  input: {
    data: Record<string, unknown>;
    expiresAt?: Date;
    providerId: string;
    type: string;
  },
): Promise<{ id: string }> {
  const id = generateId("meta");
  await database.insert(metadata).values({
    data: input.data,
    expiresAt: input.expiresAt ?? null,
    id,
    providerCheckoutSessionId: null,
    providerId: input.providerId,
    type: input.type,
  });
  return { id };
}

export async function linkMetadataToCheckoutSession(
  database: PayKitDatabase,
  input: { id: string; providerCheckoutSessionId: string },
): Promise<void> {
  await database
    .update(metadata)
    .set({ providerCheckoutSessionId: input.providerCheckoutSessionId })
    .where(eq(metadata.id, input.id));
}

export async function getMetadataById(
  database: PayKitDatabase,
  id: string,
): Promise<{
  id: string;
  providerId: string;
  type: string;
  data: Record<string, unknown>;
  providerCheckoutSessionId: string | null;
} | null> {
  const row = await database.query.metadata.findFirst({
    where: eq(metadata.id, id),
  });
  return row
    ? {
        data: row.data,
        id: row.id,
        providerCheckoutSessionId: row.providerCheckoutSessionId,
        providerId: row.providerId,
        type: row.type,
      }
    : null;
}

export async function deleteMetadataById(database: PayKitDatabase, id: string): Promise<void> {
  await database.delete(metadata).where(eq(metadata.id, id));
}

export async function beginWebhookEvent(
  database: PayKitDatabase,
  input: {
    payload: Record<string, unknown>;
    providerEventId: string;
    providerId: string;
    traceId?: string;
    type: string;
  },
): Promise<boolean> {
  try {
    await database.insert(webhookEvent).values({
      error: null,
      id: generateId("evt"),
      payload: input.payload,
      processedAt: null,
      providerEventId: input.providerEventId,
      providerId: input.providerId,
      receivedAt: new Date(),
      status: "processing",
      traceId: input.traceId ?? null,
      type: input.type,
    });
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      throw error;
    }

    const retried = await database
      .update(webhookEvent)
      .set({ error: null, processedAt: null, status: "processing" })
      .where(
        and(
          eq(webhookEvent.providerId, input.providerId),
          eq(webhookEvent.providerEventId, input.providerEventId),
          sql`(${webhookEvent.status} = 'failed' OR (${webhookEvent.status} = 'processing' AND ${webhookEvent.receivedAt} < now() - interval '5 minutes'))`,
        ),
      )
      .returning({ id: webhookEvent.id });

    return retried.length > 0;
  }
}

export async function finishWebhookEvent(
  database: PayKitDatabase,
  input: {
    error?: string;
    providerEventId: string;
    providerId: string;
    status: "failed" | "processed";
  },
): Promise<void> {
  await database
    .update(webhookEvent)
    .set({
      error: input.error ?? null,
      processedAt: new Date(),
      status: input.status,
    })
    .where(
      and(
        eq(webhookEvent.providerId, input.providerId),
        eq(webhookEvent.providerEventId, input.providerEventId),
      ),
    );
}

export async function upsertInvoiceRecord(
  database: PayKitDatabase,
  input: {
    customerId: string;
    providerId: string;
    subscriptionId?: string | null;
    invoice: ProviderInvoice | NormalizedInvoice;
  },
): Promise<StoredInvoice> {
  const now = new Date();
  const providerData = {
    invoiceId: input.invoice.providerInvoiceId,
  };

  const existing = (await database.execute(sql`
    select id
    from paykit_invoice
    where provider_id = ${input.providerId}
      and provider_data->>'invoiceId' = ${input.invoice.providerInvoiceId}
    limit 1
  `)) as unknown as { rows: Array<{ id: string }> };

  const values = {
    amount: input.invoice.totalAmount,
    currency: input.invoice.currency,
    customerId: input.customerId,
    description: null as string | null,
    hostedUrl: input.invoice.hostedUrl ?? null,
    periodEndAt: input.invoice.periodEndAt ?? null,
    periodStartAt: input.invoice.periodStartAt ?? null,
    providerId: input.providerId,
    providerData,
    status: input.invoice.status ?? "open",
    subscriptionId: input.subscriptionId ?? null,
    type: "subscription" as string,
    updatedAt: now,
  };

  if (existing.rows[0]) {
    const rows = await database
      .update(invoice)
      .set(values)
      .where(eq(invoice.id, existing.rows[0].id))
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update invoice.");
    }
    return row;
  }

  const rows = await database
    .insert(invoice)
    .values({
      ...values,
      id: generateId("inv"),
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to upsert invoice.");
  }
  return row;
}

export async function insertSubscriptionRecord(
  database: PayKitDatabase,
  input: {
    customerId: string;
    currentPeriodEndAt?: Date | null;
    currentPeriodStartAt?: Date | null;
    planFeatures: readonly NormalizedPlanFeature[];
    productInternalId: string;
    providerId?: string | null;
    providerData?: Record<string, unknown> | null;
    scheduledProductId?: string | null;
    startedAt?: Date | null;
    status: string;
    trialEndsAt?: Date | null;
  },
): Promise<StoredSubscription> {
  const now = new Date();
  const rows = await database
    .insert(subscription)
    .values({
      canceled: false,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      currentPeriodEndAt: input.currentPeriodEndAt ?? null,
      currentPeriodStartAt: input.currentPeriodStartAt ?? null,
      customerId: input.customerId,
      endedAt: null,
      id: generateId("sub"),
      productInternalId: input.productInternalId,
      providerId: input.providerId ?? null,
      providerData: input.providerData ?? null,
      quantity: 1,
      scheduledProductId: input.scheduledProductId ?? null,
      startedAt: input.startedAt ?? now,
      status: input.status,
      trialEndsAt: input.trialEndsAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create subscription.");
  }

  if (input.planFeatures.length > 0) {
    for (const planFeature of input.planFeatures) {
      const isBoolean = planFeature.type === "boolean";
      await database.insert(entitlement).values({
        balance: isBoolean ? null : (planFeature.limit ?? 0),
        customerId: input.customerId,
        featureId: planFeature.id,
        id: generateId("ent"),
        limit: isBoolean ? null : (planFeature.limit ?? null),
        nextResetAt: planFeature.resetInterval
          ? addResetInterval(now, planFeature.resetInterval)
          : null,
        subscriptionId: row.id,
      });
    }
  }

  return row;
}

export async function endSubscriptions(
  database: PayKitDatabase,
  subscriptionIds: readonly string[],
  input: { canceled?: boolean; canceledAt?: Date | null; endedAt?: Date | null; status: string },
): Promise<void> {
  if (subscriptionIds.length === 0) {
    return;
  }

  await database
    .update(subscription)
    .set({
      canceled: input.canceled ?? false,
      canceledAt: input.canceledAt ?? (input.canceled ? new Date() : null),
      endedAt: input.endedAt ?? new Date(),
      status: input.status,
      updatedAt: new Date(),
    })
    .where(inArray(subscription.id, [...subscriptionIds]));
}

export async function clearScheduledSubscriptionsInGroup(
  database: PayKitDatabase,
  input: { customerId: string; group: string },
): Promise<void> {
  const scheduled = await getScheduledSubscriptionsInGroup(database, input);
  if (scheduled.length === 0) {
    return;
  }

  await endSubscriptions(
    database,
    scheduled.map((item) => item.id),
    { endedAt: new Date(), status: "canceled" },
  );
}

export async function deleteSubscriptions(
  database: PayKitDatabase,
  subscriptionIds: readonly string[],
): Promise<void> {
  if (subscriptionIds.length === 0) {
    return;
  }

  await database
    .delete(entitlement)
    .where(inArray(entitlement.subscriptionId, [...subscriptionIds]));

  await database.delete(subscription).where(inArray(subscription.id, [...subscriptionIds]));
}

export async function deleteScheduledSubscriptionsInGroup(
  database: PayKitDatabase,
  input: { customerId: string; group: string },
): Promise<void> {
  const scheduled = await getScheduledSubscriptionsInGroup(database, input);
  if (scheduled.length === 0) {
    return;
  }

  await deleteSubscriptions(
    database,
    scheduled.map((item) => item.id),
  );
}

export async function scheduleSubscriptionCancellation(
  database: PayKitDatabase,
  input: {
    canceledAt?: Date | null;
    currentPeriodEndAt?: Date | null;
    subscriptionId: string;
  },
): Promise<void> {
  const existing = await getSubscriptionById(database, input.subscriptionId);
  if (!existing) {
    return;
  }

  await database
    .update(subscription)
    .set({
      canceled: true,
      canceledAt: input.canceledAt ?? new Date(),
      endedAt: input.currentPeriodEndAt ?? existing.endedAt,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, input.subscriptionId));
}

export async function replaceSubscriptionSchedule(
  database: PayKitDatabase,
  input: { subscriptionId: string; scheduledProductId?: string | null },
): Promise<void> {
  await database
    .update(subscription)
    .set({
      scheduledProductId: input.scheduledProductId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, input.subscriptionId));
}

export async function activateScheduledSubscription(
  database: PayKitDatabase,
  input: {
    currentPeriodEndAt?: Date | null;
    currentPeriodStartAt?: Date | null;
    subscriptionId: string;
    startedAt?: Date | null;
    status: string;
    providerId?: string | null;
    providerData?: Record<string, unknown> | null;
  },
): Promise<void> {
  await database
    .update(subscription)
    .set({
      canceled: false,
      canceledAt: null,
      currentPeriodEndAt: input.currentPeriodEndAt ?? null,
      currentPeriodStartAt: input.currentPeriodStartAt ?? null,
      endedAt: null,
      providerId: input.providerId,
      providerData: input.providerData ?? null,
      startedAt: input.startedAt ?? new Date(),
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, input.subscriptionId));
}

export async function getScheduledSubscriptionsReadyForActivation(
  database: PayKitDatabase,
  input: {
    customerId: string;
    group: string;
    now: Date;
  },
): Promise<readonly SubscriptionWithCatalog[]> {
  const result = (await database.execute(sql`
    select
      s.id,
      s.customer_id as "customerId",
      s.product_internal_id as "productInternalId",
      s.provider_id as "providerId",
      s.provider_data as "providerData",
      s.status,
      s.canceled,
      s.cancel_at_period_end as "cancelAtPeriodEnd",
      s.started_at as "startedAt",
      s.trial_ends_at as "trialEndsAt",
      s.current_period_start_at as "currentPeriodStartAt",
      s.current_period_end_at as "currentPeriodEndAt",
      s.canceled_at as "canceledAt",
      s.ended_at as "endedAt",
      s.scheduled_product_id as "scheduledProductId",
      s.quantity,
      s.created_at as "createdAt",
      s.updated_at as "updatedAt",
      p.id as "planId",
      p.name as "planName",
      p."group" as "planGroup",
      p.is_default as "planIsDefault",
      p.price_amount as "priceAmount",
      p.price_interval as "priceInterval",
      p.provider as "productProvider"
    from paykit_subscription s
    inner join paykit_product p on p.internal_id = s.product_internal_id
    where s.customer_id = ${input.customerId}
      and p."group" = ${input.group}
      and s.status = 'scheduled'
      and s.ended_at is null
      and (s.started_at is null or s.started_at <= ${input.now})
    order by s.created_at desc
  `)) as unknown as {
    rows: Array<SubscriptionWithCatalog & { productProvider: ProviderProductMap }>;
  };

  return result.rows.map((row) => {
    const { productProvider, ...rest } = row;
    return coerceTimestamps({
      ...rest,
      providerPriceId: Object.values(productProvider ?? {})[0]?.priceId ?? null,
    });
  });
}

export async function syncSubscriptionFromProvider(
  database: PayKitDatabase,
  input: {
    subscriptionId: string;
    providerSubscription: ProviderSubscription | NormalizedSubscription;
  },
): Promise<void> {
  const endedAt =
    input.providerSubscription.cancelAtPeriodEnd === false
      ? null
      : (input.providerSubscription.endedAt ?? null);
  const canceledAt =
    input.providerSubscription.cancelAtPeriodEnd === false
      ? null
      : (input.providerSubscription.canceledAt ?? null);

  await database
    .update(subscription)
    .set({
      canceled: input.providerSubscription.cancelAtPeriodEnd,
      cancelAtPeriodEnd: input.providerSubscription.cancelAtPeriodEnd,
      canceledAt,
      currentPeriodEndAt: input.providerSubscription.currentPeriodEndAt ?? null,
      currentPeriodStartAt: input.providerSubscription.currentPeriodStartAt ?? null,
      endedAt,
      status: input.providerSubscription.status,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, input.subscriptionId));
}

export async function syncSubscriptionBillingState(
  database: PayKitDatabase,
  input: {
    subscriptionId: string;
    currentPeriodEndAt?: Date | null;
    currentPeriodStartAt?: Date | null;
    providerData?: Record<string, unknown> | null;
    startedAt?: Date | null;
    status?: string;
  },
): Promise<void> {
  const existing = await database.query.subscription.findFirst({
    where: eq(subscription.id, input.subscriptionId),
  });
  if (!existing) {
    return;
  }

  await database
    .update(subscription)
    .set({
      currentPeriodEndAt:
        input.currentPeriodEndAt !== undefined
          ? input.currentPeriodEndAt
          : existing.currentPeriodEndAt,
      currentPeriodStartAt:
        input.currentPeriodStartAt !== undefined
          ? input.currentPeriodStartAt
          : existing.currentPeriodStartAt,
      providerData: input.providerData !== undefined ? input.providerData : existing.providerData,
      startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, input.subscriptionId));
}

export async function getCurrentSubscriptions(
  database: PayKitDatabase,
  customerId: string,
): Promise<
  readonly {
    currentPeriodEndAt: Date | null;
    endedAt: Date | null;
    id: string;
    startedAt: Date | null;
    status: string;
  }[]
> {
  const result = (await database.execute(sql`
    select
      p.id,
      s.status,
      s.started_at as "startedAt",
      s.current_period_end_at as "currentPeriodEndAt",
      s.ended_at as "endedAt"
    from paykit_subscription s
    inner join paykit_product p on p.internal_id = s.product_internal_id
    where s.customer_id = ${customerId}
      and (s.ended_at is null or s.ended_at > now() or s.status = 'scheduled')
    order by s.created_at desc
  `)) as unknown as {
    rows: Array<{
      currentPeriodEndAt: Date | null;
      endedAt: Date | null;
      id: string;
      startedAt: Date | null;
      status: string;
    }>;
  };

  return result.rows.map(coerceTimestamps);
}

export function buildSubscribeResult(input: {
  invoice?: ProviderInvoice | NormalizedInvoice | null;
  paymentUrl: string | null;
  requiredAction?: ProviderRequiredAction | null;
}): SubscribeResult {
  return {
    invoice: input.invoice ? normalizeInvoice(input.invoice) : undefined,
    paymentUrl: input.paymentUrl,
    requiredAction: input.requiredAction ?? null,
  };
}
