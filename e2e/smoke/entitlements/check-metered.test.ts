import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestCustomerWithPM,
  createTestPayKit,
  dumpStateOnFailure,
  expectExactMeteredBalance,
  type TestPayKit,
} from "../setup";

describe("check-metered: metered feature balance and usage reporting", () => {
  let t: TestPayKit;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestPayKit();
    const customer = await createTestCustomerWithPM({
      t,
      customer: {
        id: "test_check_metered",
        email: "check-metered@test.com",
        name: "Check Metered Test",
      },
    });
    customerId = customer.customerId;

    // Subscribe to Pro (500 messages/month)
    await t.paykit.subscribe({
      customerId,
      planId: "pro",
      successUrl: "https://example.com/success",
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("check returns correct balance, report decrements it", async () => {
    try {
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 500,
        remaining: 500,
      });

      // Report usage (consume 10)
      const report1 = await t.paykit.report({ customerId, featureId: "messages", amount: 10 });
      expect(report1.success).toBe(true);
      expect(report1.balance!.remaining).toBe(490);

      // Report more usage (consume 50)
      const report2 = await t.paykit.report({ customerId, featureId: "messages", amount: 50 });
      expect(report2.success).toBe(true);
      expect(report2.balance!.remaining).toBe(440);

      // Check reflects the usage
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 500,
        remaining: 440,
      });

      // Try to consume more than remaining
      const overReport = await t.paykit.report({ customerId, featureId: "messages", amount: 500 });
      expect(overReport.success).toBe(false);

      // Balance unchanged after failed report
      await expectExactMeteredBalance({
        paykit: t.paykit,
        customerId,
        featureId: "messages",
        limit: 500,
        remaining: 440,
      });
    } catch (error) {
      await dumpStateOnFailure(t.database, t.dbPath);
      throw error;
    }
  });
});
