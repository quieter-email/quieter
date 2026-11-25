import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { otpTokenSchema } from "@quieter/mail/otp-token";
import { MESSAGES_API_PATH, SEND_API_PATH } from "@quieter/mail/public-api";
import {
  MAX_SEND_ATTACHMENT_METADATA_LENGTH,
  MAX_SEND_ATTACHMENTS,
  sendMessageInputSchema,
} from "@quieter/mail/send";
import type { SendMessageInput, SendMessageResult } from "@quieter/mail/send";
import { z } from "zod";

import {
  mcpAuthorizationSchema,
  requireMcpApproval,
} from "./mcp-approval.server";
import {
  assertTransactionalTeamAccess,
  runTransactionalTool,
  transactionalOrganizationIdSchema,
  transactionalToolError,
} from "./transactional-mcp-access.server";
import type { TransactionalMailAccess } from "./transactional-mcp-access.server";

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
          .max(MAX_SEND_ATTACHMENT_METADATA_LENGTH)
          .optional()
          .describe(
            "Content ID used to reference inline attachments from HTML."
          ),
        contentType: z
          .string()
          .max(MAX_SEND_ATTACHMENT_METADATA_LENGTH)
          .optional()
          .describe("MIME type. Defaults to application/octet-stream."),
        disposition: z
          .enum(["attachment", "inline"])
          .optional()
          .describe("Defaults to attachment."),
        filename: z
          .string()
          .max(MAX_SEND_ATTACHMENT_METADATA_LENGTH)
          .describe("File name shown to the recipient."),
      })
    )
    .max(MAX_SEND_ATTACHMENTS)
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
      "Extra email headers as name and value pairs. Use List-ID to identify a topic and List-Unsubscribe for your recipient-specific unsubscribe URL in angle brackets. Structural headers such as From, To, and Subject are not allowed."
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
      `Message identifier for GET ${MESSAGES_API_PATH}/{messageId} delivery status.`
    ),
  sent: z.literal(true),
});

export type SendTransactionalMail = (input: {
  message: SendMessageInput;
  organizationId: string;
}) => Promise<SendMessageResult>;

const defaultSendTransactionalMail: SendTransactionalMail = async (input) => {
  const { sendOrganizationMailMessage } =
    await import("@quieter/orpc/organization-mail");
  return await sendOrganizationMailMessage(input);
};

const sendToolDescription = `Send transactional email from a verified team domain. Runs the same checks as POST ${SEND_API_PATH}. The sender domain must be verified, suppressed recipients are rejected, the team's usage balance is charged, and an idempotency key makes retries safe. Returns the message identifier used to read delivery status.`;

const sendToolName = "transactional_send_email";

const sendAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: false,
};

const dispatchTransactionalMail = async (
  input: Parameters<SendTransactionalMail>[0],
  sendTransactionalMail: SendTransactionalMail
): Promise<CallToolResult> => {
  const result = await sendTransactionalMail(input);
  const structuredContent = sendEmailOutputSchema.parse({
    idempotent: result.idempotent === true,
    messageId: result.messageId,
    sent: true,
  });
  let text = `Sent message ${result.messageId}.`;
  if (result.messageId === null || result.messageId === "") {
    text = "Message accepted for delivery.";
  } else if (result.idempotent === true) {
    text = `Message ${result.messageId} was already sent. The original result was returned for this idempotency key.`;
  }
  return {
    content: [{ text, type: "text" }],
    structuredContent,
  };
};

export const registerTransactionalMailSendTool = (
  server: McpServer,
  access: TransactionalMailAccess,
  sendTransactionalMail = defaultSendTransactionalMail
) => {
  if ("organizationId" in access) {
    server.registerTool(
      "send_email",
      {
        annotations: sendAnnotations,
        description: `${sendToolDescription} The team API key authorizes direct calls. If acting for a person, first show them the exact message, recipients, and attachments and get their approval, unless they explicitly authorized sending without review. For automated service calls, send only messages authorized by the service's configured workflow.`,
        inputSchema: sendEmailInputSchema,
        outputSchema: sendEmailOutputSchema,
        title: "Send transactional email",
      },
      async (args) => {
        const parsed = sendMessageInputSchema.safeParse(args);
        if (!parsed.success) {
          return transactionalToolError(
            `The message is not valid: ${z.prettifyError(parsed.error)}`
          );
        }
        return await runTransactionalTool(
          "transactional-mail-mcp-send",
          "Could not send the mail message. Try again later.",
          async () =>
            await dispatchTransactionalMail(
              { message: parsed.data, organizationId: access.organizationId },
              sendTransactionalMail
            )
        );
      }
    );
    return;
  }

  server.registerTool(
    sendToolName,
    {
      annotations: sendAnnotations,
      description: `${sendToolDescription} Omit authorization to get a preview, then show the user the exact message and use the returned authorization only after approval. Use send_without_review only when the user expressly waives review. Provide a new idempotency key for each intended send, and reuse the same key and arguments for approvals and retries.`,
      inputSchema: sendEmailInputSchema
        .extend({
          authorization: mcpAuthorizationSchema.optional(),
          headers: z
            .union([
              z.record(z.string(), z.string()),
              z.array(z.object({ name: z.string(), value: z.string() })),
            ])
            .optional()
            .describe(
              "Custom headers as a map or an ordered list. Structural headers such as From, To, and Subject are disallowed."
            ),
          idempotencyKey: sendEmailInputSchema.shape.idempotencyKey.unwrap(),
          organizationId: transactionalOrganizationIdSchema,
          otpToken: otpTokenSchema.optional(),
        })
        .strict(),
      title: "Send transactional email",
    },
    async ({ authorization, organizationId, ...args }) => {
      const parsed = sendMessageInputSchema.safeParse(args);
      if (!parsed.success) {
        return transactionalToolError(
          `The message is not valid: ${z.prettifyError(parsed.error)}`
        );
      }
      const message = parsed.data;
      return await runTransactionalTool(
        "transactional-mail-mcp-send",
        "Could not send the mail message. Try again later.",
        async () => {
          await assertTransactionalTeamAccess({
            organizationId,
            requireApiKeys: true,
            userId: access.userId,
          });
          const approval = requireMcpApproval({
            action: sendToolName,
            authorization,
            effect: "send",
            payload: { message, organizationId },
            preview: {
              ...message,
              attachments: message.attachments.map(
                ({ content: _content, ...metadata }) => metadata
              ),
              organizationId,
            },
            principal: access.principal,
          });
          if (approval !== null) {
            return approval;
          }
          return await dispatchTransactionalMail(
            { message, organizationId },
            sendTransactionalMail
          );
        }
      );
    }
  );
};
