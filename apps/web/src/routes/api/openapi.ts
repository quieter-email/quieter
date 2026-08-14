import { createFileRoute } from "@tanstack/react-router";

const openApiDocument = {
  components: {
    schemas: {
      ErrorResponse: {
        additionalProperties: false,
        properties: {
          error: {
            type: "string",
          },
        },
        required: ["error"],
        type: "object",
      },
      MessageDeliveryResponse: {
        additionalProperties: false,
        properties: {
          events: {
            items: {
              additionalProperties: false,
              properties: {
                diagnosticCode: { type: ["string", "null"] },
                eventType: {
                  enum: [
                    "bounced",
                    "complained",
                    "delayed",
                    "delivered",
                    "rejected",
                    "sent",
                  ],
                },
                occurredAt: { format: "date-time", type: "string" },
                providerStatus: { type: ["string", "null"] },
                reason: { type: ["string", "null"] },
                recipient: { format: "email", type: "string" },
              },
              required: ["eventType", "occurredAt", "recipient"],
              type: "object",
            },
            type: "array",
          },
          messageId: { type: "string" },
          recipients: {
            items: {
              additionalProperties: false,
              properties: {
                lastEventAt: { format: "date-time", type: "string" },
                recipient: { format: "email", type: "string" },
                status: {
                  enum: [
                    "bounced",
                    "complained",
                    "delayed",
                    "delivered",
                    "rejected",
                    "sent",
                  ],
                },
              },
              required: ["lastEventAt", "recipient", "status"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["events", "messageId", "recipients"],
        type: "object",
      },
      SendMessageRequest: {
        additionalProperties: false,
        properties: {
          attachments: {
            items: {
              additionalProperties: false,
              properties: {
                content: {
                  description: "Base64 encoded attachment bytes.",
                  type: "string",
                },
                contentId: { type: "string" },
                contentType: {
                  default: "application/octet-stream",
                  type: "string",
                },
                disposition: {
                  default: "attachment",
                  enum: ["attachment", "inline"],
                  type: "string",
                },
                filename: { minLength: 1, type: "string" },
              },
              required: ["filename", "content"],
              type: "object",
            },
            type: "array",
          },
          bcc: {
            oneOf: [
              { type: "string" },
              { items: { type: "string" }, type: "array" },
            ],
          },
          cc: {
            oneOf: [
              { type: "string" },
              { items: { type: "string" }, type: "array" },
            ],
          },
          from: {
            description:
              "Sender address. Display names are supported; the email domain must be verified for the team that owns the API key.",
            examples: ["Demo <demo@quieter.email>"],
            type: "string",
          },
          headers: {
            oneOf: [
              { additionalProperties: { type: "string" }, type: "object" },
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["name", "value"],
                  type: "object",
                },
                type: "array",
              },
            ],
          },
          html: {
            minLength: 1,
            type: "string",
          },
          idempotencyKey: {
            type: "string",
          },
          metadata: {
            additionalProperties: {
              type: ["string", "number", "boolean", "null"],
            },
            type: "object",
          },
          replyTo: {
            oneOf: [
              { type: "string" },
              { items: { type: "string" }, type: "array" },
            ],
          },
          subject: {
            minLength: 1,
            type: "string",
          },
          tags: {
            items: {
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                value: { type: "string" },
              },
              required: ["name", "value"],
              type: "object",
            },
            type: "array",
          },
          text: {
            minLength: 1,
            type: "string",
          },
          to: {
            oneOf: [
              { type: "string" },
              { items: { type: "string" }, minItems: 1, type: "array" },
            ],
          },
        },
        required: ["from", "subject", "text", "to"],
        type: "object",
      },
      SendMessageResponse: {
        additionalProperties: false,
        properties: {
          idempotent: {
            description:
              "Present when an idempotency key returned a previous result.",
            type: "boolean",
          },
          messageId: {
            type: ["string", "null"],
          },
          sent: {
            const: true,
            type: "boolean",
          },
        },
        required: ["messageId", "sent"],
        type: "object",
      },
      SuppressionListResponse: {
        additionalProperties: false,
        properties: {
          data: {
            items: {
              additionalProperties: false,
              properties: {
                createdAt: { format: "date-time", type: "string" },
                reason: { enum: ["bounce", "complaint"] },
                recipient: { format: "email", type: "string" },
                sourceProviderMessageId: { type: "string" },
              },
              required: [
                "createdAt",
                "reason",
                "recipient",
                "sourceProviderMessageId",
              ],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["data"],
        type: "object",
      },
    },
    securitySchemes: {
      organizationApiKey: {
        bearerFormat: "Quieter team API key",
        scheme: "bearer",
        type: "http",
      },
    },
  },
  info: {
    title: "Quieter API",
    version: "0.1.0",
  },
  openapi: "3.1.0",
  paths: {
    "/api/v1/messages/{messageId}": {
      get: {
        description:
          "Returns recipient-level delivery state and event history for a sent message.",
        operationId: "getMessageDelivery",
        parameters: [
          {
            in: "path",
            name: "messageId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/MessageDeliveryResponse",
                },
              },
            },
            description: "Current recipient delivery state and event history.",
          },
          "401": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Missing or invalid team API key.",
          },
          "404": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Message not found for this team.",
          },
        },
        security: [{ organizationApiKey: [] }],
        summary: "Get message delivery status",
      },
    },
    "/api/v1/send": {
      post: {
        description:
          "Sends a message from a verified sender domain owned by the team API key.",
        operationId: "sendMessage",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendMessageRequest" },
            },
          },
          required: true,
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageResponse" },
              },
            },
            description:
              "Idempotent replay returned a previously accepted message result.",
          },
          "201": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageResponse" },
              },
            },
            description: "Message accepted by the mail provider.",
          },
          "400": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Invalid message payload.",
          },
          "401": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Missing or invalid team API key.",
          },
          "403": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Sender domain is not verified for this team.",
          },
          "409": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description:
              "The idempotency key was already used with a different message.",
          },
          "413": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Message payload is too large.",
          },
          "422": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "One or more recipients are suppressed.",
          },
          "500": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "The message could not be sent.",
          },
        },
        security: [{ organizationApiKey: [] }],
        summary: "Send a mail message",
      },
    },
    "/api/v1/suppressions": {
      get: {
        description:
          "Lists recipients suppressed after permanent bounces or complaints.",
        operationId: "listRecipientSuppressions",
        parameters: [
          {
            in: "query",
            name: "limit",
            required: false,
            schema: { maximum: 500, minimum: 1, type: "integer" },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SuppressionListResponse",
                },
              },
            },
            description: "Active team recipient suppressions.",
          },
          "401": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
            description: "Missing or invalid team API key.",
          },
        },
        security: [{ organizationApiKey: [] }],
        summary: "List recipient suppressions",
      },
    },
  },
  servers: [
    {
      url: "/",
    },
  ],
} as const;

export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: () =>
        Response.json(openApiDocument, {
          headers: {
            "cache-control": "no-store",
          },
        }),
    },
  },
});
