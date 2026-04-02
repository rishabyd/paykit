export interface Customer {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string> | null;
  provider: Record<string, { id: string }>;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredFeature {
  id: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredProduct {
  internalId: string;
  id: string;
  version: number;
  name: string;
  group: string;
  isDefault: boolean;
  priceAmount: number | null;
  priceInterval: string | null;
  provider: Record<string, { productId: string; priceId: string | null }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredProductFeature {
  productInternalId: string;
  featureId: string;
  limit: number | null;
  resetInterval: string | null;
  config: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredSubscription {
  id: string;
  customerId: string;
  productInternalId: string;
  providerId: string | null;
  providerData: Record<string, unknown> | null;
  status: string;
  canceled: boolean;
  cancelAtPeriodEnd: boolean;
  startedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStartAt: Date | null;
  currentPeriodEndAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  scheduledProductId: string | null;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredInvoice {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description: string | null;
  hostedUrl: string | null;
  providerId: string;
  providerData: Record<string, unknown>;
  periodStartAt: Date | null;
  periodEndAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
