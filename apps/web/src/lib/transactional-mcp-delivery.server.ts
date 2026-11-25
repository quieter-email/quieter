import type { McpServer } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import {
  messageDeliverySchema,
  recipientSuppressionListSchema,
} from "@quieter/mail/delivery";
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

const readAnnotations = {
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

const suppressionRecipientSchema = z.strictObject({
  organizationId: transactionalOrganizationIdSchema,
  recipient: z.string().trim().pipe(z.email().max(320)),
});

const removeSuppressionToolName = "transactional_remove_suppression";

export const registerTransactionalMailDeliveryTools = (
  server: McpServer,
  access: TransactionalMailAccess
) => {
  const teamSchema = z.strictObject(
    "organizationId" in access
      ? {}
      : { organizationId: transactionalOrganizationIdSchema }
  );
  const resolveReadTeam = async (
    args: { organizationId?: unknown },
    requireApiKeys: boolean
  ): Promise<string> => {
    if ("organizationId" in access) {
      return access.organizationId;
    }
    if (typeof args.organizationId !== "string") {
      throw new ORPCError("BAD_REQUEST", { message: "Specify a team ID." });
    }
    await assertTransactionalTeamAccess({
      organizationId: args.organizationId,
      requireApiKeys,
      userId: access.userId,
    });
    return args.organizationId;
  };

  server.registerTool(
    "transactional_get_delivery",
    {
      annotations: readAnnotations,
      description:
        "Read recipient statuses and delivery events for a sent transactional message.",
      inputSchema: teamSchema.extend({
        messageId: z
          .string()
          .trim()
          .min(1)
          .describe("Message ID returned by the send tool."),
      }),
      title: "Get transactional delivery status",
    },
    async (args) =>
      await runTransactionalTool(
        "transactional-mail-mcp-delivery",
        "Could not load message delivery status.",
        async () => {
          const organizationId = await resolveReadTeam(args, true);
          const { getOrganizationMailDelivery } =
            await import("@quieter/orpc/organization-mail-delivery");
          const delivery = await getOrganizationMailDelivery({
            organizationId,
            providerMessageId: args.messageId,
            transactionalOnly: "userId" in access,
          });
          if (delivery === null) {
            return transactionalToolError("Message not found.");
          }
          const data = messageDeliverySchema.parse(delivery);
          return {
            content: [{ text: JSON.stringify(data), type: "text" }],
            structuredContent: data,
          };
        }
      )
  );

  server.registerTool(
    "transactional_list_suppressions",
    {
      annotations: readAnnotations,
      description:
        "List addresses currently blocked from receiving outbound mail from the team, most recent first.",
      inputSchema: teamSchema.extend({
        limit: z.number().int().min(1).max(500).optional(),
      }),
      title: "List recipient suppressions",
    },
    async (args) =>
      await runTransactionalTool(
        "transactional-mail-mcp-suppressions",
        "Could not load recipient suppressions.",
        async () => {
          const organizationId = await resolveReadTeam(args, false);
          const { listOrganizationMailRecipientSuppressions } =
            await import("@quieter/orpc/organization-mail-delivery");
          const suppressions = await listOrganizationMailRecipientSuppressions({
            limit: args.limit,
            organizationId,
          });
          const data = recipientSuppressionListSchema.parse({
            data: suppressions,
          });
          return {
            content: [{ text: JSON.stringify(data), type: "text" }],
            structuredContent: data,
          };
        }
      )
  );

  if ("organizationId" in access) {
    return;
  }

  server.registerTool(
    "transactional_add_suppression",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Block the team from sending outbound mail to one exact address.",
      inputSchema: suppressionRecipientSchema,
      title: "Add a recipient suppression",
    },
    async (args) =>
      await runTransactionalTool(
        "transactional-mail-mcp-add-suppression",
        "Could not add the recipient suppression.",
        async () => {
          await assertTransactionalTeamAccess({
            organizationId: args.organizationId,
            requireApiKeys: false,
            userId: access.userId,
          });
          const { suppressOrganizationMailRecipient } =
            await import("@quieter/orpc/organization-mail-delivery");
          const result = await suppressOrganizationMailRecipient({
            actorUserId: access.userId,
            ...args,
          });
          return {
            content: [
              {
                text: result.changed
                  ? "Recipient suppressed."
                  : "Recipient was already suppressed.",
                type: "text",
              },
            ],
            structuredContent: result,
          };
        }
      )
  );

  server.registerTool(
    removeSuppressionToolName,
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Remove a suppression for one exact address so the team can send it mail again. Use explicit authorization only when the user clearly requested this exact removal. Otherwise request approval first.",
      inputSchema: suppressionRecipientSchema.extend({
        authorization: mcpAuthorizationSchema.optional(),
      }),
      title: "Remove a recipient suppression",
    },
    async ({ authorization, ...target }) =>
      await runTransactionalTool(
        "transactional-mail-mcp-remove-suppression",
        "Could not remove the recipient suppression.",
        async () => {
          await assertTransactionalTeamAccess({
            organizationId: target.organizationId,
            requireApiKeys: false,
            userId: access.userId,
          });
          const approval = requireMcpApproval({
            action: removeSuppressionToolName,
            authorization,
            effect: "delete",
            payload: target,
            principal: access.principal,
          });
          if (approval !== null) {
            return approval;
          }
          const { unsuppressOrganizationMailRecipient } =
            await import("@quieter/orpc/organization-mail-delivery");
          const result = await unsuppressOrganizationMailRecipient({
            actorUserId: access.userId,
            ...target,
          });
          return {
            content: [
              {
                text: result.changed
                  ? "Recipient suppression removed."
                  : "Recipient had no active suppression.",
                type: "text",
              },
            ],
            structuredContent: result,
          };
        }
      )
  );
};
