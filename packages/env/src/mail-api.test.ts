import { describe, expect, it } from "vite-plus/test";

import { createMailApiEnv } from "./mail-api.ts";

describe("mail API configuration", () => {
  const config = {
    acceptanceEnabled: false,
    limits: {
      global: { maxPending: 100, maxPendingBytes: 100_000_000 },
      maxQueuedAgeSeconds: 3600,
      organization: { maxPending: 10, maxPendingBytes: 10_000_000 },
    },
    organizationIds: ["fixture"],
    schemaVersion: 1,
  };

  it("defaults to disabled and requires explicit bounded cohort configuration", () => {
    expect(createMailApiEnv({})).toBeNull();
    expect(
      createMailApiEnv({ QUIETER_MAIL_API_CONFIG: JSON.stringify(config) })
    ).toStrictEqual(config);
    expect(() =>
      createMailApiEnv({
        QUIETER_MAIL_API_CONFIG: JSON.stringify({
          ...config,
          organizationIds: [],
        }),
      })
    ).toThrow("Invalid mail API configuration");
    expect(() =>
      createMailApiEnv({
        QUIETER_MAIL_API_CONFIG: JSON.stringify({
          ...config,
          limits: { ...config.limits, maxQueuedAgeSeconds: 0 },
        }),
      })
    ).toThrow("Invalid mail API configuration");
    expect(() =>
      createMailApiEnv({
        QUIETER_MAIL_API_CONFIG: "private malformed configuration",
      })
    ).toThrow("Invalid mail API configuration.");
  });
});
