import { polar, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { getPolarServer } from "@quieter/billing/polar";
import { syncBillingSubscription } from "@quieter/billing/subscription-sync";
import { serverEnv } from "@quieter/env/server";
import { betterAuth } from "better-auth";

const polarWebhookAuth =
  serverEnv.POLAR_ACCESS_TOKEN && serverEnv.POLAR_WEBHOOK_SECRET
    ? betterAuth({
        baseURL: serverEnv.BETTER_AUTH_URL || "http://localhost:3000",
        plugins: [
          polar({
            client: new Polar({
              accessToken: serverEnv.POLAR_ACCESS_TOKEN,
              server: getPolarServer(),
            }),
            use: [
              webhooks({
                onSubscriptionActive: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                onSubscriptionCanceled: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                onSubscriptionCreated: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                onSubscriptionRevoked: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                onSubscriptionUncanceled: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                onSubscriptionUpdated: async ({ data }) => {
                  await syncBillingSubscription(data);
                },
                secret: serverEnv.POLAR_WEBHOOK_SECRET,
              }),
            ],
          }),
        ],
      })
    : null;

export const handlePolarWebhookRequest = (request: Request) =>
  polarWebhookAuth?.handler(request) ?? new Response("Not Found", { status: 404 });
