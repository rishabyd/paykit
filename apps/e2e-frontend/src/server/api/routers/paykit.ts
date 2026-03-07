import { env } from "@/env";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { paykit } from "@/server/paykit";

const demoCustomer = {
  email: "e2e@example.com",
  id: "e2e-demo-user",
  name: "E2E Demo Customer",
} as const;

export const paykitRouter = createTRPCRouter({
  createCheckout: publicProcedure.mutation(async () => {
    const customer = await paykit.customer.sync(demoCustomer);

    const checkout = await paykit.checkout.create({
      providerId: "stripe",
      customerId: customer.id,
      amount: 1999,
      description: "PayKit Stripe E2E checkout",
      successURL: `${env.APP_URL}/checkout/success`,
      cancelURL: `${env.APP_URL}/checkout/cancel`,
      attachMethod: true,
      metadata: {
        source: "apps/e2e-frontend",
      },
    });

    return {
      ...checkout,
      customerId: customer.id,
    };
  }),
});
