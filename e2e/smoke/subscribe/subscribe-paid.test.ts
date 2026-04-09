import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectInvoiceCount,
  expectNoScheduledPlanInGroup,
  expectProduct,
  expectSingleActivePlanInGroup,
  expectSubscription,
  type TestPayKit,
} from "../setup";

describe("subscribe-paid: free → pro", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_sub_paid",
        email: "sub-paid@test.com",
        name: "Subscribe Paid Test",
      },
    });
    customerId = customer.customerId;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("subscribing to a paid plan from free creates an active subscription", async () => {
    try {
      const result = await t.paykit.subscribe({
        customerId,
        planId: "pro",
        successUrl: "https://example.com/success",
      });

      // Direct path (has payment method, no checkout)
      if (result.paymentUrl != null) {
        throw new Error("Expected direct subscription, got checkout URL");
      }

      // Pro is active with period dates
      await expectProduct({
        database: t.database,
        customerId,
        planId: "pro",
        expected: {
          status: "active",
          hasPeriodEnd: true,
        },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "pro",
      });
      await expectNoScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
      });

      // Free is ended
      await expectProduct({
        database: t.database,
        customerId,
        planId: "free",
        expected: { status: "ended" },
      });
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 500,
        remaining: 500,
      });

      // Subscription exists and is active
      await expectSubscription({
        database: t.database,
        customerId,
        expected: { status: "active" },
      });

      // At least 1 invoice
      await expectInvoiceCount({
        database: t.database,
        customerId,
        expectedAtLeast: 1,
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
