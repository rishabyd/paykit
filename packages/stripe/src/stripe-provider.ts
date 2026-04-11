import type { StripeProviderConfig, StripeProviderOptions } from "paykitjs";

export type { StripeProviderConfig, StripeProviderOptions } from "paykitjs";
export { PAYKIT_STRIPE_API_VERSION } from "paykitjs";

export function stripe(options: StripeProviderOptions): StripeProviderConfig {
  return {
    ...options,
    id: "stripe",
    kind: "stripe",
  };
}
