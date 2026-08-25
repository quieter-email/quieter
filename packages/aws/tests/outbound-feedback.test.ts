import type { OrganizationMailFeedback } from "@quieter/orpc/organization-mail-delivery";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  handler,
  parseSesFeedbackNotification,
} from "../src/outbound-feedback";

// The lazy database client only parses this string; persistence itself is mocked.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://localhost:5432/quieter_test";
});

const mocks = vi.hoisted(() => ({
  recordOrganizationMailFeedback:
    vi.fn<(feedback: OrganizationMailFeedback) => Promise<void>>(),
  reportAwsError: vi.fn<(error: unknown, operation: string) => Promise<void>>(),
}));

vi.mock(import("@quieter/orpc/organization-mail-delivery"), () => ({
  recordOrganizationMailFeedback: mocks.recordOrganizationMailFeedback,
}));
vi.mock(import("../src/sentry"), () => ({
  reportAwsError: mocks.reportAwsError,
}));

mocks.recordOrganizationMailFeedback.mockResolvedValue();
mocks.reportAwsError.mockResolvedValue();

const topicArn = "arn:aws:sns:eu-central-1:123456789012:feedback";

const createEnvelope = (message: Record<string, unknown>) => ({
  Message: JSON.stringify(message),
  MessageId: "sns-event-1",
  TopicArn: topicArn,
  Type: "Notification",
});

const mail = {
  destination: ["to@example.com", "cc@example.com"],
  messageId: "ses-message-1",
  timestamp: "2026-08-14T10:00:00.000Z",
};

describe(parseSesFeedbackNotification, () => {
  test("parses send events for all envelope recipients", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({ eventType: "SEND", mail }),
        topicArn
      )
    ).toMatchObject({
      eventType: "sent",
      provider: "ses",
      providerMessageId: "ses-message-1",
      recipients: [
        { emailAddress: "to@example.com" },
        { emailAddress: "cc@example.com" },
      ],
      sourceEventId: "sns-event-1",
    });
  });

  test("parses permanent bounces with recipient diagnostics", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [
              {
                action: "failed",
                diagnosticCode: "smtp; 550 user unknown",
                emailAddress: "missing@example.com",
                status: "5.1.1",
              },
            ],
            feedbackId: "bounce-1",
            timestamp: "2026-08-14T10:01:00.000Z",
          },
          eventType: "BOUNCE",
          mail,
        }),
        topicArn
      )
    ).toMatchObject({
      eventType: "bounced",
      permanentFailure: true,
      recipients: [
        {
          diagnosticCode: "smtp; 550 user unknown",
          emailAddress: "missing@example.com",
          providerStatus: "5.1.1",
          reason: "failed",
        },
      ],
      sourceEventId: "bounce-1",
    });
  });

  test("parses complaint feedback identifiers", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({
          complaint: {
            complainedRecipients: [{ emailAddress: "to@example.com" }],
            feedbackId: "complaint-1",
            timestamp: "2026-08-14T10:02:00.000Z",
          },
          eventType: "COMPLAINT",
          mail,
        }),
        topicArn
      )
    ).toMatchObject({
      eventType: "complained",
      recipients: [{ emailAddress: "to@example.com" }],
      sourceEventId: "complaint-1",
    });
  });

  test("treats transient bounces as delays without a permanent failure", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({
          bounce: {
            bounceType: "Transient",
            bouncedRecipients: [
              {
                emailAddress: "to@example.com",
                status: "4.2.2",
              },
            ],
            feedbackId: "bounce-transient-1",
            timestamp: "2026-08-14T10:02:30.000Z",
          },
          eventType: "Bounce",
          mail,
        }),
        topicArn
      )
    ).toMatchObject({
      eventType: "delayed",
      permanentFailure: false,
      recipients: [{ emailAddress: "to@example.com" }],
    });
  });

  test("parses delivery recipient strings", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({
          delivery: {
            recipients: ["to@example.com"],
            timestamp: "2026-08-14T10:03:00.000Z",
          },
          eventType: "DELIVERY",
          mail,
        }),
        topicArn
      )
    ).toMatchObject({
      eventType: "delivered",
      recipients: [{ emailAddress: "to@example.com" }],
    });
  });

  test("parses delivery delay event names from SES", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({
          deliveryDelay: {
            delayedRecipients: [
              {
                diagnosticCode: "smtp; 451 try later",
                emailAddress: "to@example.com",
                status: "4.4.1",
              },
            ],
            timestamp: "2026-08-14T10:04:00.000Z",
          },
          eventType: "DeliveryDelay",
          mail,
        }),
        topicArn
      )
    ).toMatchObject({
      eventType: "delayed",
      permanentFailure: false,
      recipients: [
        {
          diagnosticCode: "smtp; 451 try later",
          emailAddress: "to@example.com",
          providerStatus: "4.4.1",
        },
      ],
    });
  });

  test("rejects messages from unexpected topics", () => {
    expect(() =>
      parseSesFeedbackNotification(
        createEnvelope({ eventType: "SEND", mail }),
        "arn:aws:sns:eu-central-1:123456789012:other"
      )
    ).toThrow("unexpected SNS topic");
  });

  test("ignores event types that were not requested", () => {
    expect(
      parseSesFeedbackNotification(
        createEnvelope({ eventType: "OPEN", mail }),
        topicArn
      )
    ).toBeNull();
  });
});

describe(handler, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordOrganizationMailFeedback.mockResolvedValue();
    mocks.reportAwsError.mockResolvedValue();
  });

  const snsEvent = () => ({
    Records: [{ Sns: createEnvelope({ eventType: "SEND", mail }) }],
  });

  test("persists a valid SNS delivery", async () => {
    await expect(handler(snsEvent())).resolves.toBeUndefined();

    expect(mocks.recordOrganizationMailFeedback).toHaveBeenCalledOnce();
    expect(
      mocks.recordOrganizationMailFeedback.mock.calls[0]?.[0]
    ).toMatchObject({
      eventType: "sent",
      providerMessageId: "ses-message-1",
    });
  });

  test("reports persistence failures to Sentry and rethrows unchanged", async () => {
    const failure = new Error("database unavailable");
    mocks.recordOrganizationMailFeedback.mockRejectedValue(failure);

    await expect(handler(snsEvent())).rejects.toThrow(failure);

    expect(mocks.reportAwsError).toHaveBeenCalledOnce();
    expect(mocks.reportAwsError.mock.calls[0]?.[0]).toBe(failure);
    expect(mocks.reportAwsError.mock.calls[0]?.[1]).toBe(
      "MailOutboundFeedbackProcessor"
    );
  });
});
