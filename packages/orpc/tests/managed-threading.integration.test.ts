import { db } from "@quieter/database/client";
import {
  managedMailMessage,
  mailbox,
  mailDomain,
  organization,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { captureManagedMessageMemory } from "../src/ai-memory-capture";
import type { enqueueMailAgentMessage } from "../src/mail-agent/inbox";
import type {
  ensureMailImportanceWork,
  processPendingMailImportance,
} from "../src/mail-importance";
import type { publishMailUpdate } from "../src/mail-updates";
import type {
  getManagedAutomationOwner,
  loadManagedAutomationMessage,
  processManagedMailAutomation,
} from "../src/managed-mail/automation";
import type { inheritManagedThreadLabels } from "../src/managed-mail/labels/repository";
import { recordInboundManagedMessage } from "../src/managed-mail/messages/ingestion";
import type { applyManagedRulesToMessage } from "../src/managed-mail/rules/evaluator";
import type {
  processMailVerificationCode,
  reportPendingMailboxVerificationCodeUsage,
} from "../src/verification-codes";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
const fixtures = vi.hoisted(() => ({
  enqueue: vi.fn<typeof enqueueMailAgentMessage>(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, DATABASE_URL: state.databaseUrl },
  };
});
vi.mock(import("../src/mail-agent/inbox"), () => ({
  enqueueMailAgentMessage: fixtures.enqueue,
}));
vi.mock(import("../src/ai-memory-capture"), () => ({
  captureManagedMessageMemory: vi.fn<typeof captureManagedMessageMemory>(),
}));
vi.mock(import("../src/mail-importance"), () => ({
  ensureMailImportanceWork: vi.fn<typeof ensureMailImportanceWork>(),
  processPendingMailImportance: vi.fn<typeof processPendingMailImportance>(),
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: vi.fn<typeof publishMailUpdate>(),
}));
vi.mock(import("../src/verification-codes"), () => ({
  processMailVerificationCode: vi.fn<typeof processMailVerificationCode>(),
  reportPendingMailboxVerificationCodeUsage:
    vi.fn<typeof reportPendingMailboxVerificationCodeUsage>(),
}));
vi.mock(import("../src/managed-mail/automation"), () => ({
  getManagedAutomationOwner: vi.fn<typeof getManagedAutomationOwner>(),
  loadManagedAutomationMessage: vi.fn<typeof loadManagedAutomationMessage>(),
  processManagedMailAutomation: vi.fn<typeof processManagedMailAutomation>(),
}));
vi.mock(import("../src/managed-mail/labels/repository"), () => ({
  inheritManagedThreadLabels: vi.fn<typeof inheritManagedThreadLabels>(),
}));
vi.mock(import("../src/managed-mail/rules/evaluator"), () => ({
  applyManagedRulesToMessage: vi
    .fn<typeof applyManagedRulesToMessage>()
    .mockResolvedValue({ error: null, matched: false }),
}));

describe.skipIf(state.databaseUrl === undefined)(
  "inbound threading on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const mailboxIds = [crypto.randomUUID(), crypto.randomUUID()];
    const domain = `${organizationId}.example.test`;
    const now = new Date();

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Threading tests require disposable loopback quieter_migration_test."
        );
      }
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Threading fixture",
        slug: organizationId,
      });
      await db.insert(mailbox).values(
        mailboxIds.map((id) => ({
          createdAt: now,
          emailAddress: `${id}@${domain}`,
          id,
          organizationId,
          provider: "managed" as const,
          updatedAt: now,
        }))
      );
      await db.insert(mailDomain).values({
        createdAt: now,
        domain,
        id: crypto.randomUUID(),
        mailFromDomain: `mail.${domain}`,
        mode: "send_and_receive",
        organizationId,
        requiredDnsRecords: [],
        status: "verified",
        updatedAt: now,
      });
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.$client.end();
    });

    const ingest = async (headers: string[], targetIds = mailboxIds) => {
      const providerMessageId = crypto.randomUUID();
      const rawMessage = [
        "From: sender@example.com",
        ...headers,
        "Content-Type: text/plain",
        "",
        "Full body preserved",
      ].join("\r\n");
      await recordInboundManagedMessage({
        providerMessageId,
        rawMessage: Buffer.from(rawMessage),
        rawSizeBytes: Buffer.byteLength(rawMessage),
        receivedAt: now,
        recipients: targetIds.map((id) => `${id}@${domain}`),
        s3Bucket: "synthetic",
        s3Key: providerMessageId,
      });
      return await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.providerMessageId, providerMessageId));
    };

    test("joins the newest matching message in each mailbox and preserves decoded fields", async () => {
      const parentId = `<${crypto.randomUUID()}@example.com>`;
      const rootId = `<${crypto.randomUUID()}@example.com>`;
      const roots = await ingest([
        `Message-ID: ${rootId}`,
        "Date: Thu, 1 Oct 2026 00:00:00 +0000",
      ]);
      const parents = await ingest([
        `Message-ID: ${parentId}`,
        "Date: Fri, 2 Oct 2026 00:00:00 +0000",
      ]);
      const references = `${rootId} ${parentId}`;
      const replies = await ingest([
        `References: =?UTF-8?B?${Buffer.from(references).toString("base64")}?=`,
        `In-Reply-To: ${rootId}`,
      ]);
      expect(replies).toHaveLength(2);
      for (const reply of replies) {
        expect(reply.threadId).toBe(
          parents.find((parent) => parent.mailboxId === reply.mailboxId)
            ?.threadId
        );
        expect(reply.threadId).not.toBe(
          roots.find((root) => root.mailboxId === reply.mailboxId)?.threadId
        );
        expect(reply.references).toBe(references);
        expect(reply.bodyText).toBe("Full body preserved");
      }
      expect(replies[0]?.threadId).not.toBe(replies[1]?.threadId);
    });

    test("finds a parent at the end of the maximum reference chain", async () => {
      const parentId = `<${crypto.randomUUID()}@example.com>`;
      const parents = await ingest([`Message-ID: ${parentId}`]);
      const references = [
        ...Array.from({ length: 999 }, (_, index) => `<${index}@example.com>`),
        parentId,
      ];
      const replies = await ingest([`References: ${references.join(" ")}`]);
      expect(replies).toHaveLength(2);
      for (const reply of replies) {
        expect(reply.threadId).toBe(
          parents.find((parent) => parent.mailboxId === reply.mailboxId)
            ?.threadId
        );
      }
    });

    test("keeps In-Reply-To when References exceeds limits and stores complete metadata", async () => {
      const parentId = `<${crypto.randomUUID()}@example.com>`;
      const parents = await ingest([`Message-ID: ${parentId}`]);
      for (const references of [
        "<".repeat(60_000),
        "<x>".repeat(10_000),
        "<".repeat(70_000),
      ]) {
        const replies = await ingest([
          `In-Reply-To: ${parentId}`,
          `References: ${references}`,
        ]);
        expect(replies).toHaveLength(2);
        for (const reply of replies) {
          expect(reply.threadId).toBe(
            parents.find((parent) => parent.mailboxId === reply.mailboxId)
              ?.threadId
          );
          expect(reply.references).toBe(references);
          expect(reply.headers).toContainEqual({
            name: "References",
            value: references,
          });
          expect(reply.bodyText).toBe("Full body preserved");
        }
      }
    });

    test("retains deterministic first-reference fallback and isolates foreign references", async () => {
      const parentId = `<${crypto.randomUUID()}@example.com>`;
      const rootId = `<${crypto.randomUUID()}@example.com>`;
      const [firstMailbox] = mailboxIds;
      const parents = await ingest(
        [`Message-ID: ${parentId}`],
        firstMailbox ? [firstMailbox] : []
      );
      const first = await ingest([
        `In-Reply-To: ${parentId}`,
        `References: ${rootId}`,
      ]);
      const second = await ingest([
        `In-Reply-To: ${parentId}`,
        `References: ${rootId} <other@example.com>`,
      ]);
      expect(first).toHaveLength(2);
      for (const reply of first) {
        expect(reply.threadId).toBe(
          second.find((other) => other.mailboxId === reply.mailboxId)?.threadId
        );
      }
      expect(
        first.find((reply) => reply.mailboxId === firstMailbox)?.threadId
      ).toBe(parents[0]?.threadId);
      expect(
        first.find((reply) => reply.mailboxId !== firstMailbox)?.threadId
      ).not.toBe(parents[0]?.threadId);
      const withoutReferences = await ingest(["References: <<invalid>>"]);
      const otherWithoutReferences = await ingest([
        "In-Reply-To: ",
        "References: <> <<invalid>>",
      ]);
      expect(withoutReferences[0]?.threadId).not.toBe(
        otherWithoutReferences[0]?.threadId
      );
    });
  }
);
