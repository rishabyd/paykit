import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PayKitContext } from "../../core/context";
import type { Customer } from "../../types/models";
import { syncCustomerWithDefaults } from "../customer.service";

function createCustomerRow(overrides: Partial<Customer> = {}): Customer {
  const now = new Date("2024-01-01T00:00:00.000Z");

  return {
    createdAt: now,
    deletedAt: null,
    email: null,
    id: "customer_123",
    metadata: null,
    name: null,
    provider: {},
    updatedAt: now,
    ...overrides,
  };
}

function createUpdateChain(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { returning, set, where };
}

describe("customer/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provisions and stores a provider customer during testing-mode sync", async () => {
    const syncedCustomer = createCustomerRow({
      email: "test@example.com",
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });
    const syncUpdate = createUpdateChain([syncedCustomer]);
    const providerUpdate = createUpdateChain(undefined);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(createCustomerRow())
      .mockResolvedValueOnce(syncedCustomer)
      .mockResolvedValueOnce(syncedCustomer);
    const stripe = {
      advanceTestClock: vi.fn(),
      attachPaymentMethod: vi.fn(),
      cancelSubscription: vi.fn(),
      createInvoice: vi.fn(),
      createPortalSession: vi.fn(),
      createSubscription: vi.fn(),
      createSubscriptionCheckout: vi.fn(),
      deleteCustomer: vi.fn(),
      detachPaymentMethod: vi.fn(),
      getTestClock: vi.fn(),
      handleWebhook: vi.fn(),
      listActiveSubscriptions: vi.fn(),
      resumeSubscription: vi.fn(),
      scheduleSubscriptionChange: vi.fn(),
      syncProduct: vi.fn(),
      updateSubscription: vi.fn(),
      upsertCustomer: vi.fn().mockResolvedValue({
        providerCustomer: {
          frozenTime: "2024-01-01T00:00:00.000Z",
          id: "cus_123",
          testClockId: "clock_123",
        },
      }),
    };
    const ctx = {
      database: {
        query: {
          customer: {
            findFirst,
          },
        },
        update: vi
          .fn()
          .mockReturnValueOnce({ set: syncUpdate.set })
          .mockReturnValueOnce({ set: providerUpdate.set }),
      },
      logger: {
        warn: vi.fn(),
      },
      options: {
        provider: {
          id: "stripe",
          kind: "stripe",
          secretKey: "sk_test_123",
          webhookSecret: "whsec_123",
        },
        testing: { enabled: true },
      },
      plans: { plans: [] },
      provider: {
        id: "stripe",
        kind: "stripe",
        secretKey: "sk_test_123",
        webhookSecret: "whsec_123",
      },
      stripe,
    } as unknown as PayKitContext;

    const customer = await syncCustomerWithDefaults(ctx, {
      email: "test@example.com",
      id: "customer_123",
    });

    expect(customer).toEqual(syncedCustomer);
    expect(stripe.upsertCustomer).toHaveBeenCalledWith({
      createTestClock: true,
      email: "test@example.com",
      id: "customer_123",
      metadata: undefined,
      name: undefined,
    });
    expect(providerUpdate.set).toHaveBeenCalledWith({
      provider: {
        stripe: {
          frozenTime: expect.any(String),
          id: "cus_123",
          testClockId: "clock_123",
        },
      },
      updatedAt: expect.any(Date),
    });
  });
});
