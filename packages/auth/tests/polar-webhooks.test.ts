import type * as SubscriptionSyncModule from "@quieter/billing/subscription-sync";
import type * as ServerEnvModule from "@quieter/env/server";
import { Webhook } from "standardwebhooks";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { handlePolarWebhookRequest } from "../src/polar-webhooks";

const mocks = vi.hoisted(() => ({
  secret: `whsec_${Buffer.from("test-webhook-signing-material").toString("base64")}`,
  sync: vi.fn<typeof SubscriptionSyncModule.syncBillingSubscription>(),
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal<typeof ServerEnvModule>();
  return {
    ...actual,
    serverEnv: actual.createServerEnv({
      NODE_ENV: "test",
      POLAR_WEBHOOK_SECRET: mocks.secret,
    }),
  };
});

vi.mock(
  import("@quieter/billing/subscription-sync"),
  async (importOriginal) => {
    const actual = await importOriginal<typeof SubscriptionSyncModule>();
    return { ...actual, syncBillingSubscription: mocks.sync };
  }
);

const createdAt = "2026-08-01T00:00:00.000Z";
const subscription = {
  amount: 0,
  cancel_at_period_end: false,
  canceled_at: null,
  checkout_id: null,
  created_at: createdAt,
  currency: "usd",
  current_meter_period_end: null,
  current_meter_period_start: null,
  current_period_end: "2026-09-01T00:00:00.000Z",
  current_period_start: createdAt,
  customer: {
    avatar_url: null,
    billing_address: null,
    billing_name: null,
    created_at: createdAt,
    deleted_at: null,
    email_verified: false,
    id: "customer-a",
    metadata: {},
    modified_at: null,
    name: "Team A",
    organization_id: "merchant-a",
    tax_id: null,
    type: "team",
  },
  customer_cancellation_comment: null,
  customer_cancellation_reason: null,
  customer_id: "customer-a",
  discount: null,
  discount_id: null,
  ended_at: null,
  ends_at: null,
  id: "subscription-a",
  metadata: {
    quieterOrganizationId: "team-a",
    quieterProduct: "pro",
    quieterUserId: "user-a",
  },
  meters: [],
  modified_at: createdAt,
  pause_at_period_end: false,
  paused_at: null,
  pending_update: null,
  prices: [],
  product: {
    attached_custom_fields: [],
    benefits: [],
    created_at: createdAt,
    description: null,
    id: "product-a",
    is_archived: false,
    is_recurring: true,
    medias: [],
    metadata: {},
    meter_interval: null,
    meter_interval_count: null,
    modified_at: null,
    name: "Pro",
    organization_id: "merchant-a",
    prices: [],
    recurring_interval: "month",
    recurring_interval_count: 1,
    trial_interval: null,
    trial_interval_count: null,
    visibility: "public",
  },
  product_id: "product-a",
  recurring_interval: "month",
  recurring_interval_count: 1,
  resumes_at: null,
  started_at: createdAt,
  status: "active",
  trial_end: null,
  trial_start: null,
};

const signedRequest = (
  payload: unknown,
  options: { legacy?: boolean; timestamp?: Date; tamper?: boolean } = {}
) => {
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp ?? new Date();
  const signer = new Webhook(
    options.legacy === true
      ? Buffer.from(mocks.secret).toString("base64")
      : mocks.secret
  );
  return new Request("https://quieter.email/api/auth/polar/webhooks", {
    body: options.tamper === true ? `${body} ` : body,
    headers: {
      "webhook-id": "event-a",
      "webhook-signature": signer.sign("event-a", timestamp, body),
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    },
    method: "POST",
  });
};

describe("Polar webhook receiver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sync.mockResolvedValue({ synced: true });
  });

  test.each([false, true])(
    "accepts signed subscription updates, legacy=%s",
    async (legacy) => {
      const response = await handlePolarWebhookRequest(
        signedRequest(
          { data: subscription, type: "subscription.updated" },
          { legacy }
        )
      );
      expect(response.status).toBe(200);
      expect(mocks.sync).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPeriodEnd: new Date(subscription.current_period_end),
          id: "subscription-a",
          status: "active",
        })
      );
    }
  );

  test.each([
    "active",
    "canceled",
    "created",
    "past_due",
    "paused",
    "resumed",
    "revoked",
    "uncanceled",
  ])("handles subscription.%s", async (event) => {
    const response = await handlePolarWebhookRequest(
      signedRequest({
        data: { ...subscription, status: "canceled" },
        type: `subscription.${event}`,
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" })
    );
  });

  test("rejects tampered payloads before synchronization", async () => {
    const response = await handlePolarWebhookRequest(
      signedRequest(
        { data: subscription, type: "subscription.updated" },
        { tamper: true }
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("rejects stale signatures", async () => {
    const response = await handlePolarWebhookRequest(
      signedRequest(
        { data: subscription, type: "subscription.updated" },
        { timestamp: new Date(Date.now() - 600_000) }
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("returns a retryable failure when synchronization cannot apply the subscription", async () => {
    mocks.sync.mockResolvedValue({ synced: false });
    const response = await handlePolarWebhookRequest(
      signedRequest({ data: subscription, type: "subscription.updated" })
    );
    expect(response.status).toBe(500);
  });

  test("returns a retryable failure after a database error", async () => {
    mocks.sync.mockRejectedValue(new Error("Database unavailable"));
    const response = await handlePolarWebhookRequest(
      signedRequest({ data: subscription, type: "subscription.updated" })
    );
    expect(response.status).toBe(500);
  });

  test("ignores signed unrelated events", async () => {
    const response = await handlePolarWebhookRequest(
      signedRequest({ data: {}, type: "order.paid" })
    );
    expect(response.status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
