import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  MAX_SEND_PAYLOAD_BYTES,
  sendMessageInputSchema,
} from "@quieter/mail/send";
import type { SendMessageInput, SendMessageResult } from "@quieter/mail/send";
import { z } from "zod";

import { getOrganizationApiKeyOrganizationId } from "./organization-api-auth.server";
import { reportServerError } from "./server-error-reporting";

const serverInfo = {
  name: "quieter-transactional-mail",
  title: "Quieter Transactional Mail",
  version: "1.0.0",
};

const serverInstructions = `Send transactional email through Quieter. The send_email tool sends from a domain the team has verified. Recipients on the team suppression list are rejected. This server cannot read mailboxes, mail content, team settings, or delivery status: use the Quieter REST API at GET /api/v1/messages/{messageId} for delivery receipts.`;

const addressListSchema = z
  .union([z.string(), z.array(z.string())])
  .describe("One address, or a list of addresses.");

const sendEmailInputSchema = z.object({
  attachments: z
    .array(
      z.object({
        content: z.string().describe("Base64-encoded file content."),
        contentId: z
          .string()
          .optional()
          .describe(
            "Content ID used to reference inline attachments from HTML."
          ),
        contentType: z
          .string()
          .optional()
          .describe("MIME type. Defaults to application/octet-stream."),
        disposition: z
          .enum(["attachment", "inline"])
          .optional()
          .describe("Defaults to attachment."),
        filename: z.string().describe("File name shown to the recipient."),
      })
    )
    .optional()
    .describe("Optional attachments. Keep the total request body under 25 MB."),
  bcc: addressListSchema.optional().describe("Blind carbon copy recipients."),
  cc: addressListSchema.optional().describe("Carbon copy recipients."),
  from: z
    .string()
    .describe(
      "Sender address on a domain verified for this team, for example `Acme <hello@acme.com>`."
    ),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Extra headers as name and value pairs. Structural headers such as From, To, and Subject are not allowed."
    ),
  html: z
    .string()
    .optional()
    .describe("HTML body. Required when an inline attachment is used."),
  idempotencyKey: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      "Retry-safe key. Repeating a call with the same key and message returns the original send instead of sending again."
    ),
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
    .optional()
    .describe("Metadata stored alongside the message."),
  openTracking: z
    .boolean()
    .optional()
    .describe("Enable open tracking for this message."),
  replyTo: addressListSchema.optional().describe("Reply-to addresses."),
  subject: z.string().min(1).describe("Message subject."),
  tags: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe("Tags forwarded to the delivery provider."),
  text: z.string().min(1).describe("Plain-text body."),
  to: addressListSchema.describe(
    "Recipient addresses. At least one is required."
  ),
});

const sendEmailOutputSchema = z.object({
  idempotent: z
    .boolean()
    .describe(
      "True when this call replayed an earlier send with the same idempotency key."
    ),
  messageId: z
    .string()
    .nullable()
    .describe(
      "Message identifier for GET /api/v1/messages/{messageId} delivery status."
    ),
  sent: z.literal(true),
});

type SendTransactionalMail = (input: {
  message: SendMessageInput;
  organizationId: string;
}) => Promise<SendMessageResult>;

const defaultSendTransactionalMail: SendTransactionalMail = async (input) => {
  const { sendOrganizationMailMessage } =
    await import("@quieter/orpc/organization-mail");
  return await sendOrganizationMailMessage(input);
};

const transactionMailMcpToolDescription = `Send transactional email from a verified team domain. Runs the same checks as POST /api/v1/send: the sender domain must be verified, suppressed recipients are rejected, the team's usage balance is charged, and an idempotency key makes retries safe. Returns the message identifier used to read delivery status.`;

export const buildTransactionalMailMcpServer = (input: {
  organizationId: string;
  sendTransactionalMail?: SendTransactionalMail;
}): McpServer => {
  const sendTransactionalMail =
    input.sendTransactionalMail ?? defaultSendTransactionalMail;
  const server = new McpServer(serverInfo, {
    instructions: serverInstructions,
  });

  server.registerTool(
    "send_email",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description: transactionMailMcpToolDescription,
      inputSchema: sendEmailInputSchema,
      outputSchema: sendEmailOutputSchema,
      title: "Send transactional email",
    },
    async (args): Promise<CallToolResult> => {
      const parsedMessage = sendMessageInputSchema.safeParse(args);
      if (!parsedMessage.success) {
        return {
          content: [
            {
              text: `The message is not valid: ${z.prettifyError(parsedMessage.error)}`,
              type: "text",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await sendTransactionalMail({
          message: parsedMessage.data,
          organizationId: input.organizationId,
        });
        const structuredContent = {
          idempotent: result.idempotent === true,
          messageId: result.messageId,
          sent: true as const,
        };
        let summaryText = `Sent message ${result.messageId}.`;
        if (result.messageId === null || result.messageId === "") {
          summaryText = "Message accepted for delivery.";
        } else if (result.idempotent === true) {
          summaryText = `Message ${result.messageId} was already sent; replayed from the original idempotency key.`;
        }
        return {
          content: [{ text: summaryText, type: "text" }],
          structuredContent,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "OrganizationMailSendError"
        ) {
          return {
            content: [{ text: error.message, type: "text" }],
            isError: true,
          };
        }
        reportServerError(error, "transactional-mail-mcp-send");
        return {
          content: [
            {
              text: "Could not send the mail message. Try again later.",
              type: "text",
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
};

const getOrganizationId = (context: McpRequestContext) => {
  const organizationId = context.authInfo?.extra?.organizationId;
  if (typeof organizationId !== "string" || organizationId === "") {
    throw new Error(
      "The transactional mail MCP request is missing its organization context."
    );
  }
  return organizationId;
};

const expectedMcpClientErrorPrefixes = [
  "Bad Request",
  "Conflict",
  "Failed to write to the response stream",
  "Invalid event ID format",
  "Invalid Request",
  "Method not allowed",
  "Not Acceptable",
  "Parse error",
  "Received a response for an unknown request id",
  "Session not found",
  "Unsupported Media Type",
  "Unsupported protocol version",
];

const isReportableMcpError = (error: Error) =>
  !(error instanceof ProtocolError) &&
  !(error instanceof SyntaxError) &&
  !(error instanceof z.ZodError) &&
  !expectedMcpClientErrorPrefixes.some((prefix) =>
    error.message.startsWith(prefix)
  );

const transactionalMailMcpHandler = createMcpHandler(
  (context) =>
    buildTransactionalMailMcpServer({
      organizationId: getOrganizationId(context),
    }),
  {
    onerror: (error) => {
      if (isReportableMcpError(error)) {
        reportServerError(error, "transactional-mail-mcp");
      }
    },
  }
);

const corsHeaders = {
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const handleTransactionalMailMcpRequest = async (
  request: Request
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_SEND_PAYLOAD_BYTES
  ) {
    return withCors(
      Response.json({ error: "Request body is too large." }, { status: 413 })
    );
  }

  const organizationId = await getOrganizationApiKeyOrganizationId(request);
  if (organizationId === null) {
    return withCors(
      Response.json(
        { error: "Unauthorized" },
        {
          headers: {
            "www-authenticate": 'Bearer realm="quieter-transactional-mail"',
          },
          status: 401,
        }
      )
    );
  }

  try {
    const response = await transactionalMailMcpHandler.fetch(request, {
      authInfo: {
        clientId: organizationId,
        extra: { organizationId },
        scopes: [],
        token: "organization-api-key",
      },
    });
    return withCors(response);
  } catch (error) {
    reportServerError(error, "transactional-mail-mcp");
    return withCors(
      Response.json(
        { error: "Could not process the MCP request." },
        { status: 500 }
      )
    );
  }
};
