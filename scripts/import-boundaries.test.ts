import { describe, expect, test } from "vite-plus/test";

import { findImportBoundaryViolations } from "./import-boundaries";

const applicationPackages = new Set(["@quieter/web"]);

describe("package import boundaries", () => {
  test.each([
    ["apps/web/src/page.ts", 'await import("@quieter/" + "database");'],
    ["packages/aws/src/job.ts", 'import "../../orpc/src/server";'],
    ["apps/web/src/page.ts", 'import { db } from "@quieter/database/client";'],
    [
      "apps/web/src/page.ts",
      'const db = await import("@quieter/database/client");',
    ],
    [
      "apps/web/src/page.ts",
      'type Row = import("@quieter/database/schema").User;',
    ],
    ["apps/web/src/page.ts", 'import "@base-ui/react/button";'],
    ["apps/web/src/page.ts", 'export * from "vaul";'],
    ["apps/web/src/page.ts", 'const provider = require("@quieter/gmail");'],
    [
      "packages/ui/src/page.ts",
      'import type { Page } from "../../../apps/web/src/page";',
    ],
    ["packages/ui/src/page.ts", 'export { Page } from "@quieter/web";'],
    ["packages/aws/src/job.ts", 'await import("@quieter/orpc");'],
    [
      "apps/web/src/start.ts",
      'import { db, withRequestDatabaseClient } from "@quieter/database/client";',
    ],
    ["apps/web/src/start.ts", 'await import("@quieter/database/client");'],
  ])("rejects forbidden imports in %s: %s", (file, source) => {
    expect(
      findImportBoundaryViolations(file, source, applicationPackages)
    ).toHaveLength(1);
  });

  test.each([
    [
      "apps/web/src/start.ts",
      'import { withRequestDatabaseClient as withDatabase } from "@quieter/database/client";',
    ],
    [
      "apps/web/src/page.ts",
      'import { Button } from "@quieter/ui/button"; import type { MessageListItem } from "@quieter/mail/messages";',
    ],
    [
      "packages/aws/src/job.ts",
      'await import("@quieter/orpc/managed-mail/ingestion");',
    ],
    [
      "apps/web/src/page.ts",
      '// import "@quieter/database/client";\nconst example = "@quieter/database/client";',
    ],
  ])("accepts allowed imports in %s: %s", (file, source) => {
    expect(
      findImportBoundaryViolations(file, source, applicationPackages)
    ).toStrictEqual([]);
  });
});
