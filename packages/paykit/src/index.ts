export { createPayKit } from "./core/create-paykit";

export type { PayKitOptions } from "./types/options";
export type {
  CustomerEntitlement,
  CustomerSubscription,
  CustomerWithDetails,
  ListCustomersResult,
  PayKitInstance,
  PayKitSubscribeInput,
  PayKitSubscribeResult,
} from "./types/instance";
export type { CheckResult, EntitlementBalance, ReportResult } from "./services/entitlement-service";
export type {
  PayKitProvider,
  StripeProviderConfig,
  StripeProviderOptions,
} from "./providers/provider";
export type {
  Customer,
  StoredFeature,
  StoredInvoice,
  StoredProduct,
  StoredProductFeature,
  StoredSubscription,
} from "./types/models";
export type {
  FeatureType,
  MeteredFeatureConfig,
  MeteredResetInterval,
  NormalizedPlan,
  NormalizedPlanFeature,
  NormalizedSchema,
  PayKitFeature,
  PayKitFeatureDefinition,
  PayKitFeatureInclude,
  PayKitPlan,
  PayKitPlanConfig,
  PayKitPlansModule,
  PlanPrice,
  PriceInterval,
} from "./types/schema";
export type {
  NormalizedInvoice,
  NormalizedPayment,
  NormalizedPaymentMethod,
  NormalizedSubscription,
  NormalizedWebhookEvent,
  NormalizedWebhookEventMap,
  NormalizedWebhookEventName,
  PayKitEventError,
  PayKitEventHandlers,
  PayKitEventMap,
  PayKitEventName,
  WebhookApplyAction,
} from "./types/events";

export type { PayKitPlugin } from "./types/plugin";

export { PayKitError } from "./core/errors";
export { feature, plan } from "./types/schema";
export { createPayKitEndpoint } from "./api/call";
