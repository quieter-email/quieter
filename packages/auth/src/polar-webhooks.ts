import {
  billingPolarSubscriptionSchema,
  syncBillingSubscription,
} from "@quieter/billing/subscription-sync";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

// Local safety policy, not a provider payload-size guarantee.
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

const subscriptionEvents = new Set([
  "subscription.active",
  "subscription.canceled",
  "subscription.created",
  "subscription.cycled",
  "subscription.migrated",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.revoked",
  "subscription.uncanceled",
  "subscription.updated",
]);

const webhookPayloadSchema = z.object({ data: z.unknown(), type: z.string() });

export const handlePolarWebhookRequest = async (request: Request) => {
  const secret = serverEnv.POLAR_WEBHOOK_SECRET;
  if (secret === undefined || secret === "") {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES
  ) {
    return new Response("Request body too large", { status: 413 });
  }

  let body = "";
  if (request.body !== null) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    try {
      while (true) {
        // Read serially so no further bytes are retained after overflow.
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // A transport cancellation failure must not replace the rejection.
          }
          return new Response("Request body too large", { status: 413 });
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const headers = Object.fromEntries(request.headers);
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(body, headers);
  } catch {
    // Secrets created before 2026-09-08 sign with the entire UTF-8 secret.
    try {
      payload = new Webhook(
        Buffer.from(secret, "utf-8").toString("base64")
      ).verify(body, headers);
    } catch {
      return new Response("Invalid webhook signature", { status: 403 });
    }
  }

  const parsedPayload = webhookPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return new Response("Invalid webhook payload", { status: 400 });
  }
  if (!subscriptionEvents.has(parsedPayload.data.type)) {
    return Response.json({ received: true });
  }

  try {
    const subscription = billingPolarSubscriptionSchema.parse(
      parsedPayload.data.data
    );
    const result = await syncBillingSubscription(subscription);
    if (!result.synced) {
      return new Response("Could not synchronize subscription", {
        status: 500,
      });
    }
    return Response.json({ received: true });
  } catch (error) {
    reportError(error, { operation: "billing:subscription-webhook" });
    return new Response("Could not synchronize subscription", { status: 500 });
  }
};
