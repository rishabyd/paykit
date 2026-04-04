import { definePayKitMethod } from "../api/define-route";
import { PayKitError, PAYKIT_ERROR_CODES } from "../core/errors";
import { subscribeToPlan } from "./subscription.service";
import { subscribeBodySchema } from "./subscription.types";

function resolveSuccessUrl(request: Request | undefined, explicitSuccessUrl?: string): string {
  if (explicitSuccessUrl) {
    return explicitSuccessUrl;
  }

  if (!request) {
    throw PayKitError.from("BAD_REQUEST", PAYKIT_ERROR_CODES.SUCCESS_URL_REQUIRED);
  }

  return new URL("/", request.url).toString();
}

/** Applies a subscription change for the resolved customer. */
export const subscribe = definePayKitMethod(
  {
    input: subscribeBodySchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/subscribe",
    },
  },
  async (ctx) => {
    return subscribeToPlan(ctx.paykit, {
      cancelUrl: ctx.input.cancelUrl,
      customerId: ctx.customer.id,
      forceCheckout: ctx.input.forceCheckout,
      planId: ctx.input.planId,
      successUrl: resolveSuccessUrl(ctx.request, ctx.input.successUrl),
    });
  },
);
