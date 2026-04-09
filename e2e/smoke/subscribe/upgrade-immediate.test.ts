import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectNoScheduledPlanInGroup,
  expectProduct,
  expectSingleActivePlanInGroup,
  type TestPayKit,
} from "../setup";

describe("upgrade-immediate: pro → ultra", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_upgrade",
        email: "upgrade@test.com",
        name: "Upgrade Test",
      },
    });
    customerId = customer.customerId;

    // Setup: subscribe to Pro first
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("upgrading to a higher tier activates it immediately and ends the old plan", async () => {
    try {
      await t.paykit.subscribe({
        customerId,
        planId: "ultra",
        successUrl: "https://example.com/success",
      });

      // Ultra is active with period dates
      await expectProduct({
        database: t.database,
        customerId,
        planId: "ultra",
        expected: {
          status: "active",
          hasPeriodEnd: true,
        },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "ultra",
      });
      await expectNoScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
      });
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 10_000,
        remaining: 10_000,
      });

      // Pro is ended
      await expectProduct({
        database: t.database,
        customerId,
        planId: "pro",
        expected: { status: "ended" },
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
