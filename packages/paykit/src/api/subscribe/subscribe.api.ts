import { PayKitError, PAYKIT_ERROR_CODES } from "../../core/errors";
import { createPayKitEndpoint } from "../call";
import { resolveCustomer } from "../resolve-customer";
import { subscribeToPlan } from "./subscribe.service";
import { subscribeBodySchema } from "./subscribe.types";

function resolveSuccessUrl(request: Request | undefined, explicitSuccessUrl?: string): string {
  if (explicitSuccessUrl) {
    return explicitSuccessUrl;
  }

  if (!request) {
    throw PayKitError.from("BAD_REQUEST", PAYKIT_ERROR_CODES.SUCCESS_URL_REQUIRED);
  }

  return new URL("/", request.url).toString();
}

export const subscribe = createPayKitEndpoint(
  "/subscribe",
  {
    method: "POST",
    body: subscribeBodySchema,
  },
  async (ctx) => {
    const customerId = await resolveCustomer(ctx.context, ctx.request, ctx.body.customerId);
    return subscribeToPlan(ctx.context, {
      cancelUrl: ctx.body.cancelUrl,
      customerId,
      forceCheckout: ctx.body.forceCheckout,
      planId: ctx.body.planId,
      successUrl: resolveSuccessUrl(ctx.request, ctx.body.successUrl),
    });
  },
);
