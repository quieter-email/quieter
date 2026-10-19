import { controlOperations } from "@quieter/mail/control";
import { z } from "zod";

export const controlOpenApiPaths = {
  "/api/v1/control": {
    post: {
      description:
        "Organization-bound audience and campaign operations. The API key must have the operation's explicit permission. Organization identity comes from the authenticated key. Transactional-only keys have no control access. All operations reuse the app's authorization, consent, suppression, and history services.",
      operationId: "controlOperation",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              oneOf: Object.entries(controlOperations).map(
                ([operation, contract]) => ({
                  additionalProperties: false,
                  description: `${contract.description} Required permission: ${contract.scope}.`,
                  properties: {
                    input: z.toJSONSchema(contract.input, { io: "input" }),
                    operation: { const: operation, type: "string" },
                  },
                  required: ["operation", "input"],
                  type: "object",
                })
              ),
            },
          },
        },
        required: true,
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                anyOf: Object.values(controlOperations).map((contract) =>
                  z.toJSONSchema(contract.output, { io: "input" })
                ),
              },
            },
          },
          description: "The validated result of the requested operation.",
        },
        "400": { description: "Invalid input or missing send confirmation." },
        "401": {
          description: "Missing, invalid, expired or inactive API key.",
        },
        "403": {
          description:
            "The key lacks the required permission, or billing or sender checks failed.",
        },
        "404": {
          description:
            "The requested organization-owned resource does not exist.",
        },
        "409": {
          description:
            "The draft changed, an idempotency key was reused with different input, or the operation conflicts with current state.",
        },
        "413": { description: "The payload exceeds the one megabyte limit." },
        "429": { description: "Rate limit reached." },
      },
      security: [{ organizationApiKey: [] }],
      summary: "Manage audiences and campaigns",
    },
  },
  "/api/v1/control/mcp": {
    post: {
      description:
        "Streamable HTTP MCP with tools discovered from the authenticated key's audience and campaign permissions. Uses the same operation contracts as /api/v1/control.",
      responses: {
        "200": { description: "MCP response." },
        "401": { description: "Invalid API key." },
        "403": { description: "No management permissions." },
      },
      security: [{ organizationApiKey: [] }],
      summary: "Audience and campaign MCP",
    },
  },
};
