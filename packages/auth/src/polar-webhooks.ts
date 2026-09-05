import { Subscription$inboundSchema } from "@polar-sh/sdk/models/components/subscription.js";
import { syncBillingSubscription } from "@quieter/billing/subscription-sync";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

const subscriptionEvents = new Set([
  "subscription.active",
  "subscription.canceled",
  "subscription.created",
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

  const body = await request.text();
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
    const subscription = Subscription$inboundSchema.parse(
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
