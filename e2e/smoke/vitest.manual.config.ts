import { defineConfig } from "vitest/config";

import { smokeVitestTestConfig } from "./vitest.shared";

export default defineConfig({
  test: {
    ...smokeVitestTestConfig,
    include: [
      "smoke/checkout/resubscribe-after-cancel.test.ts",
      "smoke/checkout/subscribe-paid-checkout.test.ts",
      "smoke/lifecycle/subscription.test.ts",
    ],
  },
});
