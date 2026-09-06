import { describe, expect, it } from "vite-plus/test";

import { createMailFeedbackEnv } from "./mail-feedback.ts";

const config = {
  enabled: true,
  endpoint: "https://feedback.example.test/internal/mail/feedback",
  queueArn: "arn:aws:sqs:eu-central-1:123456789012:feedback",
  schemaVersion: 1,
  stage: "fixture",
  topicArn: "arn:aws:sns:eu-central-1:123456789012:feedback",
};
const links = {
  App: { stage: "fixture" },
  MailFeedbackBridgeToken: {
    value: JSON.stringify({ stage: "fixture", token: "a".repeat(64) }),
  },
};

describe("feedback configuration", () => {
  it("accepts equivalent AWS and Worker links and defaults to disabled", () => {
    expect(createMailFeedbackEnv({})).toBeNull();
    expect(
      createMailFeedbackEnv({
        QUIETER_MAIL_FEEDBACK_CONFIG: JSON.stringify({
          ...config,
          enabled: false,
        }),
      })
    ).toBeNull();
    expect(
      createMailFeedbackEnv({
        QUIETER_MAIL_FEEDBACK_CONFIG: JSON.stringify(config),
        SST_RESOURCES_JSON: JSON.stringify(links),
      })
    ).toStrictEqual(
      createMailFeedbackEnv({
        QUIETER_MAIL_FEEDBACK_CONFIG: JSON.stringify(config),
        SST_RESOURCE_App: JSON.stringify(links.App),
        SST_RESOURCE_MailFeedbackBridgeToken: JSON.stringify(
          links.MailFeedbackBridgeToken
        ),
      })
    );
  });

  it.each([
    { endpoint: "http://feedback.example.test/internal/mail/feedback" },
    {
      endpoint:
        "https://user:private@feedback.example.test/internal/mail/feedback",
    },
    { endpoint: `${config.endpoint}?private=value` },
    { queueArn: "arn:aws:sqs:us-east-1:123456789012:feedback" },
    { stage: "other" },
  ])("rejects incompatible configuration %j", (change) => {
    expect(() =>
      createMailFeedbackEnv({
        QUIETER_MAIL_FEEDBACK_CONFIG: JSON.stringify({ ...config, ...change }),
        SST_RESOURCES_JSON: JSON.stringify(links),
      })
    ).toThrow("Invalid mail feedback configuration or linked token.");
  });
});
