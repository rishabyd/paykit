export interface Customer {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string> | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethod {
  id: string;
  providerId: string;
  providerMethodId: string;
  type: string;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InternalPaymentMethod extends PaymentMethod {
  customerId: string;
}

export interface Charge {
  id: string;
  providerId: string;
  providerChargeId: string;
  status: string;
  amount: number;
  currency: string;
  description: string | null;
  metadata: Record<string, string> | null;
  createdAt: Date;
}

export interface InternalCharge extends Charge {
  customerId: string;
  paymentMethodId: string | null;
}

export interface InternalProviderCustomer {
  id: string;
  customerId: string;
  providerId: string;
  providerCustomerId: string;
  createdAt: Date;
}

export interface Refund {
  amount: number;
  currency: string;
  providerRefundId?: string | null;
  status: string;
}
