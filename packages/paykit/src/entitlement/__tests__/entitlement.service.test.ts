import { describe, expect, it, vi } from "vitest";

import { reportEntitlement } from "../entitlement.service";

const createUpdateResult = (balance: number) => {
  return [{ balance }];
};

describe("entitlement/service", () => {
  it("consumes usage across stacked entitlement rows", async () => {
    const update = vi
      .fn()
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(createUpdateResult(0)),
          }),
        }),
      })
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(createUpdateResult(2)),
          }),
        }),
      });
    const database = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  balance: 3,
                  id: "ent_1",
                  nextResetAt: new Date("2024-02-01T00:00:00.000Z"),
                  originalLimit: 3,
                  resetInterval: "month",
                },
                {
                  balance: 4,
                  id: "ent_2",
                  nextResetAt: new Date("2024-02-01T00:00:00.000Z"),
                  originalLimit: 4,
                  resetInterval: "month",
                },
              ]),
            }),
          }),
        }),
      }),
      update,
    } as never;

    const result = await reportEntitlement(database, {
      amount: 5,
      customerId: "customer_123",
      featureId: "feature_api_calls",
      now: new Date("2024-01-15T00:00:00.000Z"),
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      balance: {
        limit: 7,
        remaining: 2,
        resetAt: new Date("2024-02-01T00:00:00.000Z"),
        unlimited: false,
      },
      success: true,
    });
  });
});
