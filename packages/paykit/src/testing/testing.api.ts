import * as z from "zod";

import { definePayKitMethod } from "../api/define-route";
import { advanceCustomerTestClock, getCustomerTestClock } from "./testing.service";

const customerTestClockSchema = z.object({});

const advanceCustomerTestClockSchema = z.object({
  frozenTime: z.coerce.date(),
});

export const getTestClock = definePayKitMethod(
  {
    input: customerTestClockSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/get-test-clock",
    },
  },
  async (ctx) => getCustomerTestClock(ctx.paykit, ctx.customer.id),
);

export const advanceTestClock = definePayKitMethod(
  {
    input: advanceCustomerTestClockSchema,
    requireCustomer: true,
    route: {
      client: true,
      method: "POST",
      path: "/advance-test-clock",
    },
  },
  async (ctx) =>
    advanceCustomerTestClock(ctx.paykit, {
      customerId: ctx.customer.id,
      frozenTime: ctx.input.frozenTime,
    }),
);
