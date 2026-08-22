import type * as databaseClient from "@quieter/database/client";
import { mailbox, mailDomain } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { setMailDomainCatchAll } from "../src/mail-domain/catch-all";
import { queueRows, resetQueues } from "./helpers/fake-database";

vi.mock(import("@quieter/database/client"), async () => {
  const { createFakeDatabaseModule } = await import("./helpers/fake-database");
  // The fake implements only the query surface the tested code uses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return createFakeDatabaseModule() as unknown as typeof databaseClient;
});

const storedDomainRow = (overrides: Record<string, unknown> = {}) => ({
  domain: "example.com",
  id: "dom-1",
  mode: "send_and_receive",
  status: "verified",
  ...overrides,
});

const targetMailboxRow = (overrides: Record<string, unknown> = {}) => ({
  emailAddress: "hello@example.com",
  id: "mbx-1",
  organizationId: "org-1",
  provider: "managed",
  ...overrides,
});

describe(setMailDomainCatchAll, () => {
  beforeEach(() => {
    resetQueues();
  });

  test("rejects domains outside the active team", async () => {
    queueRows(mailDomain, []);

    await expect(
      setMailDomainCatchAll({
        domainId: "dom-1",
        mailboxId: null,
        organizationId: "org-1",
      })
    ).rejects.toThrow("Mail domain was not found in the active team.");
  });

  test("clears the whole-domain inbox without eligibility checks", async () => {
    queueRows(mailDomain, [storedDomainRow()]);
    queueRows(mailDomain, [{ id: "dom-1" }]);

    const result = await setMailDomainCatchAll({
      domainId: "dom-1",
      mailboxId: null,
      organizationId: "org-1",
    });

    expect(result).toStrictEqual({ catchAll: null });
  });

  test("claims an eligible shared inbox and returns the domain pattern", async () => {
    queueRows(mailDomain, [storedDomainRow()]);
    queueRows(mailbox, [targetMailboxRow()]);
    queueRows(mailDomain, [{ id: "dom-1" }]);

    const result = await setMailDomainCatchAll({
      domainId: "dom-1",
      mailboxId: "mbx-1",
      organizationId: "org-1",
    });

    expect(result).toStrictEqual({
      catchAll: {
        emailAddress: "hello@example.com",
        mailboxId: "mbx-1",
        pattern: "*@example.com",
      },
    });
  });

  test("keeps the current holder when another inbox already claims the domain", async () => {
    queueRows(mailDomain, [storedDomainRow()]);
    queueRows(mailbox, [targetMailboxRow({ id: "mbx-2" })]);
    queueRows(mailDomain, []);

    await expect(
      setMailDomainCatchAll({
        domainId: "dom-1",
        mailboxId: "mbx-2",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      "Another shared inbox already receives every address on example.com."
    );
  });

  test("rejects inboxes that are not managed mailboxes of the team", async () => {
    queueRows(mailDomain, [storedDomainRow()]);
    queueRows(mailbox, [
      targetMailboxRow({ organizationId: "org-other", provider: "gmail" }),
    ]);

    await expect(
      setMailDomainCatchAll({
        domainId: "dom-1",
        mailboxId: "mbx-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow("Shared inbox was not found in the active team.");
  });

  test("requires a verified receive-enabled domain to claim an inbox", async () => {
    queueRows(mailDomain, [
      storedDomainRow({ mode: "send_only", status: "verified" }),
    ]);
    queueRows(mailbox, [targetMailboxRow()]);

    await expect(
      setMailDomainCatchAll({
        domainId: "dom-1",
        mailboxId: "mbx-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      "Whole-domain inboxes require a verified domain with incoming mail enabled."
    );
  });

  test("rejects inboxes hosted on another domain", async () => {
    queueRows(mailDomain, [storedDomainRow()]);
    queueRows(mailbox, [targetMailboxRow({ emailAddress: "hello@other.com" })]);

    await expect(
      setMailDomainCatchAll({
        domainId: "dom-1",
        mailboxId: "mbx-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow("The shared inbox address must use this domain.");
  });
});
