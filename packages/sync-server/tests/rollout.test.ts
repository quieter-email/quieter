import { describe, expect, it } from "vite-plus/test";

import { isSyncClientAllowed } from "../src/rollout";

describe("sync rollout", () => {
  it("requires the server engine and independently gates the client cohort", () => {
    expect(isSyncClientAllowed("a", {})).toBeFalsy();
    expect(isSyncClientAllowed("a", { enabled: true })).toBeTruthy();
    expect(
      isSyncClientAllowed("a", { clientsEnabled: false, enabled: true })
    ).toBeFalsy();
    expect(
      isSyncClientAllowed("a", { enabled: true, users: " b, a " })
    ).toBeTruthy();
    expect(
      isSyncClientAllowed("ab", { enabled: true, users: "a,b" })
    ).toBeFalsy();
    expect(isSyncClientAllowed("a", { enabled: true, users: "," })).toBeFalsy();
  });
});
