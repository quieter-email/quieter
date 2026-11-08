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

const snsEvent = () => ({
  Records: [{ Sns: createEnvelope({ eventType: "SEND", mail }) }],
});

describe(parseSesFeedbackNotification, () => {
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

  test("rejects messages from unexpected topics", () => {
    expect(() =>
      parseSesFeedbackNotification(
        createEnvelope({ eventType: "SEND", mail }),
        "arn:aws:sns:eu-central-1:123456789012:other"
      )
    ).toThrow("unexpected SNS topic");
  });
});

describe(handler, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordOrganizationMailFeedback.mockResolvedValue();
    mocks.reportAwsError.mockResolvedValue();
  });

  test("reports persistence failures to Sentry and rethrows unchanged", async () => {
    const failure = new Error("database unavailable");
    mocks.recordOrganizationMailFeedback.mockRejectedValue(failure);

    await expect(handler(snsEvent())).rejects.toThrow(failure);

    expect(mocks.reportAwsError).toHaveBeenCalledOnce();
    expect(mocks.reportAwsError.mock.calls[0]?.[0]).toBe(failure);
  });
});
