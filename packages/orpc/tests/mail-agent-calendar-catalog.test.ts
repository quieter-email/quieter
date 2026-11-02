import { ORPCError } from "@orpc/server";
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type {
  getCalendarAccountForUser,
  listCalendarAccountsForUser,
} from "../src/calendar/service";
import {
  compileAgentManifest,
  getAgentAccounts,
  loadAgentCatalog,
} from "../src/mail-agent/catalog";

const mocks = vi.hoisted(() => ({
  account: vi.fn<typeof getCalendarAccountForUser>(),
  accounts: vi.fn<typeof listCalendarAccountsForUser>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Execute the real credential ownership predicates without a live database.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/calendar/service"), async (importOriginal) => ({
  ...(await importOriginal()),
  getCalendarAccountForUser: mocks.account,
  listCalendarAccountsForUser: mocks.accounts,
}));

const specification = actionSpecificationSchema.parse({
  connectors: [{ connectionId: "mailbox-alias", referenceId: "calendar" }],
  instructions: "Read this thread and find calendar availability.",
  mailboxId: "current-mailbox",
  permissions: [
    { id: "thread", operation: "read", scope: "mailbox" },
    {
      connectorReferenceId: "calendar",
      id: "calendar-read",
      operation: "read",
      scope: "connector",
    },
  ],
  review: { assumptions: [], questions: [], summary: "Find availability." },
  sourceText: "Find availability in @[connection:mailbox-alias].",
  toolGrants: [
    {
      confirmation: "none",
      permissionId: "thread",
      toolId: "mail.read_thread",
    },
    {
      confirmation: "none",
      permissionId: "calendar-read",
      toolId: "calendar.list_events",
    },
  ],
  trigger: { kind: "manual" },
  version: 1,
});

describe("mail agent Calendar account ownership", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.accounts
      .mockReset()
      .mockResolvedValue({ accounts: [], isConfigured: true });
    mocks.account.mockReset().mockResolvedValue({
      email: "owner@example.test",
      id: "legacy-calendar",
      mailboxId: "mailbox-alias",
      name: "Owner calendar",
      status: "connected",
    });
  });

  test("lists Gmail Calendar capabilities alongside Linear accounts", async () => {
    mocks.accounts.mockResolvedValue({
      accounts: [
        {
          email: "owner@example.test",
          id: "legacy-calendar",
          mailboxId: "mailbox-alias",
          name: "Owner calendar",
          status: "connected",
        },
        {
          email: "older@example.test",
          id: "older-calendar",
          mailboxId: null,
          name: "Older calendar",
          status: "needs-mailbox",
        },
      ],
      isConfigured: true,
    });
    const accounts = await getAgentAccounts("owner");
    expect(accounts).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionId: "legacy-calendar",
          provider: "google_calendar",
          status: "connected",
        }),
        expect.objectContaining({
          connectionId: "older-calendar",
          status: "needs_reconnect",
        }),
      ])
    );
    expect(mocks.accounts).toHaveBeenCalledWith({ userId: "owner" });
    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"connectorCredential"."provider" =');
    expect(params).toContain("linear");
    expect(params).toContain("owner");
  });

  test("binds saved approvals and schemas to the reviewed alias", async () => {
    const catalog = await loadAgentCatalog({
      connectionIds: ["mailbox-alias"],
      userId: "owner",
    });
    expect(mocks.account).toHaveBeenCalledWith({
      connectionId: "mailbox-alias",
      userId: "owner",
    });
    const lookup = catalog.find(
      (tool) => tool.toolId === "calendar.list_events"
    );
    expect(lookup).toMatchObject({
      connectionId: "mailbox-alias",
      inputSchema: { properties: { connectionId: { const: "mailbox-alias" } } },
    });
    const reviewed = compileAgentManifest(specification, catalog);
    expect(reviewed.manifest).toContainEqual(
      expect.objectContaining({
        connectionId: "mailbox-alias",
        toolId: "calendar.list_events",
      })
    );

    mocks.account.mockResolvedValue({
      email: "owner@example.test",
      id: "mailbox-alias",
      mailboxId: "mailbox-alias",
      name: "Renamed calendar",
      status: "connected",
    });
    const resolved = compileAgentManifest(
      specification,
      await loadAgentCatalog({
        connectionIds: ["mailbox-alias"],
        userId: "owner",
      })
    );
    expect(resolved.digest).toBe(reviewed.digest);
  });

  test.each(["needs-mailbox", "needs-permission", "needs-reconnect"] as const)(
    "withholds Calendar tools from an account that %s",
    async (status) => {
      mocks.account.mockResolvedValue({
        email: "owner@example.test",
        id: "legacy-calendar",
        name: "Owner calendar",
        ...(status === "needs-mailbox"
          ? { mailboxId: null, status }
          : { mailboxId: "mailbox-alias", status }),
      });
      await expect(
        loadAgentCatalog({ connectionIds: ["mailbox-alias"], userId: "owner" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );

  test("rejects unavailable mentions using the acting user's authority", async () => {
    mocks.account.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(
      loadAgentCatalog({
        connectionIds: ["foreign-calendar"],
        userId: "other-owner",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.account).toHaveBeenCalledWith({
      connectionId: "foreign-calendar",
      userId: "other-owner",
    });
  });
});
