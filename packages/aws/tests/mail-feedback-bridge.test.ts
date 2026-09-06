import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { forwardMailFeedbackBatch } from "../src/mail-feedback-bridge.ts";
import { reportAwsError } from "../src/sentry.ts";

vi.mock(import("../src/sentry.ts"), () => ({
  reportAwsError: vi.fn<typeof reportAwsError>().mockResolvedValue(),
}));

const config = {
  enabled: true,
  endpoint: "https://feedback.example.test/internal/mail/feedback",
  queueArn: "arn:aws:sqs:eu-central-1:123456789012:feedback",
  region: "eu-central-1",
  schemaVersion: 1 as const,
  stage: "fixture",
  token: "a".repeat(64),
  topicArn: "arn:aws:sns:eu-central-1:123456789012:feedback",
};
const envelope = {
  Message: JSON.stringify({ eventType: "Delivery" }),
  MessageId: "event-1",
  TopicArn: config.topicArn,
  Type: "Notification",
};
const record = {
  body: JSON.stringify(envelope),
  eventSource: "aws:sqs",
  eventSourceARN: config.queueArn,
  messageId: "queue-1",
};

describe("durable feedback bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requires an exact durable receipt and defers excess batch records", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { eventId: "event-1", schemaVersion: 1, status: "retained" },
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      forwardMailFeedbackBatch(
        { Records: [record, { ...record, messageId: "queue-2" }] },
        config
      )
    ).resolves.toStrictEqual({
      batchItemFailures: [{ itemIdentifier: "queue-2" }],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toMatchObject([
      config.endpoint,
      { body: JSON.stringify(envelope), method: "POST", redirect: "error" },
    ]);
  });

  it.each(["lost", "wrong-event", "redirect", "too-large"])(
    "retries %s without reporting payloads or credentials",
    async (failure) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (failure === "lost") {
        fetch.mockRejectedValue(new Error("private payload and token"));
      } else if (failure === "redirect") {
        fetch.mockResolvedValue(
          new Response(null, {
            headers: { location: "https://other.invalid" },
            status: 307,
          })
        );
      } else if (failure === "too-large") {
        fetch.mockResolvedValue(new Response("x".repeat(1025)));
      } else {
        fetch.mockResolvedValue(
          Response.json({
            eventId: "other-event",
            schemaVersion: 1,
            status: "retained",
          })
        );
      }
      vi.stubGlobal("fetch", fetch);
      await expect(
        forwardMailFeedbackBatch({ Records: [record] }, config)
      ).resolves.toStrictEqual({
        batchItemFailures: [{ itemIdentifier: "queue-1" }],
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(reportAwsError).toHaveBeenCalledWith(
        new Error("Mail feedback forwarding failed."),
        "MailFeedbackBridge"
      );
    }
  );

  it("refuses unexpected sources before sending HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    await expect(
      forwardMailFeedbackBatch(
        {
          Records: [{ ...record, eventSourceARN: `${config.queueArn}-other` }],
        },
        config
      )
    ).resolves.toStrictEqual({
      batchItemFailures: [{ itemIdentifier: "queue-1" }],
    });
    await expect(
      forwardMailFeedbackBatch(
        {
          Records: [
            {
              ...record,
              body: JSON.stringify({
                ...envelope,
                TopicArn: `${config.topicArn}-other`,
              }),
            },
          ],
        },
        config
      )
    ).resolves.toStrictEqual({
      batchItemFailures: [{ itemIdentifier: "queue-1" }],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
