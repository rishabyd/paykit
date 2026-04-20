import { dash } from "@paykitjs/dash";
import { polar } from "@paykitjs/polar";
// import { stripe } from "@paykitjs/stripe";
import { createPayKit } from "paykitjs";

import { env } from "@/env";
import { auth } from "@/server/auth";
import { pool } from "@/server/db";

import { free, pro, ultra } from "./paykit-products";

export const paykit = createPayKit({
  testing: { enabled: true },
  database: pool,
  // provider: stripe({
  //   secretKey: env.STRIPE_SECRET_KEY,
  //   webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  // }),
  provider: polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    webhookSecret: env.POLAR_WEBHOOK_SECRET,
    server: "sandbox",
  }),
  plans: [pro, ultra, free],
  plugins: [
    dash({
      // authorize: async (request) => {
      //   const session = await auth.api.getSession({ headers: request.headers });
      //   if (!session) throw new Error("Not authenticated");
      // },
    }),
  ],
  identify: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return null;
    return {
      customerId: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
    };
  },
});

export type PayKit = typeof paykit.$infer;
