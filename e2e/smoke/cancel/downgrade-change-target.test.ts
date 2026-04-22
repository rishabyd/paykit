import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  expectProductNotPresent,
  expectSingleActivePlanInGroup,
  expectSingleScheduledPlanInGroup,
  subscribeCustomer,
  type TestPayKit,
} from "../setup";

describe("downgrade-change-target: ultra → pro (scheduled) → free (change target)", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_change_target",
        email: "change-target@test.com",
        name: "Change Target Test",
      },
    });
    customerId = customer.customerId;

    // Setup: subscribe Pro → upgrade Ultra
    await subscribeCustomer({ t, customerId, planId: "pro" });

    await subscribeCustomer({ t, customerId, planId: "ultra" });

    // Schedule downgrade to Pro
    await subscribeCustomer({ t, customerId, planId: "pro" });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("changing the scheduled downgrade target replaces the old scheduled product", async () => {
    try {
      // Verify precondition: Ultra canceling, Pro scheduled
      await expectProduct({
        database: t.database,
        customerId,
        planId: "ultra",
        expected: { status: "active", canceled: true },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "ultra",
      });
      await expectSingleScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "pro",
      });

      // Action: change downgrade target to Free instead
      await subscribeCustomer({ t, customerId, planId: "free" });

      // Ultra still canceling
      await expectProduct({
        database: t.database,
        customerId,
        planId: "ultra",
        expected: { status: "active", canceled: true },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "ultra",
      });

      // Pro scheduled is gone, Free is now scheduled
      await expectProductNotPresent({
        database: t.database,
        customerId,
        planId: "pro",
      });
      await expectSingleScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "free",
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
