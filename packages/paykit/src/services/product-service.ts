import { and, desc, eq } from "drizzle-orm";

import { generateId } from "../core/utils";
import type { PayKitDatabase } from "../database";
import { product, providerProduct } from "../database/postgres/schema";
import type { StoredProduct, StoredProviderProduct } from "../types/models";

export async function getLatestProduct(
  database: PayKitDatabase,
  id: string,
): Promise<StoredProduct | null> {
  return (
    (await database.query.product.findFirst({
      where: eq(product.id, id),
      orderBy: desc(product.version),
    })) ?? null
  );
}

export async function getProductVersion(
  database: PayKitDatabase,
  id: string,
  version: number,
): Promise<StoredProduct | null> {
  return (
    (await database.query.product.findFirst({
      where: and(eq(product.id, id), eq(product.version, version)),
    })) ?? null
  );
}

export async function insertProductVersion(
  database: PayKitDatabase,
  input: {
    id: string;
    version: number;
    name: string;
    priceAmount: number;
    priceInterval: string | null;
  },
): Promise<StoredProduct> {
  const now = new Date();
  const rows = await database
    .insert(product)
    .values({
      internalId: generateId("prod"),
      id: input.id,
      version: input.version,
      name: input.name,
      priceAmount: input.priceAmount,
      priceInterval: input.priceInterval,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to insert product.");
  }
  return row;
}

export async function updateProductName(
  database: PayKitDatabase,
  internalId: string,
  name: string,
): Promise<void> {
  await database
    .update(product)
    .set({ name, updatedAt: new Date() })
    .where(eq(product.internalId, internalId));
}

export async function getProviderProduct(
  database: PayKitDatabase,
  productInternalId: string,
  providerId: string,
): Promise<StoredProviderProduct | null> {
  return (
    (await database.query.providerProduct.findFirst({
      where: and(
        eq(providerProduct.productInternalId, productInternalId),
        eq(providerProduct.providerId, providerId),
      ),
    })) ?? null
  );
}

export async function getProviderProductByProductId(
  database: PayKitDatabase,
  productId: string,
  providerId: string,
): Promise<StoredProviderProduct | null> {
  const latestProduct = await getLatestProduct(database, productId);
  if (!latestProduct) {
    return null;
  }
  return getProviderProduct(database, latestProduct.internalId, providerId);
}

export async function upsertProviderProduct(
  database: PayKitDatabase,
  productInternalId: string,
  providerId: string,
  input: { providerProductId: string; providerPriceId: string },
): Promise<void> {
  await database
    .insert(providerProduct)
    .values({
      productInternalId,
      providerId,
      providerProductId: input.providerProductId,
      providerPriceId: input.providerPriceId,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [providerProduct.productInternalId, providerProduct.providerId],
      set: {
        providerProductId: input.providerProductId,
        providerPriceId: input.providerPriceId,
      },
    });
}
