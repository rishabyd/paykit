import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectProduct,
  expectProductNotPresent,
  expectSingleActivePlanInGroup,
  expectSingleScheduledPlanInGroup,
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
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });

    await t.paykit.subscribe({
      customerId,
      planId: "ultra",
      successUrl: "https://example.com/success",
    });

    // Schedule downgrade to Pro
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
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
      await t.paykit.subscribe({
        customerId,
        planId: "free",
        successUrl: "https://example.com/success",
      });

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
