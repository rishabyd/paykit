import { createEndpoint, createMiddleware } from "better-call";
import type { EndpointContext } from "better-call";

import type { PayKitContext } from "../core/context";
import { PayKitError, PAYKIT_ERROR_CODES } from "../core/errors";
import { getCustomerByIdOrThrow, syncCustomerWithDefaults } from "../customer/customer.service";
import type { Customer } from "../types/models";

const paykitMiddleware = createMiddleware(async () => {
  return {} as PayKitContext;
});

export const createPayKitEndpoint: ReturnType<
  typeof createEndpoint.create<{ use: [typeof paykitMiddleware] }>
> = createEndpoint.create({
  use: [paykitMiddleware],
});

type BetterCallOptions = Parameters<typeof createPayKitEndpoint>[1];

type OptionalCustomer<TRequireCustomer extends boolean> = TRequireCustomer extends true
  ? { customer: Customer }
  : { customer?: undefined };

export type PayKitMethodContext<
  TInput,
  TRequireCustomer extends boolean = false,
  TParams = Record<string, string> | undefined,
  THeaders = Headers,
  TRequest = Request | undefined,
> = {
  headers: THeaders;
  input: TInput;
  params: TParams;
  paykit: PayKitContext;
  request: TRequest;
} & OptionalCustomer<TRequireCustomer>;

export type PayKitMethod<TServerInput, TResult> = ((
  paykit: PayKitContext,
  input: TServerInput,
  request?: Request,
) => Promise<TResult>) & {
  client?: boolean;
  endpoint?: { options: unknown; path: string } & Record<string, unknown>;
};

type PayKitMethodRouteConfig = Omit<BetterCallOptions, "body" | "method"> & {
  client?: boolean;
  method: NonNullable<BetterCallOptions["method"]>;
  path: string;
  resolveInput?: (ctx: BetterCallEndpointContext) => Promise<unknown> | unknown;
};

export interface PayKitMethodConfig {
  input?: BetterCallOptions extends { body?: infer TBody } ? TBody : never;
  requireCustomer?: boolean;
  route?: PayKitMethodRouteConfig;
  resolveServerCustomerId?: (input: unknown) => string | undefined;
}

type InferSchemaInput<TSchema> = TSchema extends { _output: infer TOutput } ? TOutput : never;

type InferMethodInput<TConfig extends PayKitMethodConfig> = TConfig["input"] extends undefined
  ? TConfig["route"] extends { resolveInput: (...args: unknown[]) => infer TResolved }
    ? Awaited<TResolved>
    : undefined
  : InferSchemaInput<NonNullable<TConfig["input"]>>;

type InferRequireCustomer<TConfig extends PayKitMethodConfig> =
  TConfig["requireCustomer"] extends true ? true : false;

type ServerMethodInput<TConfig extends PayKitMethodConfig> =
  InferRequireCustomer<TConfig> extends true
    ? AddCustomerId<InferMethodInput<TConfig>>
    : InferMethodInput<TConfig>;

type AddCustomerId<TInput> = TInput extends undefined
  ? { customerId?: string } | undefined
  : TInput extends object
    ? TInput & { customerId?: string }
    : TInput;

type BetterCallEndpointContext = EndpointContext<
  string,
  NonNullable<BetterCallOptions["method"]>,
  object | undefined,
  undefined,
  [],
  boolean,
  boolean,
  PayKitContext
>;

type InferRouteContext<TConfig extends PayKitMethodConfig> = TConfig["route"] extends {
  path: infer TPath extends string;
  method: infer TMethod extends NonNullable<BetterCallOptions["method"]>;
  requireHeaders?: infer TRequireHeaders extends boolean;
  requireRequest?: infer TRequireRequest extends boolean;
}
  ? EndpointContext<
      TPath,
      TMethod,
      TConfig["input"] extends object ? TConfig["input"] : undefined,
      undefined,
      [],
      TRequireHeaders,
      TRequireRequest,
      PayKitContext
    >
  : EndpointContext<
      never,
      NonNullable<BetterCallOptions["method"]>,
      TConfig["input"] extends object ? TConfig["input"] : undefined,
      undefined,
      [],
      false,
      false,
      PayKitContext
    >;

export function definePayKitMethod<const TConfig extends PayKitMethodConfig, TResult>(
  config: TConfig,
  handler: (
    ctx: PayKitMethodContext<
      InferMethodInput<TConfig>,
      InferRequireCustomer<TConfig>,
      InferRouteContext<TConfig>["params"],
      InferRouteContext<TConfig>["headers"],
      InferRouteContext<TConfig>["request"]
    >,
  ) => Promise<TResult> | TResult,
): PayKitMethod<ServerMethodInput<TConfig>, TResult> {
  const call = async (
    paykit: PayKitContext,
    input: ServerMethodInput<TConfig>,
    request?: Request,
  ): Promise<TResult> => {
    const normalizedInput = stripCustomerId(input) as InferMethodInput<TConfig>;
    const customer = config.requireCustomer
      ? await resolveCustomer(
          paykit,
          request,
          config.resolveServerCustomerId?.(input) ?? getInputCustomerId(input),
        )
      : undefined;

    return handler({
      headers: request?.headers ?? new Headers(),
      input: normalizedInput,
      params: {} as InferRouteContext<TConfig>["params"],
      paykit,
      request: request as InferRouteContext<TConfig>["request"],
      ...(customer ? { customer } : {}),
    } as PayKitMethodContext<
      InferMethodInput<TConfig>,
      InferRequireCustomer<TConfig>,
      InferRouteContext<TConfig>["params"],
      InferRouteContext<TConfig>["headers"],
      InferRouteContext<TConfig>["request"]
    >);
  };

  if (config.route) {
    const endpoint = createPayKitEndpoint(
      config.route.path,
      {
        body: config.input,
        ...config.route,
        client: undefined,
        path: undefined,
        resolveInput: undefined,
      },
      async (ctx) => {
        const routeInput = config.route?.resolveInput
          ? await config.route.resolveInput(ctx as BetterCallEndpointContext)
          : (ctx.body as InferMethodInput<TConfig>);
        const customer = config.requireCustomer
          ? await resolveCustomer(ctx.context, ctx.request)
          : undefined;

        return handler({
          headers: ctx.headers,
          input: routeInput as InferMethodInput<TConfig>,
          params: ctx.params as InferRouteContext<TConfig>["params"],
          paykit: ctx.context,
          request: ctx.request as InferRouteContext<TConfig>["request"],
          ...(customer ? { customer } : {}),
        } as PayKitMethodContext<
          InferMethodInput<TConfig>,
          InferRequireCustomer<TConfig>,
          InferRouteContext<TConfig>["params"],
          InferRouteContext<TConfig>["headers"],
          InferRouteContext<TConfig>["request"]
        >);
      },
    );

    call.client = config.route.client === true;
    call.endpoint = endpoint as unknown as { options: unknown; path: string } & Record<
      string,
      unknown
    >;
  }

  return call as PayKitMethod<ServerMethodInput<TConfig>, TResult>;
}

export function definePayKitRoute<
  const TConfig extends PayKitMethodRouteConfig,
  TResult,
  TRouteInput = TConfig["resolveInput"] extends (...args: unknown[]) => infer TResolved
    ? Awaited<TResolved>
    : undefined,
>(
  config: TConfig,
  handler: (
    ctx: PayKitMethodContext<
      TRouteInput,
      false,
      InferRouteContext<{ route: TConfig }>["params"],
      InferRouteContext<{ route: TConfig }>["headers"],
      InferRouteContext<{ route: TConfig }>["request"]
    >,
  ) => Promise<TResult> | TResult,
) {
  return createPayKitEndpoint(
    config.path,
    {
      ...config,
      client: undefined,
      path: undefined,
      resolveInput: undefined,
    },
    async (ctx) => {
      const input = config.resolveInput
        ? await config.resolveInput(ctx as BetterCallEndpointContext)
        : (ctx.body as TRouteInput);

      return handler({
        headers: ctx.headers as InferRouteContext<{ route: TConfig }>["headers"],
        input: input as TRouteInput,
        params: ctx.params as InferRouteContext<{ route: TConfig }>["params"],
        paykit: ctx.context,
        request: ctx.request as InferRouteContext<{ route: TConfig }>["request"],
      });
    },
  );
}

function getInputCustomerId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  return "customerId" in input && typeof input.customerId === "string"
    ? input.customerId
    : undefined;
}

function stripCustomerId<TInput>(input: TInput): TInput {
  if (!input || typeof input !== "object" || !("customerId" in input)) {
    return input;
  }

  const { customerId: _customerId, ...rest } = input;
  return rest as TInput;
}

async function resolveCustomer(
  ctx: PayKitContext,
  request: Request | undefined,
  explicitCustomerId?: string,
): Promise<Customer> {
  if (ctx.options.identify && request) {
    const identity = await ctx.options.identify(request);

    if (explicitCustomerId && explicitCustomerId !== identity.customerId) {
      throw PayKitError.from("FORBIDDEN", PAYKIT_ERROR_CODES.CUSTOMER_ID_MISMATCH);
    }

    return syncCustomerWithDefaults(ctx, {
      id: identity.customerId,
      email: identity.email,
      name: identity.name,
    });
  }

  if (request) {
    throw PayKitError.from("UNAUTHORIZED", PAYKIT_ERROR_CODES.IDENTIFY_REQUIRED);
  }

  if (explicitCustomerId) {
    return getCustomerByIdOrThrow(ctx.database, explicitCustomerId);
  }

  throw PayKitError.from("UNAUTHORIZED", PAYKIT_ERROR_CODES.CUSTOMER_ID_REQUIRED);
}
