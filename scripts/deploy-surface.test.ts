import { describe, expect, test } from "vite-plus/test";

import { applyDeploySurface } from "./run-sst.ts";

describe("production deploy surfaces", () => {
  test("keeps the landing worker out of an app deploy", () => {
    expect(
      applyDeploySurface({
        args: ["deploy", "--stage", "production"],
        excludedSlotNames: ["WebReleaseA"],
        surface: "app",
      })
    ).toStrictEqual([
      "deploy",
      "--stage",
      "production",
      "--exclude",
      "WebReleaseA,Site",
    ]);
  });

  test("publishes only the landing worker for a site deploy", () => {
    expect(
      applyDeploySurface({
        args: ["deploy", "--stage", "production", "--", "--verbose"],
        excludedSlotNames: ["WebReleaseA"],
        surface: "site",
      })
    ).toStrictEqual([
      "deploy",
      "--stage",
      "production",
      "--target",
      "Site",
      "--",
      "--verbose",
    ]);
  });

  test("includes the landing worker in the one-time cutover", () => {
    expect(
      applyDeploySurface({
        args: ["diff", "--stage", "production"],
        excludedSlotNames: [],
        surface: "cutover",
      })
    ).toStrictEqual(["diff", "--stage", "production"]);
  });
});
