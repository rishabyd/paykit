import { createRouter } from "better-call";

import type { PayKitContext } from "../core/context";
import type { PayKitOptions } from "../types/options";
import { customerPortal } from "./routes/customer-portal";
import { webhook } from "./routes/webhook";
import { subscribe } from "./subscribe/subscribe.api";

export const clientEndpoints = { subscribe, customerPortal } as const;
export const endpoints = { ...clientEndpoints, webhook } as const;

/** derives funcs like .subscribe() automatically from client endpoints */
export function getEndpoints(ctx: PayKitContext | Promise<PayKitContext>) {
  const wrapped = Object.fromEntries(
    Object.entries(clientEndpoints).map(([key, endpoint]) => {
      const fn = async (args: { body: unknown }) => {
        const resolved = await ctx;
        return (endpoint as (...args: unknown[]) => unknown)({
          ...args,
          context: resolved,
        });
      };
      Object.assign(fn, { path: endpoint.path, options: endpoint.options });
      return [key, fn];
    }),
  );

  return wrapped as typeof clientEndpoints;
}

export function createPayKitRouter(ctx: PayKitContext, options: PayKitOptions) {
  const pluginEndpoints = Object.assign(
    {},
    ...(options.plugins ?? []).map((p) => p.endpoints ?? {}),
  );

  return createRouter(
    { ...endpoints, ...pluginEndpoints },
    {
      basePath: options.basePath ?? "/paykit/api",
      routerContext: ctx,
      onError(e) {
        ctx.logger.error({ err: e }, "API error");
      },
    },
  );
}
