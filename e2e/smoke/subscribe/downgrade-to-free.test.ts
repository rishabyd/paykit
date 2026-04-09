import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectProduct,
  expectSingleActivePlanInGroup,
  expectSingleScheduledPlanInGroup,
  type TestPayKit,
} from "../setup";

describe("downgrade-to-free: pro → free", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_downgrade_free",
        email: "downgrade-free@test.com",
        name: "Downgrade to Free Test",
      },
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("downgrading to free schedules cancellation at period end", async () => {
    try {
      await t.paykit.subscribe({
        customerId,
        planId: "free",
        successUrl: "https://example.com/success",
      });

      // Pro is still active but canceled
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

      // Free is scheduled
      await expectSingleScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "free",
      });
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 500,
        remaining: 500,
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
