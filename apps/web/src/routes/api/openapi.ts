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
      teamApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Quieter team API key",
      },
    },
    schemas: {
      SendMessageRequest: {
        type: "object",
        additionalProperties: false,
        required: ["sender", "subject", "to"],
        properties: {
          bcc: {
            type: "array",
            items: { type: "string", format: "email" },
          },
          cc: {
            type: "array",
            items: { type: "string", format: "email" },
          },
          html: {
            type: "string",
            minLength: 1,
          },
          replyTo: {
            type: "array",
            items: { type: "string", format: "email" },
          },
          sender: {
            type: "string",
            format: "email",
            description:
              "Sender address. The domain must be verified for the team that owns the API key.",
          },
          subject: {
            type: "string",
            minLength: 1,
          },
          text: {
            type: "string",
            minLength: 1,
          },
          to: {
            type: "array",
            minItems: 1,
            items: { type: "string", format: "email" },
          },
        },
        anyOf: [{ required: ["text"] }, { required: ["html"] }],
      },
      SendMessageResponse: {
        type: "object",
        additionalProperties: false,
        required: ["messageId", "sent"],
        properties: {
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
        additionalProperties: true,
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
    "/api/messages": {
      post: {
        operationId: "sendMessage",
        summary: "Send a mail message",
        description: "Sends a message from a verified sender domain owned by the team API key.",
        security: [{ teamApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendMessageRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Message accepted by the mail provider.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageResponse" },
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
            "cache-control": "public, max-age=300",
          },
        }),
    },
  },
});
