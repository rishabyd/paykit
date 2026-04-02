import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { PayKitContext } from "../core/context";
import { PayKitError } from "../core/errors";
import type { PayKitDatabase } from "../database";
import { customer, entitlement, invoice, paymentMethod, subscription } from "../database/schema";
import type {
  CustomerEntitlement,
  CustomerSubscription,
  CustomerWithDetails,
  ListCustomersResult,
} from "../types/instance";
import type { Customer } from "../types/models";
import {
  getActiveSubscriptionInGroup,
  getScheduledSubscriptionsInGroup,
  insertSubscriptionRecord,
} from "./billing-service";
import { getLatestProductWithPrice } from "./product-service";

export interface SyncCustomerInput {
  id: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}

export async function syncCustomer(
  database: PayKitDatabase,
  input: SyncCustomerInput,
): Promise<Customer> {
  const now = new Date();
  const existing = await database.query.customer.findFirst({
    where: eq(customer.id, input.id),
  });

  if (existing) {
    const rows = await database
      .update(customer)
      .set({
        email: input.email ?? existing.email ?? null,
        name: input.name ?? existing.name ?? null,
        metadata: input.metadata ?? existing.metadata ?? null,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(customer.id, existing.id))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update customer.");
    }
    return row;
  }

  const rows = await database
    .insert(customer)
    .values({
      id: input.id,
      email: input.email ?? null,
      name: input.name ?? null,
      metadata: input.metadata ?? null,
      deletedAt: null,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create customer.");
  }
  return row;
}

export async function ensureDefaultPlansForCustomer(
  ctx: PayKitContext,
  customerId: string,
): Promise<void> {
  const defaultPlans = ctx.plans.plans.filter((plan) => plan.isDefault);
  if (defaultPlans.length === 0) {
    return;
  }

  for (const defaultPlan of defaultPlans) {
    if (!defaultPlan.group) {
      continue;
    }

    const activeSub = await getActiveSubscriptionInGroup(ctx.database, {
      customerId,
      group: defaultPlan.group,
    });
    if (activeSub) {
      continue;
    }

    const scheduledSubs = await getScheduledSubscriptionsInGroup(ctx.database, {
      customerId,
      group: defaultPlan.group,
    });
    if (scheduledSubs.length > 0) {
      continue;
    }

    const storedPlan = await getLatestProductWithPrice(ctx.database, {
      id: defaultPlan.id,
      providerId: ctx.provider.id,
    });
    if (!storedPlan) {
      continue;
    }

    if (storedPlan.priceAmount !== null) {
      ctx.logger.warn(
        `Skipping default plan "${defaultPlan.id}" for customer "${customerId}" because paid default plans are not auto-attached yet.`,
      );
      continue;
    }

    await insertSubscriptionRecord(ctx.database, {
      customerId,
      planFeatures: defaultPlan.includes,
      productInternalId: storedPlan.internalId,
      startedAt: new Date(),
      status: "active",
    });
  }
}

export async function syncCustomerWithDefaults(
  ctx: PayKitContext,
  input: SyncCustomerInput,
): Promise<Customer> {
  const syncedCustomer = await syncCustomer(ctx.database, input);
  await ensureDefaultPlansForCustomer(ctx, syncedCustomer.id);
  return syncedCustomer;
}

export async function getCustomerById(
  database: PayKitDatabase,
  customerId: string,
): Promise<Customer | null> {
  return (
    (await database.query.customer.findFirst({
      where: and(eq(customer.id, customerId), isNull(customer.deletedAt)),
    })) ?? null
  );
}

export async function getCustomerByIdOrThrow(
  database: PayKitDatabase,
  customerId: string,
): Promise<Customer> {
  const existingCustomer = await getCustomerById(database, customerId);
  if (!existingCustomer) {
    throw new PayKitError("CUSTOMER_NOT_FOUND");
  }

  return existingCustomer;
}

type ProviderCustomerMap = Record<string, { id: string }>;

export function getProviderCustomerId(customerRow: Customer, providerId: string): string | null {
  const providerMap = (customerRow.provider ?? {}) as ProviderCustomerMap;
  return providerMap[providerId]?.id ?? null;
}

export async function getProviderCustomerIdForCustomer(
  database: PayKitDatabase,
  input: { customerId: string; providerId: string },
): Promise<string | null> {
  const row = await database.query.customer.findFirst({
    where: eq(customer.id, input.customerId),
  });
  if (!row) return null;
  return getProviderCustomerId(row, input.providerId);
}

export async function findCustomerByProviderCustomerId(
  database: PayKitDatabase,
  input: { providerCustomerId: string; providerId: string },
): Promise<Customer | null> {
  const result = (await database.execute(sql`
    select *
    from paykit_customer
    where provider->${input.providerId}->>'id' = ${input.providerCustomerId}
    limit 1
  `)) as unknown as { rows: Customer[] };
  return result.rows[0] ?? null;
}

export async function upsertProviderCustomer(
  ctx: PayKitContext,
  input: { customerId: string },
): Promise<{ customerId: string; providerCustomerId: string }> {
  const providerId = ctx.provider.id;

  const existingCustomer = await getCustomerByIdOrThrow(ctx.database, input.customerId);
  const existingProviderCustomerId = getProviderCustomerId(existingCustomer, providerId);

  if (existingProviderCustomerId) {
    return { customerId: input.customerId, providerCustomerId: existingProviderCustomerId };
  }

  const { providerCustomerId } = await ctx.stripe.upsertCustomer({
    id: existingCustomer.id,
    email: existingCustomer.email ?? undefined,
    name: existingCustomer.name ?? undefined,
    metadata: existingCustomer.metadata ?? undefined,
  });

  const providerMap = (existingCustomer.provider ?? {}) as ProviderCustomerMap;
  providerMap[providerId] = { id: providerCustomerId };

  await ctx.database
    .update(customer)
    .set({ provider: providerMap, updatedAt: new Date() })
    .where(eq(customer.id, input.customerId));

  return { customerId: input.customerId, providerCustomerId };
}

export async function deleteCustomerFromDatabase(
  database: PayKitDatabase,
  customerId: string,
): Promise<void> {
  const subIds = await database
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.customerId, customerId));
  const sIds = subIds.map((row) => row.id);

  if (sIds.length > 0) {
    await database.delete(entitlement).where(inArray(entitlement.subscriptionId, sIds));
  }

  await database.delete(subscription).where(eq(subscription.customerId, customerId));
  await database.delete(invoice).where(eq(invoice.customerId, customerId));
  await database.delete(paymentMethod).where(eq(paymentMethod.customerId, customerId));
  await database.delete(customer).where(eq(customer.id, customerId));
}

export async function hardDeleteCustomer(ctx: PayKitContext, customerId: string): Promise<void> {
  const existingCustomer = await getCustomerByIdOrThrow(ctx.database, customerId);

  const providerCustomerId = getProviderCustomerId(existingCustomer, ctx.provider.id);
  if (providerCustomerId) {
    try {
      const activeSubscriptions = await ctx.stripe.listActiveSubscriptions({
        providerCustomerId,
      });
      for (const sub of activeSubscriptions) {
        await ctx.stripe.cancelSubscription({
          providerSubscriptionId: sub.providerSubscriptionId,
        });
      }
      await ctx.stripe.deleteCustomer({ providerCustomerId });
    } catch (error) {
      ctx.logger.error(`Failed to clean up Stripe customer ${providerCustomerId}:`, error);
    }
  }

  await deleteCustomerFromDatabase(ctx.database, customerId);
}

export async function listCustomers(
  ctx: PayKitContext,
  input?: {
    limit?: number;
    offset?: number;
    planIds?: string[];
  },
): Promise<ListCustomersResult> {
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;
  const planIds = input?.planIds;

  let customerRows: Customer[];
  let total: number;

  if (planIds && planIds.length > 0) {
    const filteredResult = (await ctx.database.execute(sql`
      select distinct c.*
      from paykit_customer c
      inner join paykit_subscription s on s.customer_id = c.id
      inner join paykit_product p on p.internal_id = s.product_internal_id
      where p.id in ${sql`(${sql.join(
        planIds.map((id) => sql`${id}`),
        sql`, `,
      )})`}
        and s.status in ('active', 'trialing', 'past_due')
        and (s.ended_at is null or s.ended_at > now())
        and c.deleted_at is null
      order by c.created_at desc
      limit ${limit}
      offset ${offset}
    `)) as unknown as { rows: Customer[] };
    customerRows = filteredResult.rows;

    const countResult = (await ctx.database.execute(sql`
      select count(distinct c.id)::int as count
      from paykit_customer c
      inner join paykit_subscription s on s.customer_id = c.id
      inner join paykit_product p on p.internal_id = s.product_internal_id
      where p.id in ${sql`(${sql.join(
        planIds.map((id) => sql`${id}`),
        sql`, `,
      )})`}
        and s.status in ('active', 'trialing', 'past_due')
        and (s.ended_at is null or s.ended_at > now())
        and c.deleted_at is null
    `)) as unknown as { rows: Array<{ count: number }> };
    total = countResult.rows[0]?.count ?? 0;
  } else {
    const countResult = await ctx.database
      .select({ count: count() })
      .from(customer)
      .where(isNull(customer.deletedAt));
    total = countResult[0]?.count ?? 0;

    customerRows = await ctx.database.query.customer.findMany({
      where: isNull(customer.deletedAt),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
      limit,
      offset,
    });
  }

  const customerIds = customerRows.map((c) => c.id);
  const data: CustomerWithDetails[] = [];

  if (customerIds.length > 0) {
    const subscriptionRows = (await ctx.database.execute(sql`
      select
        s.customer_id as "customerId",
        p.id as "planId",
        s.status,
        s.cancel_at_period_end as "cancelAtPeriodEnd",
        s.current_period_start_at as "currentPeriodStart",
        s.current_period_end_at as "currentPeriodEnd"
      from paykit_subscription s
      inner join paykit_product p on p.internal_id = s.product_internal_id
      where s.customer_id in ${sql`(${sql.join(
        customerIds.map((id) => sql`${id}`),
        sql`, `,
      )})`}
        and s.status in ('active', 'trialing', 'past_due', 'scheduled')
        and (s.ended_at is null or s.ended_at > now())
      order by s.created_at desc
    `)) as unknown as {
      rows: Array<CustomerSubscription & { customerId: string }>;
    };

    const entitlementRows = (await ctx.database.execute(sql`
      select
        e.customer_id as "customerId",
        e.feature_id as "featureId",
        e.balance,
        e."limit",
        case when e."limit" is null then 0 else coalesce(e."limit", 0) - coalesce(e.balance, 0) end as "usage",
        case when e."limit" is null then true else false end as "unlimited",
        e.next_reset_at as "nextResetAt"
      from paykit_entitlement e
      inner join paykit_subscription s on s.id = e.subscription_id
      where e.customer_id in ${sql`(${sql.join(
        customerIds.map((id) => sql`${id}`),
        sql`, `,
      )})`}
        and s.status in ('active', 'trialing', 'past_due')
        and (s.ended_at is null or s.ended_at > now())
    `)) as unknown as {
      rows: Array<CustomerEntitlement & { customerId: string }>;
    };

    const subscriptionsByCustomer = new Map<string, CustomerSubscription[]>();
    for (const row of subscriptionRows) {
      const list = subscriptionsByCustomer.get(row.customerId) ?? [];
      list.push({
        planId: row.planId,
        status: row.status,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        currentPeriodStart: row.currentPeriodStart
          ? new Date(row.currentPeriodStart as unknown as string)
          : null,
        currentPeriodEnd: row.currentPeriodEnd
          ? new Date(row.currentPeriodEnd as unknown as string)
          : null,
      });
      subscriptionsByCustomer.set(row.customerId, list);
    }

    const entitlementsByCustomer = new Map<string, Record<string, CustomerEntitlement>>();
    for (const row of entitlementRows) {
      const map = entitlementsByCustomer.get(row.customerId) ?? {};
      map[row.featureId] = {
        featureId: row.featureId,
        balance: Number(row.balance),
        limit: Number(row.limit),
        usage: Number(row.usage),
        unlimited: row.unlimited,
        nextResetAt: row.nextResetAt ? new Date(row.nextResetAt as unknown as string) : null,
      };
      entitlementsByCustomer.set(row.customerId, map);
    }

    for (const c of customerRows) {
      data.push({
        ...c,
        subscriptions: subscriptionsByCustomer.get(c.id) ?? [],
        entitlements: entitlementsByCustomer.get(c.id) ?? {},
      });
    }
  }

  return {
    data,
    total,
    hasMore: offset + limit < total,
    limit,
    offset,
  };
}
