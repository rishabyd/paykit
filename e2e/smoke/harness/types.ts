import type { PayKitProviderConfig } from "paykitjs";

export interface ProviderCapabilities {
  testClocks: boolean;
  directSubscription: boolean;
}

export interface ProviderHarness {
  id: string;
  capabilities: ProviderCapabilities;

  createProviderConfig(): PayKitProviderConfig;

  /**
   * Make the customer ready to subscribe without checkout (e.g., attach PM for Stripe).
   * For providers that only support checkout, this is a no-op.
   */
  setupCustomerForDirectSubscription(providerCustomerId: string): Promise<void>;

  /** Complete a hosted checkout given the URL (e.g., Playwright automation). */
  completeCheckout(url: string): Promise<void>;

  /** Provider-specific cleanup (e.g., delete test clocks). */
  cleanup(ctx: { providerCustomerIds: string[] }): Promise<void>;

  validateEnv(): void;
}
