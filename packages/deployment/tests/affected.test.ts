import { describe, expect, it } from "vite-plus/test";

import { identifyAffectedRuntimes } from "../src/affected.ts";
import type { WorkspacePackage } from "../src/affected.ts";
import type { RuntimeRegistration } from "../src/registry.ts";

const registry: RuntimeRegistration[] = [
  {
    entrypoint: "apps/web/src/server.ts",
    nativeReleaseBlockers: [],
    package: "web",
    service: "web",
    trigger: "http",
  },
  {
    entrypoint: "packages/mail/src/worker.ts",
    nativeReleaseBlockers: [],
    package: "mail",
    service: "sender",
    trigger: "queue",
  },
];
const packages: WorkspacePackage[] = [
  { dependencies: ["shared", "ui"], directory: "apps/web", name: "web" },
  { dependencies: ["shared"], directory: "packages/mail", name: "mail" },
  { dependencies: [], directory: "packages/shared", name: "shared" },
  { dependencies: [], directory: "packages/ui", name: "ui" },
];
const plan = (changedPaths: string[], candidatePackages = packages) =>
  identifyAffectedRuntimes({
    baselinePackages: packages,
    candidatePackages,
    changedPaths,
    registry,
  });

describe("affected runtime planning", () => {
  it("keeps dashboard changes out of mail releases", () => {
    expect(
      plan(["apps/web/src/page.tsx", "packages/ui/src/button.tsx"])
    ).toMatchObject({ affected: ["web"], runtimeOnly: true });
  });

  it("includes all consumers of shared changes", () => {
    expect(plan(["packages/shared/src/policy.ts"])).toMatchObject({
      affected: ["sender", "web"],
      runtimeOnly: true,
    });
  });

  it("retains previous dependency coverage when an import or package is removed", () => {
    const candidate = packages.map((entry) =>
      entry.name === "web" ? { ...entry, dependencies: ["ui"] } : entry
    );
    expect(
      plan(["packages/shared/src/policy.ts"], candidate).affected
    ).toStrictEqual(["sender", "web"]);
  });

  it.each(["pnpm-lock.yaml", "patches/postgres@3.4.9.patch"])(
    "invalidates all consumers and requires review for %s",
    (file) => {
      expect(plan([file])).toMatchObject({
        affected: ["sender", "web"],
        runtimeOnly: false,
        toolingPaths: [file],
      });
    }
  );

  it("keeps infrastructure changes outside runtime-only promotion", () => {
    expect(plan(["infra/mail.ts"])).toMatchObject({
      affected: ["sender", "web"],
      foundationPaths: ["infra/mail.ts"],
      runtimeOnly: false,
    });
  });

  it("does not silently skip unregistered code or missing workspace dependencies", () => {
    expect(plan(["other/runtime.ts"])).toMatchObject({
      runtimeOnly: false,
      unclassifiedPaths: ["other/runtime.ts"],
    });
    expect(() =>
      plan(
        [],
        [
          ...packages,
          {
            dependencies: [],
            directory: "packages/extra",
            name: "missing-consumer",
          },
        ].map((entry) =>
          entry.name === "mail" ? { ...entry, dependencies: ["absent"] } : entry
        )
      )
    ).toThrow("Missing workspace dependency");
  });

  it("ignores documentation without invalidating runtime versions", () => {
    expect(plan(["docs/deployment.md", "README.md"])).toMatchObject({
      affected: [],
      runtimeOnly: true,
    });
  });
});
