import { Pool } from "pg";

import { createPayKitRouter, getApi } from "../api/methods";
import { getPendingMigrationCount } from "../database/index";
import { dryRunSyncProducts } from "../product/product-sync.service";
import type { PayKitAPI, PayKitInstance } from "../types/instance";
import type { PayKitOptions } from "../types/options";
import { createContext, type PayKitContext } from "./context";

const payKitInstanceSymbol = Symbol.for("paykit.instance");

export function isPayKitInstance(value: unknown): value is PayKitInstance {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[payKitInstanceSymbol] === true
  );
}

async function runDevChecks(ctx: PayKitContext, pool: Pool): Promise<void> {
  try {
    await pool.query("SELECT 1");
  } catch {
    ctx.logger.error("Could not connect to the database. Check your connection settings.");
    return;
  }

  await Promise.allSettled([
    getPendingMigrationCount(pool).then((count) => {
      if (count > 0) {
        ctx.logger.error(
          `${count} pending migration${count === 1 ? "" : "s"}. Run \`paykitjs push\` to apply.`,
        );
      }
    }),
    dryRunSyncProducts(ctx).then((results) => {
      const outOfSync = results.filter((r) => r.action !== "unchanged");
      if (outOfSync.length > 0) {
        ctx.logger.error(
          `${outOfSync.length} product${outOfSync.length === 1 ? "" : "s"} out of sync: ${outOfSync.map((r) => r.id).join(", ")}. Run \`paykitjs push\` to update.`,
        );
      }
    }),
  ]);
}

async function initContext(options: PayKitOptions): Promise<PayKitContext> {
  const pool =
    typeof options.database === "string"
      ? new Pool({ connectionString: options.database })
      : options.database;
  const ctx = await createContext({ ...options, database: pool });

  if (process.env.NODE_ENV !== "production" && !process.env.PAYKIT_CLI) {
    runDevChecks(ctx, pool).catch(() => {});
  }

  return ctx;
}

export function createPayKit<const TOptions extends PayKitOptions>(
  options: TOptions,
): PayKitInstance<TOptions> {
  let contextPromise: Promise<PayKitContext> | undefined;
  const getContext = () => {
    contextPromise ??= initContext(options);
    return contextPromise;
  };

  const api = getApi(getContext(), options) as unknown as PayKitAPI<TOptions>;
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

    ...api,

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
