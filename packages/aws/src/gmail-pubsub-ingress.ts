import { createHash } from "node:crypto";

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { acceptGmailPubSubNotification } from "@quieter/orpc/gmail-pubsub";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import { getBearerToken, parseEventJson, toJson } from "./function-url";
import type {
  LambdaFunctionUrlEvent,
  LambdaFunctionUrlResponse,
} from "./function-url";
import { reportAwsError } from "./sentry";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
  }),
  subscription: z.string().min(1),
});

const gmailNotificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z
    .union([
      z.string().regex(/^\d+$/u),
      z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .transform(String),
    ])
    .pipe(z.string().min(1)),
});

export const parseGmailPubSubNotification = (data: string) =>
  gmailNotificationSchema.parse(
    JSON.parse(Buffer.from(data, "base64url").toString("utf-8"))
  );

let sqsClient: SQSClient | null = null;

const getSqsClient = () => {
  sqsClient ??= new SQSClient({
    region: serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION,
  });
  return sqsClient;
};

const verifyPushToken = async (token: string) => {
  const expectedAudience = requireServerEnv("GMAIL_PUBSUB_PUSH_AUDIENCE");
  const expectedServiceAccount = requireServerEnv(
    "GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT"
  ).toLowerCase();
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    audience: expectedAudience,
    issuer: ["accounts.google.com", "https://accounts.google.com"],
  });

  if (
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== expectedServiceAccount
  ) {
    throw new Error("Pub/Sub push token service account is invalid.");
  }
};

export const handler = async (
  event: LambdaFunctionUrlEvent
): Promise<LambdaFunctionUrlResponse> => {
  if (event.requestContext?.http?.method?.toUpperCase() !== "POST") {
    return toJson({ error: "Method not allowed" }, 405);
  }

  const token = getBearerToken(event.headers);
  if (token === null || token === undefined || token === "") {
    return toJson({ error: "Unauthorized" }, 401);
  }
  try {
    await verifyPushToken(token);
  } catch {
    return toJson({ error: "Unauthorized" }, 401);
  }

  const envelope = pubSubEnvelopeSchema.safeParse(parseEventJson(event));
  if (!envelope.success) {
    return toJson({ error: "Invalid notification" }, 400);
  }
  try {
    if (
      envelope.data.subscription !==
      requireServerEnv("GMAIL_PUBSUB_SUBSCRIPTION")
    ) {
      return toJson({ error: "Unexpected subscription" }, 403);
    }

    const notification = parseGmailPubSubNotification(
      envelope.data.message.data
    );
    const emailAddress = notification.emailAddress.trim().toLowerCase();
    const accepted = await acceptGmailPubSubNotification({ emailAddress });
    if (accepted.accepted) {
      try {
        const { notifyGmailLiveSyncConnections } =
          await import("./gmail-live-sync");
        await notifyGmailLiveSyncConnections(accepted.mailboxId);
      } catch (error) {
        await reportAwsError(error, "GmailPubSubIngressFanout");
      }
    }

    await getSqsClient().send(
      new SendMessageCommand({
        MessageBody: JSON.stringify({
          emailAddress,
          historyId: notification.historyId,
          pubSubMessageId: envelope.data.message.messageId,
          type: "notification",
        }),
        MessageDeduplicationId: envelope.data.message.messageId,
        MessageGroupId: createHash("sha256").update(emailAddress).digest("hex"),
        QueueUrl: requireServerEnv("GMAIL_PUBSUB_QUEUE_URL"),
      })
    );

    return {
      body: "",
      headers: {
        "cache-control": "no-store",
      },
      statusCode: 204,
    };
  } catch (error) {
    await reportAwsError(error, "GmailPubSubIngress");
    return toJson({ error: "Could not accept notification" }, 500);
  }
};
