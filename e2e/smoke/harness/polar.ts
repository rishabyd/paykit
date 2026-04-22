import { polar } from "@paykitjs/polar";
import { chromium } from "playwright";

import { env } from "../../env";
import type { ProviderHarness } from "./types";

export function createPolarHarness(): ProviderHarness {
  const accessToken = env.E2E_POLAR_ACCESS_TOKEN;
  const webhookSecret = env.E2E_POLAR_WHSEC;
  if (!accessToken || !webhookSecret) {
    throw new Error("E2E_POLAR_ACCESS_TOKEN and E2E_POLAR_WHSEC must be set");
  }

  return {
    id: "polar",
    capabilities: {
      testClocks: false,
      directSubscription: false,
    },

    createProviderConfig() {
      return polar({ accessToken: accessToken!, webhookSecret: webhookSecret!, server: "sandbox" });
    },

    async setupCustomerForDirectSubscription(_providerCustomerId: string) {
      // Polar doesn't support direct subscription — always goes through checkout.
      // This is a no-op; tests will get a paymentUrl and call completeCheckout.
    },

    async completeCheckout(url: string) {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      try {
        await page.goto(url, { waitUntil: "networkidle" });

        // Polar sandbox checkout — fill test card details
        await page.fill(
          '[data-testid="card-number"], input[name="cardNumber"], input[placeholder*="card number" i]',
          "4242424242424242",
        );
        await page.fill(
          '[data-testid="card-expiry"], input[name="cardExpiry"], input[placeholder*="MM" i]',
          "12/30",
        );
        await page.fill(
          '[data-testid="card-cvc"], input[name="cardCvc"], input[placeholder*="CVC" i]',
          "123",
        );

        // Submit payment
        const submitButton = page.locator(
          'button[type="submit"], button:has-text("Pay"), button:has-text("Subscribe")',
        );
        await submitButton.click();

        // Wait for redirect to success URL or confirmation
        await page.waitForURL("**/success**", { timeout: 30_000 }).catch(() => {
          // Some checkouts show a confirmation page rather than redirecting
        });
      } finally {
        await browser.close();
      }
    },

    async cleanup(_ctx) {
      // Polar sandbox has no test clocks to clean up.
      // Subscriptions in sandbox are ephemeral.
    },

    validateEnv() {
      if (!env.E2E_POLAR_ACCESS_TOKEN || !env.E2E_POLAR_WHSEC) {
        throw new Error("E2E_POLAR_ACCESS_TOKEN and E2E_POLAR_WHSEC must be set");
      }
    },
  };
}
