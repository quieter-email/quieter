import {
  processGmailPubSubNotification,
  type GmailPubSubNotificationMessage,
} from "@quieter/orpc/gmail-pubsub";
import { z } from "zod";
import {
  bearerTokenMatches,
  getBearerToken,
  parseEventJson,
  toJson,
  type LambdaFunctionUrlEvent,
  type LambdaFunctionUrlResponse,
} from "./function-url";
import { notifyGmailLiveSyncConnections } from "./gmail-live-sync";

const notificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.string().min(1),
  pubSubMessageId: z.string().min(1),
  type: z.literal("notification"),
});

export const handler = async (
  event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResponse> => {
  try {
    if (event.requestContext?.http?.method?.toUpperCase() !== "POST") {
      return toJson({ error: "Method not allowed" }, 405);
    }
    const token = getBearerToken(event.headers);
    if (!bearerTokenMatches(token, process.env.GMAIL_PUBSUB_PROCESS_TOKEN || "")) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    const message = notificationSchema.parse(
      parseEventJson(event),
    ) satisfies GmailPubSubNotificationMessage;
    await processGmailPubSubNotification(message, {
      onAccepted: async ({ mailboxId }) => {
        await notifyGmailLiveSyncConnections(mailboxId);
      },
      onProcessed: async ({ mailboxId }) => {
        await notifyGmailLiveSyncConnections(mailboxId, "mailbox-details-dirty");
      },
    });

    return { body: "", statusCode: 204 };
  } catch (error) {
    console.error(
      "Could not process Gmail Pub/Sub notification.",
      error instanceof Error ? error.message : "Unknown error.",
    );
    return toJson({ error: "Could not process notification" }, 500);
  }
};
