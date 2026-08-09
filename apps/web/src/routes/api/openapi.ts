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
