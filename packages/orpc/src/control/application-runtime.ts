import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { controlDiscoveryOutputSchema, controlErrorSchema } from "./contracts";
import {
  controlMutationActionSchema,
  controlMutationPrepareSchema,
  controlMutationReviewSchema,
} from "./mutation-contracts";
import { createControlMutationService } from "./mutations";
import type { ControlMutationService } from "./mutations";
import { CONTROL_API_PATH, createControlOpenApiDocument } from "./openapi";
import { controlOperations } from "./registry";
import type { ControlTarget } from "./registry";
import { createControlReadRuntime } from "./runtime";
import type { ControlRequestContext } from "./runtime";

const settingsOperation = "organization.settings.update";

export const createControlApplicationRuntime = (
  options: Parameters<typeof createControlReadRuntime>[0] & {
    mutationService?: ControlMutationService;
  } = {}
) => {
  const reads = createControlReadRuntime(options);
  const mutations =
    options.mutationService ??
    createControlMutationService({
      sessionServices: options.authorizationServices,
    });
  const settingsAllowed =
    options.policy === undefined ||
    (options.policy.operations.includes(settingsOperation) &&
      options.policy.scopes.includes("organization:write"));

  const requireSettingsPolicy = async (context: ControlRequestContext) => {
    if (!settingsAllowed) {
      await reads.discover({ context, target: { kind: "user" } });
      throw new ORPCError("UNSUPPORTED_OPERATION", { status: 404 });
    }
  };

  return {
    approve: async (input: { context: ControlRequestContext; id: string }) => {
      await requireSettingsPolicy(input.context);
      return await mutations.approve(input);
    },
    cancel: async (input: { context: ControlRequestContext; id: string }) => {
      await requireSettingsPolicy(input.context);
      return await mutations.cancel(input);
    },
    discover: async (input: {
      context: ControlRequestContext;
      target: ControlTarget;
    }) => {
      if (input.target.kind !== "organization") {
        return await reads.discover(input);
      }
      await mutations.authorize({
        context: input.context,
        organizationId: input.target.organizationId,
      });
      return controlDiscoveryOutputSchema.parse({
        operations: settingsAllowed
          ? controlOperations.filter(
              (operation) => operation.id === settingsOperation
            )
          : [],
      });
    },
    execute: async (input: {
      context: ControlRequestContext;
      operation: string;
      parameters: unknown;
    }): Promise<unknown> => {
      if (input.operation !== settingsOperation) {
        return await reads.execute(input);
      }
      await requireSettingsPolicy(input.context);
      return await mutations.execute(input);
    },
    openApi: async (context: ControlRequestContext) => {
      const readDocument = await reads.openApi(context);
      if (!settingsAllowed) {
        return readDocument;
      }
      const document = createControlOpenApiDocument({
        operations: [settingsOperation],
      });
      const errorResponse = {
        content: {
          "application/json": { schema: z.toJSONSchema(controlErrorSchema) },
        },
        description: "Safe management error without private request details.",
      };
      const lifecycle = {
        parameters: [{ $ref: "#/components/parameters/ControlVersion" }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: z.toJSONSchema(controlMutationReviewSchema),
              },
            },
            description:
              "Current session-bound change. Approval permits the requester to execute it and does not apply settings.",
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "500": errorResponse,
        },
        security: [{ applicationSession: [] }],
      };
      const actionBody = {
        content: {
          "application/json": {
            schema: z.toJSONSchema(controlMutationActionSchema, {
              io: "input",
            }),
          },
        },
        required: true,
      };
      return {
        ...readDocument,
        info: {
          ...readDocument.info,
          description:
            "Implemented application management operations. Existing session authentication permits viewing this contract, not access to any target. Every request rechecks current authority. Organization settings changes require preparation, browser review and approval, then explicit execution with the same session, idempotency key and exact patch. Streaming is unsupported.",
        },
        paths: {
          ...readDocument.paths,
          ...document.paths,
          [`${CONTROL_API_PATH}/mutations/prepare`]: {
            post: {
              ...lifecycle,
              operationId: "prepareOrganizationSettingsChange",
              requestBody: {
                content: {
                  "application/json": {
                    schema: z.toJSONSchema(controlMutationPrepareSchema, {
                      io: "input",
                    }),
                  },
                },
                required: true,
              },
            },
          },
          [`${CONTROL_API_PATH}/mutations/review`]: {
            post: {
              ...lifecycle,
              operationId: "reviewOrganizationSettingsChange",
              requestBody: actionBody,
            },
          },
          [`${CONTROL_API_PATH}/mutations/cancel`]: {
            post: {
              ...lifecycle,
              operationId: "cancelOrganizationSettingsChange",
              requestBody: actionBody,
            },
          },
        },
      };
    },
    prepare: async (input: {
      context: ControlRequestContext;
      parameters: unknown;
    }) => {
      await requireSettingsPolicy(input.context);
      return await mutations.prepare(input);
    },
    review: async (input: { context: ControlRequestContext; id: string }) => {
      await requireSettingsPolicy(input.context);
      return await mutations.review(input);
    },
  };
};

export type ControlApplicationRuntime = ReturnType<
  typeof createControlApplicationRuntime
>;
