import { and, eq, isNull, sql } from "drizzle-orm";

import { generateId } from "../core/utils";
import type { PayKitDatabase } from "../database";
import { paymentMethod } from "../database/schema";
import type { NormalizedPaymentMethod } from "../types/events";
import { findCustomerByProviderCustomerId } from "./customer-service";

export async function getDefaultPaymentMethod(
  database: PayKitDatabase,
  input: { customerId: string; providerId: string },
) {
  return (
    (await database.query.paymentMethod.findFirst({
      orderBy(fields, operators) {
        return [operators.desc(fields.isDefault), operators.desc(fields.createdAt)];
      },
      where: and(
        eq(paymentMethod.customerId, input.customerId),
        eq(paymentMethod.providerId, input.providerId),
        isNull(paymentMethod.deletedAt),
      ),
    })) ?? null
  );
}

export async function syncPaymentMethodByProviderCustomer(
  database: PayKitDatabase,
  input: {
    paymentMethod: NormalizedPaymentMethod;
    providerCustomerId: string;
    providerId: string;
  },
): Promise<void> {
  const customerRow = await findCustomerByProviderCustomerId(database, {
    providerCustomerId: input.providerCustomerId,
    providerId: input.providerId,
  });
  if (!customerRow) {
    return;
  }

  const now = new Date();
  const providerData = {
    methodId: input.paymentMethod.providerMethodId,
    type: input.paymentMethod.type,
    last4: input.paymentMethod.last4 ?? null,
    expiryMonth: input.paymentMethod.expiryMonth ?? null,
    expiryYear: input.paymentMethod.expiryYear ?? null,
  };

  const existing = (await database.execute(sql`
    select id, is_default as "isDefault"
    from paykit_payment_method
    where provider_id = ${input.providerId}
      and provider_data->>'methodId' = ${input.paymentMethod.providerMethodId}
      and deleted_at is null
    limit 1
  `)) as unknown as { rows: Array<{ id: string; isDefault: boolean }> };

  if (input.paymentMethod.isDefault) {
    await database
      .update(paymentMethod)
      .set({ isDefault: false, updatedAt: now })
      .where(
        and(
          eq(paymentMethod.customerId, customerRow.id),
          eq(paymentMethod.providerId, input.providerId),
        ),
      );
  }

  const existingRow = existing.rows[0];
  if (existingRow) {
    await database
      .update(paymentMethod)
      .set({
        customerId: customerRow.id,
        deletedAt: null,
        isDefault: input.paymentMethod.isDefault ?? existingRow.isDefault,
        providerData,
        updatedAt: now,
      })
      .where(eq(paymentMethod.id, existingRow.id));
    return;
  }

  await database.insert(paymentMethod).values({
    customerId: customerRow.id,
    deletedAt: null,
    id: generateId("pm"),
    isDefault: input.paymentMethod.isDefault ?? false,
    providerId: input.providerId,
    providerData,
  });
}

export async function deletePaymentMethodByProviderId(
  database: PayKitDatabase,
  input: {
    providerId: string;
    providerMethodId: string;
  },
): Promise<void> {
  await database.execute(sql`
    update paykit_payment_method
    set deleted_at = now(), is_default = false, updated_at = now()
    where provider_id = ${input.providerId}
      and provider_data->>'methodId' = ${input.providerMethodId}
  `);
}
