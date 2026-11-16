import { createRouterClient, ORPCError } from "@orpc/server";
import { z } from "zod";

import type { RouterOutputs } from "../client";
import { createControlAuthorizer } from "./authority";
import type { ControlAuthorizationServices } from "./authority";
import {
  controlContracts,
  controlDiscoveryOutputSchema,
  toControlMailMessage,
} from "./contracts";
import type { ControlRequest } from "./contracts";
import { createControlOpenApiDocument } from "./openapi";
import { controlOperations } from "./registry";
import type {
  ControlOperationId,
  ControlScope,
  ControlTarget,
} from "./registry";

export const controlReadOperationIdSchema = z.enum([
  "mailboxes.list",
  "mail.search",
  "mail.read_thread",
  "calendar.accounts",
  "calendar.list",
  "calendar.events",
  "calendar.event",
]);

export type ControlReadOperationId = z.infer<
  typeof controlReadOperationIdSchema
>;

export type ControlRequestContext = {
  headers: Headers;
  responseHeaders?: Headers;
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  signal?: AbortSignal;
};

type ControlReadResults = {
  "calendar.accounts": RouterOutputs["calendar"]["accounts"];
  "calendar.event": RouterOutputs["calendar"]["event"];
  "calendar.events": RouterOutputs["calendar"]["events"];
  "calendar.list": RouterOutputs["calendar"]["calendars"];
  "mail.read_thread": RouterOutputs["mail"]["getThread"];
  "mail.search": RouterOutputs["mail"]["listThreads"];
  "mailboxes.list": RouterOutputs["mail"]["listMailboxes"];
};

export type ControlReadServices = {
  [Operation in ControlReadOperationId]: (input: {
    context: ControlRequestContext;
    parameters: ControlRequest<Operation>;
  }) => Promise<ControlReadResults[Operation]>;
};

const createRequestClient = async (context: ControlRequestContext) => {
  const [{ createOrpcContext }, { appRouter }] = await Promise.all([
    import("../context"),
    import("../routers/index"),
  ]);
  return createRouterClient(appRouter, {
    context: {
      ...createOrpcContext({
        headers: context.headers,
        scheduleBackgroundTask: context.scheduleBackgroundTask,
      }),
      resHeaders: context.responseHeaders,
      signal: context.signal,
    },
  });
};

const applicationServices: ControlReadServices = {
  "calendar.accounts": async ({ context }) => {
    const client = await createRequestClient(context);
    return await client.calendar.accounts();
  },
  "calendar.event": async ({ context, parameters }) => {
    const client = await createRequestClient(context);
    return await client.calendar.event(parameters);
  },
  "calendar.events": async ({ context, parameters }) => {
    const client = await createRequestClient(context);
    return await client.calendar.events(parameters);
  },
  "calendar.list": async ({ context, parameters }) => {
    const client = await createRequestClient(context);
    return await client.calendar.calendars(parameters);
  },
  "mail.read_thread": async ({ context, parameters }) => {
    const client = await createRequestClient(context);
    return await client.mail.getThread(parameters);
  },
  "mail.search": async ({ context, parameters }) => {
    const client = await createRequestClient(context);
    return await client.mail.listThreads(parameters);
  },
  "mailboxes.list": async ({ context }) => {
    const client = await createRequestClient(context);
    return await client.mail.listMailboxes();
  },
};

const parseControlParameters = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown
): z.output<Schema> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid management request.",
    });
  }
  return parsed.data;
};

export const createControlReadRuntime = (
  options: {
    authorizationServices?: ControlAuthorizationServices;
    policy?: {
      operations: readonly ControlOperationId[];
      scopes: readonly ControlScope[];
    };
    services?: ControlReadServices;
  } = {}
) => {
  const operations = controlReadOperationIdSchema.options.filter(
    (operation) =>
      options.policy === undefined ||
      options.policy.operations.includes(operation)
  );
  const scopes =
    options.policy?.scopes ??
    controlOperations
      .filter((operation) => operations.some((id) => id === operation.id))
      .map((operation) => operation.scope);
  const policy = { operations, scopes };
  const authorizer = createControlAuthorizer(
    policy,
    options.authorizationServices
  );
  const services = options.services ?? applicationServices;
  const run = async (input: {
    context: ControlRequestContext;
    operation: ControlReadOperationId;
    read: () => Promise<unknown>;
    target: ControlTarget;
  }): Promise<unknown> => {
    input.context.signal?.throwIfAborted();
    await authorizer.authorize({
      headers: input.context.headers,
      operation: input.operation,
      target: input.target,
    });
    const result = await input.read();
    input.context.signal?.throwIfAborted();
    return controlContracts[input.operation].output.parse(result);
  };
  return {
    discover: async (input: {
      context: ControlRequestContext;
      target: ControlTarget;
    }) => {
      input.context.signal?.throwIfAborted();
      const discovered = await authorizer.discover({
        headers: input.context.headers,
        target: input.target,
      });
      input.context.signal?.throwIfAborted();
      return controlDiscoveryOutputSchema.parse({ operations: discovered });
    },
    execute: async (input: {
      context: ControlRequestContext;
      operation: string;
      parameters: unknown;
    }): Promise<unknown> => {
      const selected = controlReadOperationIdSchema.safeParse(input.operation);
      if (!selected.success || !operations.includes(selected.data)) {
        await authorizer.discover({
          headers: input.context.headers,
          target: { kind: "user" },
        });
        throw new ORPCError("UNSUPPORTED_OPERATION", {
          message: "This management operation is not available.",
          status: 404,
        });
      }
      const operation = selected.data;
      const { context } = input;
      switch (operation) {
        case "mailboxes.list": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () =>
              await services[operation]({ context, parameters }),
            target: { kind: "user" },
          });
        }
        case "mail.search": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () => {
              const page = await services[operation]({ context, parameters });
              return {
                ...page,
                messages: page.messages.map((message) =>
                  toControlMailMessage({
                    mailboxId: parameters.mailboxId,
                    message,
                  })
                ),
              };
            },
            target: {
              kind: "mailbox",
              mailboxId: parameters.mailboxId,
              organizationId: parameters.organizationId,
            },
          });
        }
        case "mail.read_thread": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () => {
              const thread = await services[operation]({ context, parameters });
              return {
                ...thread,
                messages: thread.messages.map((message) =>
                  toControlMailMessage({
                    mailboxId: parameters.mailboxId,
                    message,
                  })
                ),
              };
            },
            target: {
              kind: "mailbox",
              mailboxId: parameters.mailboxId,
              organizationId: parameters.organizationId,
            },
          });
        }
        case "calendar.accounts": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () =>
              await services[operation]({ context, parameters }),
            target: { kind: "user" },
          });
        }
        case "calendar.list": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () =>
              await services[operation]({ context, parameters }),
            target: { connectionId: parameters.connectionId, kind: "calendar" },
          });
        }
        case "calendar.events": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () =>
              await services[operation]({ context, parameters }),
            target: { connectionId: parameters.connectionId, kind: "calendar" },
          });
        }
        case "calendar.event": {
          const parameters = parseControlParameters(
            controlContracts[operation].input,
            input.parameters
          );
          return await run({
            context,
            operation,
            read: async () =>
              await services[operation]({ context, parameters }),
            target: { connectionId: parameters.connectionId, kind: "calendar" },
          });
        }
        default: {
          const exhaustive: never = operation;
          throw new ORPCError("UNSUPPORTED_OPERATION", {
            cause: exhaustive,
            status: 404,
          });
        }
      }
    },
    openApi: async (context: ControlRequestContext) => {
      await authorizer.discover({
        headers: context.headers,
        target: { kind: "user" },
      });
      const selected = operations.filter((operation) =>
        controlOperations.some(
          (candidate) =>
            candidate.id === operation && scopes.includes(candidate.scope)
        )
      );
      return createControlOpenApiDocument({ operations: selected });
    },
  };
};

export type ControlReadRuntime = ReturnType<typeof createControlReadRuntime>;
