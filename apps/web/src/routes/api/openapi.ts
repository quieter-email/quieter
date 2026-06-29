import { createFileRoute } from "@tanstack/react-router";

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Quieter API",
    version: "0.1.0",
  },
  servers: [
    {
      url: "/",
    },
  ],
  components: {
    securitySchemes: {
      organizationApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Quieter team API key",
      },
    },
    schemas: {
      SendMessageRequest: {
        type: "object",
        additionalProperties: false,
        required: ["from", "subject", "text", "to"],
        properties: {
          attachments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["filename", "content"],
              properties: {
                content: {
                  type: "string",
                  description: "Base64 encoded attachment bytes.",
                },
                contentId: { type: "string" },
                contentType: {
                  type: "string",
                  default: "application/octet-stream",
                },
                disposition: {
                  type: "string",
                  enum: ["attachment", "inline"],
                  default: "attachment",
                },
                filename: { type: "string", minLength: 1 },
              },
            },
          },
          bcc: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          cc: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          from: {
            type: "string",
            description:
              "Sender address. Display names are supported; the email domain must be verified for the team that owns the API key.",
            examples: ["Demo <demo@quieter.email>"],
          },
          headers: {
            oneOf: [
              { type: "object", additionalProperties: { type: "string" } },
              {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "value"],
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                  },
                },
              },
            ],
          },
          html: {
            type: "string",
            minLength: 1,
          },
          idempotencyKey: {
            type: "string",
          },
          metadata: {
            type: "object",
            additionalProperties: {
              type: ["string", "number", "boolean", "null"],
            },
          },
          replyTo: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          subject: {
            type: "string",
            minLength: 1,
          },
          tags: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "value"],
              properties: {
                name: { type: "string" },
                value: { type: "string" },
              },
            },
          },
          text: {
            type: "string",
            minLength: 1,
          },
          to: {
            oneOf: [{ type: "string" }, { type: "array", minItems: 1, items: { type: "string" } }],
          },
        },
      },
      SendMessageResponse: {
        type: "object",
        additionalProperties: false,
        required: ["messageId", "sent"],
        properties: {
          idempotent: {
            type: "boolean",
            description: "Present when an idempotency key returned a previous result.",
          },
          messageId: {
            type: ["string", "null"],
          },
          sent: {
            type: "boolean",
            const: true,
          },
        },
      },
      ErrorResponse: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "string",
          },
        },
      },
    },
  },
  paths: {
    "/api/v1/send": {
      post: {
        operationId: "sendMessage",
        summary: "Send a mail message",
        description: "Sends a message from a verified sender domain owned by the team API key.",
        security: [{ organizationApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendMessageRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Idempotent replay returned a previously accepted message result.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageResponse" },
              },
            },
          },
          "201": {
            description: "Message accepted by the mail provider.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageResponse" },
              },
            },
          },
          "409": {
            description: "The idempotency key was already used with a different message.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "413": {
            description: "Message payload is too large.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "400": {
            description: "Invalid message payload.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Missing or invalid team API key.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "403": {
            description: "Sender domain is not verified for this team.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "The message could not be sent.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(openApiDocument, {
          headers: {
            "cache-control": "no-store",
          },
        }),
    },
  },
});
