import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { auth } from "@/server/auth";
import { paykit, type PayKit } from "@/server/paykit";

import type { PayKitContext } from "../../../../../../packages/paykit/src/core/context";
import { product, subscription } from "../../../../../../packages/paykit/src/database/schema";

export const paykitRouter = createTRPCRouter({
  currentPlans: publicProcedure.query(async ({ ctx }) => {
    const session = await auth.api.getSession({ headers: ctx.headers });
    if (!session) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not authenticated",
      });
    }

    await paykit.upsertCustomer({
      email: session.user.email,
      id: session.user.id,
      name: session.user.name ?? undefined,
    });

    const paykitCtx = (await paykit.$context) as PayKitContext;

    return paykitCtx.database
      .select({
        id: product.id,
        name: product.name,
        status: subscription.status,
        canceled: subscription.canceled,
        startedAt: subscription.startedAt,
        currentPeriodEndAt: subscription.currentPeriodEndAt,
        amount: product.priceAmount,
        interval: product.priceInterval,
      })
      .from(subscription)
      .innerJoin(product, eq(product.internalId, subscription.productInternalId))
      .where(
        and(
          eq(subscription.customerId, session.user.id),
          or(
            isNull(subscription.endedAt),
            sql`${subscription.endedAt} > now()`,
            eq(subscription.status, "scheduled"),
          ),
        ),
      )
      .orderBy(desc(subscription.createdAt));
  }),

  checkFeature: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await auth.api.getSession({ headers: ctx.headers });
      if (!session) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return paykit.check({
        customerId: session.user.id,
        featureId: input.featureId as PayKit["featureId"],
      });
    }),

  reportUsage: publicProcedure
    .input(z.object({ amount: z.number().int().min(1).optional(), featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await auth.api.getSession({ headers: ctx.headers });
      if (!session) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return paykit.report({
        amount: input.amount,
        customerId: session.user.id,
        featureId: input.featureId as PayKit["featureId"],
      });
    }),
});
