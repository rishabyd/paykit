import * as z from "zod";

import { definePayKitMethod } from "../api/define-route";
import { PayKitError, PAYKIT_ERROR_CODES } from "../core/errors";
import {
  getCustomerWithDetails,
  getProviderCustomerIdForCustomer,
  hardDeleteCustomer,
  listCustomers,
  syncCustomerWithDefaults,
} from "./customer.service";

const upsertCustomerSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const customerIdSchema = z.object({
  id: z.string(),
});

const listCustomersSchema = z
  .object({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().min(0).optional(),
    planIds: z.array(z.string()).optional(),
  })
  .optional();

function resolveReturnUrl(request: Request | undefined, explicitReturnUrl?: string): string {
  if (explicitReturnUrl) {
    return explicitReturnUrl;
  }

  if (!request) {
    throw PayKitError.from(
      "BAD_REQUEST",
      PAYKIT_ERROR_CODES.SUCCESS_URL_REQUIRED,
      "A returnUrl is required when openCustomerPortal is called without a request context",
    );
  }

  return new URL("/", request.url).toString();
}

export const upsertCustomer = definePayKitMethod({ input: upsertCustomerSchema }, async (ctx) =>
  syncCustomerWithDefaults(ctx.paykit, ctx.input),
);

export const getCustomer = definePayKitMethod({ input: customerIdSchema }, async (ctx) =>
  getCustomerWithDetails(ctx.paykit, ctx.input.id),
);

export const deleteCustomer = definePayKitMethod({ input: customerIdSchema }, async (ctx) => {
  await hardDeleteCustomer(ctx.paykit, ctx.input.id);
  return { success: true };
});

export const listCustomersMethod = definePayKitMethod({ input: listCustomersSchema }, async (ctx) =>
  listCustomers(ctx.paykit, ctx.input),
);

/** Opens the provider customer portal for the resolved customer. */
export const customerPortal = definePayKitMethod(
  {
    input: z.object({
      returnUrl: z.string().url().optional(),
    }),
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/customer-portal",
    },
  },
  async (ctx) => {
    const providerCustomerId = await getProviderCustomerIdForCustomer(ctx.paykit.database, {
      customerId: ctx.customer.id,
      providerId: ctx.paykit.provider.id,
    });

    if (!providerCustomerId) {
      throw PayKitError.from("NOT_FOUND", PAYKIT_ERROR_CODES.PROVIDER_CUSTOMER_NOT_FOUND);
    }

    const { url } = await ctx.paykit.stripe.createPortalSession({
      providerCustomerId,
      returnUrl: resolveReturnUrl(ctx.request, ctx.input.returnUrl),
    });

    return { url };
  },
);
