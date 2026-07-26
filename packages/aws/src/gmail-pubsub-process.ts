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
import { reportAwsError } from "./sentry";

const notificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.string().min(1),
  pubSubMessageId: z.string().min(1),
  type: z.literal("notification"),
});

export const handler = async (
  event: LambdaFunctionUrlEvent,
): Promise<LambdaFunctionUrlResponse> => {
  if (event.requestContext?.http?.method?.toUpperCase() !== "POST") {
    return toJson({ error: "Method not allowed" }, 405);
  }
  const token = getBearerToken(event.headers);
  if (!bearerTokenMatches(token, process.env.GMAIL_PUBSUB_PROCESS_TOKEN || "")) {
    return toJson({ error: "Unauthorized" }, 401);
  }

  const message = notificationSchema.safeParse(parseEventJson(event));
  if (!message.success) {
    return toJson({ error: "Invalid notification" }, 400);
  }
  try {
    await processGmailPubSubNotification(message.data satisfies GmailPubSubNotificationMessage, {
      onAccepted: async ({ mailboxId }) => {
        await notifyGmailLiveSyncConnections(mailboxId);
      },
      onProcessed: async ({ mailboxId }) => {
        await notifyGmailLiveSyncConnections(mailboxId, "mailbox-details-dirty");
      },
    });

    return { body: "", statusCode: 204 };
  } catch (error) {
    await reportAwsError(error, "GmailPubSubProcess");
    console.error(
      "Could not process Gmail Pub/Sub notification.",
      error instanceof Error ? error.message : "Unknown error.",
    );
    return toJson({ error: "Could not process notification" }, 500);
  }
};
