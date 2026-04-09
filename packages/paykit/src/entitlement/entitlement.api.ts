import * as z from "zod";

import { definePayKitMethod } from "../api/define-route";
import { getCustomerCurrentTime } from "../testing/testing.service";
import { checkEntitlement, reportEntitlement } from "./entitlement.service";

const entitlementCheckSchema = z.object({
  featureId: z.string(),
  required: z.number().positive().optional(),
});

const entitlementReportSchema = z.object({
  featureId: z.string(),
  amount: z.number().positive().optional(),
});

export const check = definePayKitMethod(
  {
    input: entitlementCheckSchema,
    requireCustomer: true,
  },
  async (ctx) =>
    checkEntitlement(ctx.paykit.database, {
      customerId: ctx.customer.id,
      featureId: ctx.input.featureId,
      now: getCustomerCurrentTime(ctx.paykit, ctx.customer),
      required: ctx.input.required,
    }),
);

export const report = definePayKitMethod(
  {
    input: entitlementReportSchema,
    requireCustomer: true,
  },
  async (ctx) =>
    reportEntitlement(ctx.paykit.database, {
      amount: ctx.input.amount,
      customerId: ctx.customer.id,
      featureId: ctx.input.featureId,
      now: getCustomerCurrentTime(ctx.paykit, ctx.customer),
    }),
);
