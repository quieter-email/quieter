import { describe, expect, it } from "vite-plus/test";

import { createMailSenderEnv } from "./mail-sender.ts";

describe("mail sender configuration", () => {
  const config = {
    accountId: "123456789012",
    configurationSetName: "fixture",
    enabled: true,
    organizationIds: ["fixture"],
    region: "eu-central-1",
    schemaVersion: 1,
    stage: "fixture",
  };
  const linked = {
    SST_RESOURCE_App: JSON.stringify({ stage: "fixture" }),
    SST_RESOURCE_MailSenderCredentials: JSON.stringify({
      value: JSON.stringify({
        accessKeyId: "fixture",
        secretAccessKey: "fixture",
        stage: "fixture",
      }),
    }),
  };

  it("keeps disabled senders independent of credentials", () => {
    expect(createMailSenderEnv({})).toBeNull();
    expect(
      createMailSenderEnv({
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify({
          ...config,
          enabled: false,
        }),
      })
    ).toBeNull();
  });

  it("accepts only credentials linked to the current stage", () => {
    expect(
      createMailSenderEnv({
        ...linked,
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify(config),
      })
    ).toMatchObject({
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      stage: "fixture",
    });
    expect(() =>
      createMailSenderEnv({
        ...linked,
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify({
          ...config,
          stage: "other",
        }),
      })
    ).toThrow("Invalid mail sender configuration or linked credentials.");
    expect(() =>
      createMailSenderEnv({
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify(config),
      })
    ).toThrow("Invalid mail sender configuration or linked credentials.");
  });

  it("rejects invalid cohorts and never includes supplied secrets in failures", () => {
    expect(() =>
      createMailSenderEnv({
        ...linked,
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify({
          ...config,
          organizationIds: [],
        }),
      })
    ).toThrow("Invalid mail sender configuration or linked credentials.");
    expect(() =>
      createMailSenderEnv({
        ...linked,
        QUIETER_MAIL_SENDER_CONFIG: JSON.stringify(config),
        SST_RESOURCE_MailSenderCredentials: "private broken secret",
      })
    ).toThrow("Invalid mail sender configuration or linked credentials.");
  });
});
