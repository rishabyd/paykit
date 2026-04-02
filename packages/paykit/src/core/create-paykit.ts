import { createPayKitRouter, getEndpoints } from "../api";
import {
  hardDeleteCustomer,
  listCustomers,
  syncCustomerWithDefaults,
} from "../services/customer-service";
import { checkEntitlement, reportEntitlement } from "../services/entitlement-service";
import type { PayKitAPI, PayKitInstance } from "../types/instance";
import type { PayKitOptions } from "../types/options";
import { handleWebhook } from "../webhook/handle-webhook";
import { createContext, type PayKitContext } from "./context";

const payKitInstanceSymbol = Symbol.for("paykit.instance");

export function isPayKitInstance(value: unknown): value is PayKitInstance {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[payKitInstanceSymbol] === true
  );
}

export function createPayKit<const TOptions extends PayKitOptions>(
  options: TOptions,
): PayKitInstance<TOptions> {
  let contextPromise: Promise<PayKitContext> | undefined;
  const getContext = () => {
    contextPromise ??= createContext(options);
    return contextPromise;
  };

  const paykit: PayKitInstance<TOptions> = {
    options,

    async handler(request: Request) {
      const ctx = await getContext();
      const basePath = options.basePath ?? "/paykit";

      // Rewrite GET /paykit/* → /paykit/api/dash (dashboard SPA)
      // But not /paykit/api/* (those are real API routes)
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) &&
        !url.pathname.startsWith(`${basePath}/api`)
      ) {
        url.pathname = `${basePath}/api/dash`;
        request = new Request(url, request);
      }

      const router = createPayKitRouter(ctx, options);
      return router.handler(request);
    },

    get api() {
      return getEndpoints(getContext()) as unknown as PayKitAPI<TOptions>;
    },

    async upsertCustomer(input) {
      const ctx = await getContext();
      return syncCustomerWithDefaults(ctx, input);
    },

    async deleteCustomer(input) {
      const ctx = await getContext();
      await hardDeleteCustomer(ctx, input.id);
      return { success: true };
    },

    async listCustomers(input) {
      const ctx = await getContext();
      return listCustomers(ctx, input);
    },

    async subscribe(input) {
      const api = getEndpoints(getContext()) as unknown as PayKitAPI<TOptions>;
      return api.subscribe({ body: input });
    },

    async check(input) {
      const ctx = await getContext();
      return checkEntitlement(ctx.database, input);
    },

    async report(input) {
      const ctx = await getContext();
      return reportEntitlement(ctx.database, input);
    },

    async handleWebhook(input) {
      const ctx = await getContext();
      return handleWebhook(ctx, input);
    },

    get $context() {
      return getContext();
    },

    $infer: undefined as never,
  };

  Object.defineProperty(paykit, payKitInstanceSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return paykit;
}
