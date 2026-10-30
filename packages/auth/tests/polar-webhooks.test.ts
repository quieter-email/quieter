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

  test.each([undefined, "1", "not-a-length"])(
    "bounds actual streamed bytes independently of content-length=%s",
    async (declaredLength) => {
      const cancel = vi.fn<() => void>();
      const chunk = new TextEncoder().encode("é".repeat(262_144));
      let reads = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          cancel,
          pull(controller) {
            reads += 1;
            if (reads <= 4) {
              controller.enqueue(chunk);
            } else {
              controller.close();
            }
          },
        },
        { highWaterMark: 0 }
      );
      const headers = new Headers();
      if (declaredLength !== undefined) {
        headers.set("content-length", declaredLength);
      }
      const init = {
        body,
        duplex: "half",
        headers,
        method: "POST",
      };
      const request = new Request(
        "https://quieter.email/api/auth/polar/webhooks",
        init
      );
      const verify = vi.spyOn(Webhook.prototype, "verify");
      const response = await handlePolarWebhookRequest(request);
      expect(response.status).toBe(413);
      expect(cancel).toHaveBeenCalledOnce();
      expect(reads).toBeLessThan(4);
      expect(verify).not.toHaveBeenCalled();
      expect(mocks.sync).not.toHaveBeenCalled();
      verify.mockRestore();
    }
  );

  test("rejects an excessive declared size without reading or verifying", async () => {
    const pull = vi.fn<() => void>();
    const init = {
      body: new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 }),
      duplex: "half",
      headers: { "content-length": "9999999999999999999999999" },
      method: "POST",
    };
    const request = new Request(
      "https://quieter.email/api/auth/polar/webhooks",
      init
    );
    const verify = vi.spyOn(Webhook.prototype, "verify");
    const response = await handlePolarWebhookRequest(request);
    expect(response.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });

  test.each([false, true])(
    "preserves signed UTF-8 and whitespace at the byte limit, legacy=%s",
    async (legacy) => {
      const payload = JSON.stringify({
        data: { name: "é🐈" },
        type: "order.paid",
      });
      const body = `${payload}${" ".repeat(1_048_576 - Buffer.byteLength(payload))}`;
      const signer = new Webhook(
        legacy ? Buffer.from(mocks.secret).toString("base64") : mocks.secret
      );
      const timestamp = new Date();
      const bytes = new TextEncoder().encode(body);
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 31, bytes.length);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        },
      });
      const init = {
        body: stream,
        duplex: "half",
        headers: {
          "webhook-id": "event-a",
          "webhook-signature": signer.sign("event-a", timestamp, body),
          "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1e3)),
        },
        method: "POST",
      };
      const response = await handlePolarWebhookRequest(
        new Request("https://quieter.email/api/auth/polar/webhooks", init)
      );
      expect(response.status).toBe(200);
      expect(mocks.sync).not.toHaveBeenCalled();
    }
  );

  test("keeps overflow rejection when transport cancellation fails", async () => {
    const cancel = vi.fn<() => void>(() => {
      throw new Error("Transport closed");
    });
    const init = {
      body: new ReadableStream<Uint8Array>(
        {
          cancel,
          pull(controller) {
            controller.enqueue(new Uint8Array(1_048_577));
          },
        },
        { highWaterMark: 0 }
      ),
      duplex: "half",
      method: "POST",
    };
    const request = new Request(
      "https://quieter.email/api/auth/polar/webhooks",
      init
    );
    const response = await handlePolarWebhookRequest(request);
    expect(response.status).toBe(413);
    expect(request.body?.locked).toBeFalsy();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("preserves authenticated invalid-envelope errors", async () => {
    const response = await handlePolarWebhookRequest(
      signedRequest({ data: {} })
    );
    expect(response.status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("preserves method and unsigned empty-body errors", async () => {
    const get = await handlePolarWebhookRequest(
      new Request("https://quieter.email/api/auth/polar/webhooks")
    );
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const empty = await handlePolarWebhookRequest(
      new Request("https://quieter.email/api/auth/polar/webhooks", {
        method: "POST",
      })
    );
    expect(empty.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
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
          current_period_end: subscription.current_period_end,
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
    "cycled",
    "migrated",
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

  test("does not synchronize a signed subscription without billing fields", async () => {
    const response = await handlePolarWebhookRequest(
      signedRequest({
        data: { ...subscription, customer_id: undefined },
        type: "subscription.updated",
      })
    );
    expect(response.status).toBe(500);
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
