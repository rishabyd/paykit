import { stripe } from "@paykitjs/stripe";
import { default as Stripe } from "stripe";

import type { PayKitDatabase } from "../../../packages/paykit/src/database/index";
import { syncPaymentMethodByProviderCustomer } from "../../../packages/paykit/src/payment-method/payment-method.service";
import { env } from "../../env";
import type { ProviderHarness } from "./types";

export function createStripeHarness(): ProviderHarness {
  const secretKey = env.E2E_STRIPE_SK;
  const webhookSecret = env.E2E_STRIPE_WHSEC;
  if (!secretKey || !webhookSecret) {
    throw new Error("E2E_STRIPE_SK and E2E_STRIPE_WHSEC must be set");
  }

  const stripeClient = new Stripe(secretKey);

  return {
    id: "stripe",
    capabilities: {
      testClocks: true,
      directSubscription: true,
    },

    createProviderConfig() {
      return stripe({ secretKey, webhookSecret });
    },

    async setupCustomerForDirectSubscription(providerCustomerId: string) {
      const pm = await stripeClient.paymentMethods.attach("pm_card_visa", {
        customer: providerCustomerId,
      });
      await stripeClient.customers.update(providerCustomerId, {
        invoice_settings: { default_payment_method: pm.id },
      });
    },

    async completeCheckout(_url: string) {
      throw new Error("Stripe direct-subscription tests should not need checkout completion");
    },

    async cleanup(ctx) {
      // Delete test clocks for all customers
      for (const providerCustomerId of ctx.providerCustomerIds) {
        try {
          const customer = await stripeClient.customers.retrieve(providerCustomerId);
          if ("deleted" in customer && customer.deleted) continue;
          const testClockId = (customer as Stripe.Customer).test_clock;
          if (testClockId && typeof testClockId === "string") {
            await stripeClient.testHelpers.testClocks.del(testClockId).catch(() => {});
          }
        } catch {
          // Customer may already be deleted
        }
      }
    },

    validateEnv() {
      if (!env.E2E_STRIPE_SK || !env.E2E_STRIPE_WHSEC) {
        throw new Error("E2E_STRIPE_SK and E2E_STRIPE_WHSEC must be set");
      }
    },
  };
}

/** Sync a Stripe payment method into the PayKit database. */
export async function syncStripePaymentMethod(input: {
  database: PayKitDatabase;
  providerCustomerId: string;
  providerId: string;
  stripeClient: Stripe;
}): Promise<void> {
  const pm = await input.stripeClient.paymentMethods.list({
    customer: input.providerCustomerId,
    type: "card",
    limit: 1,
  });
  const method = pm.data[0];
  if (!method) return;

  await syncPaymentMethodByProviderCustomer(input.database, {
    paymentMethod: {
      providerMethodId: method.id,
      type: method.type,
      last4: method.card?.last4,
      expiryMonth: method.card?.exp_month,
      expiryYear: method.card?.exp_year,
      isDefault: true,
    },
    providerCustomerId: input.providerCustomerId,
    providerId: input.providerId,
  });
}
