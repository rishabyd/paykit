import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectNoScheduledPlanInGroup,
  expectProduct,
  expectSingleActivePlanInGroup,
  expectSubscription,
  subscribeCustomer,
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
      await subscribeCustomer({ t, customerId, planId: "pro" });

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
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
