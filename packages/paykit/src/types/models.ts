export interface Customer {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string> | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InternalProviderCustomer {
  id: string;
  customerId: string;
  providerId: string;
  providerCustomerId: string;
  createdAt: Date;
}

export interface StoredProduct {
  internalId: string;
  id: string;
  version: number;
  name: string;
  priceAmount: number;
  priceInterval: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredProviderProduct {
  productInternalId: string;
  providerId: string;
  providerProductId: string;
  providerPriceId: string;
  createdAt: Date;
}
