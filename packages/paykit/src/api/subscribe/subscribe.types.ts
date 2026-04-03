import type {
  ProviderInvoice,
  ProviderRequiredAction,
  ProviderSubscription,
} from "../../providers/provider";
import type { NormalizedPlanFeature } from "../../types/schema";

export type StripeSubscriptionAction =
  | {
      type: "create";
      providerCustomerId: string;
      providerPriceId: string;
      trialPeriodDays?: number;
    }
  | {
      type: "update";
      providerSubscriptionId: string;
      providerPriceId: string;
      prorationBehavior: "always_invoice" | "none";
    }
  | {
      type: "cancel";
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      currentPeriodEndAt?: Date | null;
    }
  | {
      type: "schedule_change";
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
      providerPriceId: string;
    }
  | {
      type: "resume";
      providerSubscriptionId: string;
      providerSubscriptionScheduleId?: string | null;
    }
  | { type: "none" };

export type StripeCheckoutAction =
  | {
      type: "create";
      providerCustomerId: string;
      providerPriceId: string;
      successUrl: string;
      cancelUrl?: string;
      metadata: Record<string, string>;
      trialPeriodDays?: number;
    }
  | { type: "none" };

export type StripeInvoiceAction =
  | {
      type: "create";
      providerCustomerId: string;
      lines: Array<{ amount: number; description: string }>;
    }
  | { type: "none" };

export interface StripeBillingPlan {
  subscriptionAction: StripeSubscriptionAction;
  checkoutAction: StripeCheckoutAction;
  invoiceAction: StripeInvoiceAction;
}

export interface SubscriptionInsert {
  customerId: string;
  productInternalId: string;
  planFeatures: readonly NormalizedPlanFeature[];
  providerId: string;
  status: "active" | "scheduled" | "trialing";
  startedAt: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodStartAt?: Date | null;
  currentPeriodEndAt?: Date | null;
}

export interface SubscriptionUpdate {
  subscriptionId: string;
  canceled: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  status: string;
  scheduledProductId?: string | null;
}

export interface PayKitBillingPlan {
  customerId: string;
  group: string;
  insertSubscriptions: SubscriptionInsert[];
  updateSubscription: SubscriptionUpdate | null;
  deleteScheduledInGroup: boolean;
  clearScheduledInGroup: boolean;
}

export interface BillingPlan {
  paykit: PayKitBillingPlan;
  stripe: StripeBillingPlan;
}

export interface StripeExecutionResult {
  subscription?: ProviderSubscription | null;
  invoice?: ProviderInvoice | null;
  requiredAction?: ProviderRequiredAction | null;
  paymentUrl: string | null;
}

export function serializeBillingPlan(plan: BillingPlan): unknown {
  return JSON.parse(JSON.stringify(plan));
}

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

export function deserializeBillingPlan(raw: unknown): BillingPlan {
  return JSON.parse(JSON.stringify(raw), reviveDates) as BillingPlan;
}
