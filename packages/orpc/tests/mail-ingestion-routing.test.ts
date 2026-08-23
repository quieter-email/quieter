import type * as databaseClient from "@quieter/database/client";
import { mailbox, mailDomain } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { resolveInboundManagedTargetMailboxIds } from "../src/managed-mail/messages/ingestion";
import { queueRows, resetQueues } from "./helpers/fake-database";

vi.mock(import("@quieter/database/client"), async () => {
  const { createFakeDatabaseModule } = await import("./helpers/fake-database");
  // The fake implements only the query surface the tested code uses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return createFakeDatabaseModule() as unknown as typeof databaseClient;
});

describe(resolveInboundManagedTargetMailboxIds, () => {
  beforeEach(() => {
    resetQueues();
  });

  test("routes unmatched recipients to the domain catch-all inbox", async () => {
    queueRows(mailbox, [{ emailAddress: "team@example.com", id: "mbx-exact" }]);
    queueRows(mailDomain, [{ domain: "example.com", id: "mbx-catch-all" }]);

    const targetIds = await resolveInboundManagedTargetMailboxIds([
      "stranger@example.com",
      "team@example.com",
    ]);

    expect(targetIds).toStrictEqual(["mbx-exact", "mbx-catch-all"]);
  });

  test("keeps exact precedence and dedupes multiple catch-all recipients", async () => {
    queueRows(mailbox, [
      { emailAddress: "a@example.com", id: "mbx-a" },
      { emailAddress: "b@example.com", id: "mbx-b" },
    ]);
    queueRows(mailDomain, [{ domain: "example.com", id: "mbx-catch-all" }]);

    const targetIds = await resolveInboundManagedTargetMailboxIds([
      "a@example.com",
      "x@example.com",
      "b@example.com",
      "y@EXAMPLE.com",
    ]);

    expect(targetIds).toStrictEqual(["mbx-a", "mbx-b", "mbx-catch-all"]);
  });

  test("ignores syntactically invalid recipients for catch-all routing", async () => {
    queueRows(mailbox, []);

    const targetIds = await resolveInboundManagedTargetMailboxIds([
      "no-at-sign",
      "@example.com",
      "local@",
      "double@@example.com",
      "spaced local@example.com",
    ]);

    expect(targetIds).toStrictEqual([]);
  });

  test("returns no targets without a catch-all configuration", async () => {
    queueRows(mailbox, []);
    queueRows(mailDomain, []);

    const targetIds = await resolveInboundManagedTargetMailboxIds([
      "unknown@example.com",
    ]);

    expect(targetIds).toStrictEqual([]);
  });
});
