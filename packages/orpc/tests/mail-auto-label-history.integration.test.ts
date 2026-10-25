import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  mailAutoLabelFeedback,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorReporter } from "@quieter/observability";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  loadMailAutoLabelHistory,
  loadManagedAutomationLabelHistory,
} from "../src/mail-automation/history";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "automatic label mail history on PostgreSQL and live mail metadata",
  () => {
    const userId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const managedMailboxId = crypto.randomUUID();
    const foreignMailboxId = crypto.randomUUID();
    const gmailMailboxId = crypto.randomUUID();
    const senderMessageId = crypto.randomUUID();
    const domainMessageId = crypto.randomUUID();
    const targetMessageId = crypto.randomUUID();
    const manualLabelId = crypto.randomUUID();
    const oldAutoLabelId = crypto.randomUUID();
    const newLabelId = crypto.randomUUID();
    const foreignLabelId = crypto.randomUUID();
    const deletedLabelId = crypto.randomUUID();
    const now = new Date();
    const before = new Date(now.getTime() - 86_400_000);
    const labels = [
      { id: manualLabelId, name: "Renamed projects" },
      { id: oldAutoLabelId, name: "Old automatic label" },
      { id: newLabelId, name: "New label" },
    ];
    const managedInput = {
      labels,
      mailboxId: managedMailboxId,
      message: { from: "Person <person@example.com>", id: targetMessageId },
      provider: "managed" as const,
      userId,
    };
    const gmailInput = {
      accessToken: "fixture-token",
      labels,
      mailboxId: gmailMailboxId,
      message: { from: "Person <person@example.com>", id: "gmail-target" },
      provider: "gmail" as const,
      userId,
    };
    let liveLabelIds = [manualLabelId];
    let failTransport = false;
    const queries: string[] = [];
    const reported = vi.fn<ErrorReporter>();

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Label history tests require loopback quieter_migration_test."
        );
      }
      await db.insert(user).values(
        [userId, outsiderId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Label history test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Label history test",
        slug: organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId,
        role: "member",
        userId,
      });
      await db.insert(mailbox).values([
        ...[managedMailboxId, foreignMailboxId].map((id) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          managedOwnerUserId: userId,
          organizationId,
          provider: "managed" as const,
          updatedAt: now,
        })),
        {
          accessMode: "private",
          createdAt: now,
          emailAddress: `${gmailMailboxId}@example.test`,
          id: gmailMailboxId,
          organizationId,
          ownerUserId: userId,
          provider: "gmail",
          updatedAt: now,
        },
      ]);
      await db.insert(managedMailLabel).values([
        ...labels.map((label) => ({
          createdAt: now,
          id: label.id,
          mailboxId: managedMailboxId,
          name: label.name,
          normalizedName: label.name.toLowerCase(),
          updatedAt: now,
        })),
        {
          createdAt: now,
          id: foreignLabelId,
          mailboxId: foreignMailboxId,
          name: "Private foreign label",
          normalizedName: "private foreign label",
          updatedAt: now,
        },
      ]);
      const baseMessage = {
        bodyText: "Private body must never enter labeling history",
        createdAt: now,
        direction: "inbound" as const,
        from: "Person <PERSON@EXAMPLE.COM>",
        mailboxId: managedMailboxId,
        mailboxState: "active" as const,
        sentAt: before,
        updatedAt: now,
      };
      await db.insert(managedMailMessage).values([
        {
          ...baseMessage,
          id: senderMessageId,
          providerMessageId: senderMessageId,
          subject: "Sender project",
          threadId: senderMessageId,
        },
        {
          ...baseMessage,
          from: "Coworker <other@example.com>",
          id: domainMessageId,
          providerMessageId: domainMessageId,
          subject: "Domain project",
          threadId: domainMessageId,
        },
        {
          ...baseMessage,
          id: targetMessageId,
          providerMessageId: targetMessageId,
          sentAt: now,
          threadId: targetMessageId,
        },
        ...[
          { from: "person@example.com.evil.test" },
          { from: '"person@example.com" <evil@other.test>' },
          { from: "other@sub.example.com" },
          { from: "person@lookalike-example.com" },
          { direction: "outbound" as const },
          { mailboxState: "draft" as const },
          { mailboxState: "spam" as const },
          { mailboxState: "trash" as const },
          { mailboxId: foreignMailboxId },
        ].map((override) => {
          const id = crypto.randomUUID();
          return {
            ...baseMessage,
            ...override,
            id,
            providerMessageId: id,
            sentAt: now,
            threadId: id,
          };
        }),
        ...Array.from({ length: 180 }, () => {
          const id = crypto.randomUUID();
          return {
            ...baseMessage,
            from: "unrelated@different.test",
            id,
            providerMessageId: id,
            sentAt: now,
            threadId: id,
          };
        }),
      ]);
      await db.insert(managedMailMessageLabel).values([
        {
          createdAt: now,
          id: crypto.randomUUID(),
          labelId: manualLabelId,
          mailboxId: managedMailboxId,
          messageId: senderMessageId,
          source: "manual",
        },
        {
          createdAt: now,
          id: crypto.randomUUID(),
          labelId: newLabelId,
          mailboxId: managedMailboxId,
          messageId: domainMessageId,
          source: "rule",
        },
        // A malformed cross-mailbox assignment must not expose its foreign label.
        {
          createdAt: now,
          id: crypto.randomUUID(),
          labelId: foreignLabelId,
          mailboxId: managedMailboxId,
          messageId: senderMessageId,
          source: "manual",
        },
      ]);
      await db.insert(gmailAutoLabelEvent).values([
        ...[
          { mailboxId: managedMailboxId, messageId: senderMessageId },
          { mailboxId: gmailMailboxId, messageId: "gmail-sender" },
        ].map((entry) => ({
          appliedAt: before,
          createdAt: before,
          gmailMessageId: entry.messageId,
          id: crypto.randomUUID(),
          labelIds: [oldAutoLabelId, deletedLabelId],
          mailboxId: entry.mailboxId,
          updatedAt: before,
        })),
        {
          createdAt: now,
          gmailMessageId: domainMessageId,
          id: crypto.randomUUID(),
          labelIds: [oldAutoLabelId],
          mailboxId: managedMailboxId,
          updatedAt: now,
        },
        {
          appliedAt: now,
          createdAt: now,
          gmailMessageId: domainMessageId,
          id: crypto.randomUUID(),
          labelIds: [foreignLabelId],
          mailboxId: foreignMailboxId,
          updatedAt: now,
        },
      ]);
      await db.insert(mailAutoLabelFeedback).values([
        ...[
          {
            mailboxId: managedMailboxId,
            messageId: senderMessageId,
            provider: "managed" as const,
          },
          {
            mailboxId: gmailMailboxId,
            messageId: "gmail-sender",
            provider: "gmail" as const,
          },
        ].flatMap((entry) => [
          {
            createdAt: now,
            id: crypto.randomUUID(),
            labelId: manualLabelId,
            labelName: "Stale project name",
            mailboxId: entry.mailboxId,
            provider: entry.provider,
            providerMessageId: entry.messageId,
            signal: "added" as const,
            source: "person@example.com",
            updatedAt: now,
          },
          {
            createdAt: now,
            id: crypto.randomUUID(),
            labelId: oldAutoLabelId,
            labelName: "Old automatic label",
            mailboxId: entry.mailboxId,
            provider: entry.provider,
            providerMessageId: entry.messageId,
            signal: "removed" as const,
            source: "person@example.com",
            updatedAt: now,
          },
          {
            createdAt: now,
            id: crypto.randomUUID(),
            labelId: deletedLabelId,
            labelName: "Deleted label",
            mailboxId: entry.mailboxId,
            provider: entry.provider,
            providerMessageId: entry.messageId,
            signal: "added" as const,
            updatedAt: now,
          },
        ]),
        {
          createdAt: now,
          id: crypto.randomUUID(),
          labelId: foreignLabelId,
          labelName: "Private foreign label",
          mailboxId: foreignMailboxId,
          provider: "managed",
          providerMessageId: senderMessageId,
          signal: "added",
          updatedAt: now,
        },
      ]);
    });

    beforeEach(() => {
      liveLabelIds = [manualLabelId];
      failTransport = false;
      queries.length = 0;
      reported.mockReset();
      configureErrorReporter(reported);
      vi.stubGlobal(
        "fetch",
        async (request: RequestInfo | URL, options?: RequestInit) => {
          if (failTransport) {
            throw new Error(
              "Private query person@example.com and fixture-token"
            );
          }
          const requestUrl = new URL(
            request instanceof Request ? request.url : request
          );
          if (requestUrl.pathname.endsWith("/messages")) {
            queries.push(requestUrl.searchParams.get("q") ?? "");
            return await Promise.resolve(
              Response.json({
                messages: [
                  { id: "gmail-target", threadId: "gmail-target" },
                  { id: "gmail-sender", threadId: "gmail-sender" },
                  { id: "gmail-domain", threadId: "gmail-domain" },
                  { id: "gmail-spoof", threadId: "gmail-spoof" },
                  {
                    id: "gmail-display-spoof",
                    threadId: "gmail-display-spoof",
                  },
                  { id: "gmail-sent", threadId: "gmail-sent" },
                ],
              })
            );
          }
          if (requestUrl.pathname === "/batch/gmail/v1") {
            const body = typeof options?.body === "string" ? options.body : "";
            const ids = [
              ...body.matchAll(
                /GET \/gmail\/v1\/users\/me\/messages\/(?<messageId>[^?\s]+)/gu
              ),
            ];
            const parts = ids.map((match, index) => {
              const id = match.groups?.messageId ?? "";
              let from = "person@example.com";
              if (id === "gmail-domain") {
                from = "other@example.com";
              } else if (id === "gmail-spoof") {
                from = "person@example.com.evil.test";
              } else if (id === "gmail-display-spoof") {
                from = '"person@example.com" <evil@other.test>';
              }
              return [
                "--metadata",
                "Content-Type: application/http",
                `Content-ID: <response-message-${index}>`,
                "",
                "HTTP/1.1 200 OK",
                "Content-Type: application/json",
                "",
                JSON.stringify({
                  id,
                  internalDate: String(now.getTime()),
                  labelIds:
                    id === "gmail-sent" ? ["SENT"] : ["INBOX", ...liveLabelIds],
                  payload: {
                    headers: [
                      { name: "From", value: from },
                      { name: "Subject", value: "Live project" },
                      { name: "Date", value: now.toUTCString() },
                    ],
                  },
                  threadId: id,
                }),
              ].join("\r\n");
            });
            return await Promise.resolve(
              new Response([...parts, "--metadata--", ""].join("\r\n"), {
                headers: {
                  "content-type": "multipart/mixed; boundary=metadata",
                },
              })
            );
          }
          throw new Error("Unexpected mail history transport request.");
        }
      );
    });

    afterEach(() => {
      configureErrorReporter(() => {});
      vi.unstubAllGlobals();
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, outsiderId]));
      await db.$client.end();
    });

    test("finds older matching mail across the full mailbox and separates exact senders and domains", async () => {
      const history = await loadMailAutoLabelHistory(managedInput);
      expect(
        history?.sameSender.map((message) => message.messageId)
      ).toStrictEqual([senderMessageId]);
      expect(
        history?.sameDomain.map((message) => message.messageId)
      ).toStrictEqual([domainMessageId]);
      expect(history?.sameSender[0]).toMatchObject({
        sender: "person@example.com",
        subject: "Sender project",
      });
      expect(JSON.stringify(history)).not.toContain("Private body");
    });

    test.each([
      '"Sales <launch>" <person@example.com>',
      "Sales\r\n team <person@example.com>",
    ])(
      "matches the actual managed sender in a formatted From header: %s",
      async (from) => {
        await db
          .update(managedMailMessage)
          .set({ from })
          .where(eq(managedMailMessage.id, senderMessageId));
        try {
          const history = await loadMailAutoLabelHistory(managedInput);
          expect(history?.sameSender.map((entry) => entry.messageId)).toContain(
            senderMessageId
          );
        } finally {
          await db
            .update(managedMailMessage)
            .set({ from: "Person <person@example.com>" })
            .where(eq(managedMailMessage.id, senderMessageId));
        }
      }
    );

    test("keeps current labels and manual corrections separate from stale or unapplied automatic decisions", async () => {
      const history = await loadMailAutoLabelHistory(managedInput);
      expect(history?.sameSender[0]).toMatchObject({
        currentLabels: [
          { id: manualLabelId, name: "Renamed projects", source: "manual" },
        ],
        priorAutomaticApplication: { labels: [{ id: oldAutoLabelId }] },
      });
      expect(history?.sameSender[0]?.manualCorrections).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            labelId: manualLabelId,
            labelName: "Renamed projects",
            signal: "added",
          }),
          expect.objectContaining({
            labelId: oldAutoLabelId,
            signal: "removed",
          }),
        ])
      );
      expect(history?.sameDomain[0]).toMatchObject({
        currentLabels: [{ id: newLabelId, source: "rule" }],
        manualCorrections: [],
        priorAutomaticApplication: null,
      });
      expect(JSON.stringify(history)).not.toContain(deletedLabelId);
      expect(JSON.stringify(history)).not.toContain(foreignLabelId);
      expect(JSON.stringify(history)).not.toContain("Stale project name");
    });

    test("checks same-mailbox label joins even if a supplied dictionary includes a foreign label", async () => {
      const history = await loadMailAutoLabelHistory({
        ...managedInput,
        labels: [
          ...labels,
          { id: foreignLabelId, name: "Private foreign label" },
        ],
      });
      expect(
        history?.sameSender[0]?.currentLabels.map((label) => label.id)
      ).not.toContain(foreignLabelId);
      expect(
        history?.sameSender[0]?.manualCorrections.map(
          (correction) => correction.labelId
        )
      ).not.toContain(foreignLabelId);
      expect(history?.sameDomain[0]?.priorAutomaticApplication).toBeNull();
    });

    test("refreshes live labels independently of prior automatic labels and does not invent manual corrections", async () => {
      const first = await loadMailAutoLabelHistory(gmailInput);
      expect(
        first?.sameSender.map((message) => message.messageId)
      ).toStrictEqual(["gmail-sender"]);
      expect(
        first?.sameDomain.map((message) => message.messageId)
      ).toStrictEqual(["gmail-domain"]);
      expect(first?.sameSender[0]?.currentLabels).toMatchObject([
        { id: manualLabelId, name: "Renamed projects" },
      ]);
      liveLabelIds = [newLabelId];
      const updated = await loadMailAutoLabelHistory(gmailInput);
      expect(updated?.sameSender[0]).toMatchObject({
        currentLabels: [{ id: newLabelId }],
        priorAutomaticApplication: { labels: [{ id: oldAutoLabelId }] },
      });
      expect(
        updated?.sameSender[0]?.manualCorrections.map(
          (correction) => correction.labelId
        )
      ).not.toContain(newLabelId);
      expect(updated?.sameDomain[0]).toMatchObject({
        currentLabels: [{ id: newLabelId }],
        manualCorrections: [],
        priorAutomaticApplication: null,
      });
      expect(queries).toStrictEqual(
        expect.arrayContaining([
          expect.stringContaining('from:"person@example.com"'),
          expect.stringContaining('from:"@example.com"'),
        ])
      );
      expect(reported).not.toHaveBeenCalled();
    });

    test("reports a sanitized optional failure and permits the main classifier to continue", async () => {
      failTransport = true;
      await expect(loadMailAutoLabelHistory(gmailInput)).resolves.toBeNull();
      expect(reported.mock.calls.length).toBeGreaterThan(0);
      const [report] = reported.mock.calls;
      expect(String(report?.[0])).not.toContain("person@example.com");
      expect(String(report?.[0])).not.toContain("fixture-token");
      expect(JSON.stringify(report?.[1])).not.toContain(gmailMailboxId);
    });

    test("propagates cancellation without reporting or requesting mail", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        loadMailAutoLabelHistory({ ...gmailInput, signal: controller.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(queries).toHaveLength(0);
      expect(reported).not.toHaveBeenCalled();
    });

    test("rejects users without mailbox access before provider history is read", async () => {
      await expect(
        loadMailAutoLabelHistory({ ...gmailInput, userId: outsiderId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        loadMailAutoLabelHistory({ ...managedInput, userId: outsiderId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(queries).toHaveLength(0);
    });

    test("background history reads only the connected managed target without granting a user access", async () => {
      await db
        .update(mailbox)
        .set({ accessMode: "shared", managedOwnerUserId: null })
        .where(eq(mailbox.id, managedMailboxId));
      const automationInput = {
        labels,
        mailboxId: managedMailboxId,
        message: managedInput.message,
        provider: "managed" as const,
      };
      try {
        const history =
          await loadManagedAutomationLabelHistory(automationInput);
        expect(
          history?.sameSender.map((message) => message.messageId)
        ).toContain(senderMessageId);
        expect(JSON.stringify(history)).not.toContain(foreignLabelId);
        await expect(
          loadMailAutoLabelHistory({ ...managedInput, userId: outsiderId })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          loadManagedAutomationLabelHistory({
            ...automationInput,
            mailboxId: gmailMailboxId,
          })
        ).resolves.toBeNull();
        await expect(
          loadManagedAutomationLabelHistory({
            ...automationInput,
            mailboxId: crypto.randomUUID(),
          })
        ).resolves.toBeNull();
        await db
          .update(mailbox)
          .set({ status: "needs_reconnect" })
          .where(eq(mailbox.id, managedMailboxId));
        await expect(
          loadManagedAutomationLabelHistory(automationInput)
        ).resolves.toBeNull();
      } finally {
        await db
          .update(mailbox)
          .set({
            accessMode: "private",
            managedOwnerUserId: userId,
            status: "connected",
          })
          .where(eq(mailbox.id, managedMailboxId));
      }
    });
  }
);
