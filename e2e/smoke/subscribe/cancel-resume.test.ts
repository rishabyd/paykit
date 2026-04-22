import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  expectProductNotPresent,
  expectSingleActivePlanInGroup,
  expectSingleScheduledPlanInGroup,
  expectSubscription,
  subscribeCustomer,
  type TestPayKit,
} from "../setup";

describe("cancel-resume: pro → free → pro (resume)", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_resume",
        email: "resume@test.com",
        name: "Cancel Resume Test",
      },
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro, then schedule downgrade to Free
    await subscribeCustomer({ t, customerId, planId: "pro" });

    await subscribeCustomer({ t, customerId, planId: "free" });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("re-subscribing to the current plan cancels the scheduled downgrade", async () => {
    try {
      // Verify precondition: Pro is canceling, Free is scheduled
      await expectProduct({
        database: t.database,
        customerId,
        planId: "pro",
        expected: {
          status: "active",
          canceled: true,
        },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "pro",
      });
      await expectSingleScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "free",
      });

      // Action: resume Pro
      await subscribeCustomer({ t, customerId, planId: "pro" });

      // Pro is active and no longer canceled
      await expectProduct({
        database: t.database,
        customerId,
        planId: "pro",
        expected: {
          status: "active",
          canceled: false,
        },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "pro",
      });

      // Scheduled Free is deleted
      await expectProductNotPresent({
        database: t.database,
        customerId,
        planId: "free",
      });

      // Subscription no longer set to cancel
      await expectSubscription({
        database: t.database,
        customerId,
        expected: { cancelAtPeriodEnd: false },
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
