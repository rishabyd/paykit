import { sql } from "drizzle-orm";

import { generateId } from "../core/utils";
import type { PayKitDatabase } from "../database";
import { invoice } from "../database/schema";
import type { NormalizedPayment } from "../types/events";
import { findCustomerByProviderCustomerId } from "./customer-service";

export async function syncPaymentByProviderCustomer(
  database: PayKitDatabase,
  input: {
    payment: NormalizedPayment;
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

  const providerData = {
    paymentId: input.payment.providerPaymentId,
    methodId: input.payment.providerMethodId ?? null,
  };

  const existing = (await database.execute(sql`
    select id
    from paykit_invoice
    where provider_id = ${input.providerId}
      and provider_data->>'paymentId' = ${input.payment.providerPaymentId}
    limit 1
  `)) as unknown as { rows: Array<{ id: string }> };

  if (existing.rows[0]) {
    await database.execute(sql`
      update paykit_invoice
      set status = ${input.payment.status},
          amount = ${input.payment.amount},
          updated_at = now()
      where id = ${existing.rows[0].id}
    `);
    return;
  }

  await database.insert(invoice).values({
    id: generateId("inv"),
    customerId: customerRow.id,
    type: "charge",
    status: input.payment.status,
    amount: input.payment.amount,
    currency: input.payment.currency,
    description: input.payment.description ?? null,
    providerId: input.providerId,
    providerData,
  });
}
