import { env } from "../../env";
import { createPolarHarness } from "./polar";
import { createStripeHarness } from "./stripe";
import type { ProviderHarness } from "./types";

export type { ProviderCapabilities, ProviderHarness } from "./types";

export function loadHarness(): ProviderHarness {
  const provider = env.PROVIDER;

  switch (provider) {
    case "stripe":
      return createStripeHarness();
    case "polar":
      return createPolarHarness();
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: stripe, polar`);
  }
}
