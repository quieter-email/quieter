import { z } from "zod";

import {
  controlContracts,
  controlDiscoveryInputSchema,
  controlDiscoveryOutputSchema,
  controlErrorSchema,
} from "./contracts";
import { controlOperations } from "./registry";
import type { ControlOperationId } from "./registry";

export const CONTROL_API_VERSION = "2026-11";
export const CONTROL_API_VERSION_HEADER = "Quieter-Control-Version";
export const CONTROL_API_PATH = "/api/control";

export const createControlOpenApiDocument = (input: {
  operations: readonly ControlOperationId[];
}) => {
  const errorResponse = {
    content: {
      "application/json": { schema: z.toJSONSchema(controlErrorSchema) },
    },
    description: "Safe management error without private request details.",
  };
  const paths = Object.fromEntries(
    controlOperations
      .filter((operation) => input.operations.includes(operation.id))
      .map((operation) => {
        const contract = controlContracts[operation.id];
        return [
          `${CONTROL_API_PATH}/${operation.id}`,
          {
            post: {
              operationId: operation.id,
              parameters: [{ $ref: "#/components/parameters/ControlVersion" }],
              requestBody: {
                content: {
                  "application/json": {
                    schema: z.toJSONSchema(contract.input, { io: "input" }),
                  },
                },
                required: true,
              },
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      schema: z.toJSONSchema(contract.output),
                    },
                  },
                  description:
                    operation.effect.kind === "read"
                      ? "Current authorized application result."
                      : "Durable mutation receipt. Pending and uncertain receipts are not proof of success.",
                },
                "400": errorResponse,
                "401": errorResponse,
                "403": errorResponse,
                "404": errorResponse,
                "409": errorResponse,
                "429": errorResponse,
                "500": errorResponse,
              },
              security: [{ applicationSession: [] }],
              "x-quieter-effect": operation.effect,
              "x-quieter-scope": operation.scope,
              "x-quieter-target": operation.target,
            },
          },
        ] as const;
      })
  );
  return {
    components: {
      parameters: {
        ControlVersion: {
          in: "header",
          name: CONTROL_API_VERSION_HEADER,
          required: true,
          schema: { const: CONTROL_API_VERSION, type: "string" },
        },
      },
      schemas: {
        ControlDiscoveryInput: z.toJSONSchema(controlDiscoveryInputSchema),
        ControlDiscoveryOutput: z.toJSONSchema(controlDiscoveryOutputSchema),
        ControlError: z.toJSONSchema(controlErrorSchema),
      },
      securitySchemes: {
        applicationSession: {
          description:
            "Existing signed-in application session cookies. Bearer credentials and transactional API keys are not accepted.",
          in: "header",
          name: "Cookie",
          type: "apiKey",
        },
      },
    },
    info: {
      description:
        "Management contract source. A selected contract is not evidence of a deployed adapter. Runtime validation also enforces calendar range and time-zone relationships not expressible in JSON Schema. Mutation approval, idempotency and audit require their durable execution implementation. Streaming is unsupported.",
      title: "Quieter Management API",
      version: CONTROL_API_VERSION,
    },
    openapi: "3.1.0",
    paths,
    "x-quieter-streaming": false,
  };
};
