import { afterAll, beforeAll, describe, it } from "vitest";

import {
  createTestCustomer,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  expectNoScheduledPlanInGroup,
  expectProduct,
  expectSingleActivePlanInGroup,
  type TestPayKit,
} from "../setup";

describe("default-free: customer creation", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomer({
      t,
      customer: {
        id: "test_default_free",
        email: "default-free@test.com",
        name: "Default Free Test",
      },
    });
    customerId = customer.customerId;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("creating a customer auto-creates the default free subscription", async () => {
    try {
      await expectProduct({
        database: t.database,
        customerId,
        planId: "free",
        expected: {
          status: "active",
          hasPeriodEnd: false,
        },
      });
      await expectSingleActivePlanInGroup({
        database: t.database,
        customerId,
        group: "base",
        planId: "free",
      });
      await expectNoScheduledPlanInGroup({
        database: t.database,
        customerId,
        group: "base",
      });
      await expectExactMeteredBalance({
        customerId,
        featureId: "messages",
        limit: 100,
        paykit: t.paykit,
        remaining: 100,
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
