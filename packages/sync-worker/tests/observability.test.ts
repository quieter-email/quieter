import { SyncProviderBusyError } from "@quieter/sync-server/lease";
import { describe, expect, it } from "vite-plus/test";

import { isExpectedSyncReport } from "../src/observability";

describe("sync error reporting", () => {
  it("filters provider lease contention", () => {
    expect(isExpectedSyncReport(new SyncProviderBusyError())).toBeTruthy();
  });

  it("filters provider rate limiting", () => {
    expect(
      isExpectedSyncReport(
        Object.assign(new Error("Quota exceeded"), {
          googleReason: "quotaexceeded",
          status: 429,
        })
      )
    ).toBeTruthy();
    expect(
      isExpectedSyncReport(
        Object.assign(new Error("Resource exhausted"), {
          googleStatus: "RESOURCE_EXHAUSTED",
          status: 403,
        })
      )
    ).toBeTruthy();
  });

  it("keeps unexpected failures and authorization errors", () => {
    expect(isExpectedSyncReport(new Error("Unexpected failure"))).toBeFalsy();
    expect(
      isExpectedSyncReport(
        Object.assign(new Error("Invalid credentials"), { status: 401 })
      )
    ).toBeFalsy();
  });
});
