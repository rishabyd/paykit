import type { PayKitContext } from "../core/context";
import type { StoredProduct } from "../types/models";
import {
  getLatestProduct,
  getProviderProductByProductId,
  insertProductVersion,
  updateProductName,
  upsertProviderProduct,
} from "./product-service";

export interface SyncProductResult {
  id: string;
  version: number;
  action: "created" | "updated" | "unchanged";
}

function priceChanged(
  existing: StoredProduct,
  priceAmount: number,
  priceInterval: string | null,
): boolean {
  return existing.priceAmount !== priceAmount || existing.priceInterval !== priceInterval;
}

export async function syncProducts(ctx: PayKitContext): Promise<SyncProductResult[]> {
  const results: SyncProductResult[] = [];
  const providerId = ctx.provider.id;

  for (const productDef of ctx.products) {
    const priceInterval = productDef.price.interval ?? null;
    const existing = await getLatestProduct(ctx.database, productDef.id);

    let stored: StoredProduct;
    let action: SyncProductResult["action"];

    if (!existing) {
      stored = await insertProductVersion(ctx.database, {
        id: productDef.id,
        version: 1,
        name: productDef.name,
        priceAmount: productDef.priceAmountCents,
        priceInterval,
      });
      action = "created";
    } else if (priceChanged(existing, productDef.priceAmountCents, priceInterval)) {
      stored = await insertProductVersion(ctx.database, {
        id: productDef.id,
        version: existing.version + 1,
        name: productDef.name,
        priceAmount: productDef.priceAmountCents,
        priceInterval,
      });
      action = "created";
    } else if (existing.name !== productDef.name) {
      await updateProductName(ctx.database, existing.internalId, productDef.name);
      stored = { ...existing, name: productDef.name };
      action = "updated";
    } else {
      stored = existing;
      action = "unchanged";
    }

    const existingProvider = await getProviderProductByProductId(
      ctx.database,
      productDef.id,
      providerId,
    );

    const needsProviderSync =
      action !== "unchanged" || !existingProvider;

    if (needsProviderSync) {
      const providerResult = await ctx.provider.syncProduct({
        id: productDef.id,
        name: productDef.name,
        priceAmount: productDef.priceAmountCents,
        priceInterval,
        existingProviderProductId: existingProvider?.providerProductId ?? null,
        existingProviderPriceId: action === "unchanged" ? (existingProvider?.providerPriceId ?? null) : null,
      });

      await upsertProviderProduct(ctx.database, stored.internalId, providerId, providerResult);
    }

    results.push({
      id: productDef.id,
      version: stored.version,
      action,
    });
  }

  return results;
}
