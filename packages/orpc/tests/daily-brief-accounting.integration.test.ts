import { randomUUID } from "node:crypto";

import type { generateDailyBrief } from "@quieter/ai/daily-brief";
import { db } from "@quieter/database/client";
import {
  dailyBriefEdition,
  dailyBriefFeedback,
  dailyBriefSettings,
  gmailWatchState,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import type {
  getMessageWithDetails,
  listGmailAddedMessageHistoryPage,
} from "@quieter/gmail";
import type { MessageListItem } from "@quieter/mail/messages";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  configureDailyBrief,
  markDailyBriefUrgentPending,
  refreshDailyBrief,
  runDueDailyBriefs,
} from "../src/daily-brief";
import { processGmailPubSubNotification } from "../src/gmail-sync/service";
import type { queriesMailOperations } from "../src/mail/queries";
import type { processMailVerificationCode } from "../src/verification-codes";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  generate: vi.fn<typeof generateDailyBrief>(),
  gmailMessage: vi.fn<typeof getMessageWithDetails>(),
  history: vi.fn<typeof listGmailAddedMessageHistoryPage>(),
  page: vi.fn<(typeof queriesMailOperations)["listThreads"]>(),
}));
const received = (id: string): MessageListItem => ({
  bodyText: "A routine update that requires no urgent action.",
  id,
  labelIds: ["INBOX"],
  receivedAt: new Date(Date.now() + 60_000).toISOString(),
  subject: "Routine update",
  threadId: `thread-${id}`,
});
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, DATABASE_URL: state.databaseUrl },
  };
});
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));
vi.mock(import("../src/ai-memory"), async (original) => ({
  ...(await original()),
  loadAiAgentContext: vi
    .fn<() => Promise<{ instructions: null; memory: null }>>()
    .mockResolvedValue({ instructions: null, memory: null }),
  loadAiAgentMemoryCandidates: vi.fn<() => Promise<[]>>().mockResolvedValue([]),
}));
vi.mock(import("@quieter/ai/daily-brief"), async (original) => ({
  ...(await original()),
  generateDailyBrief: state.generate,
}));
vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getMessageWithDetails: state.gmailMessage,
  listGmailAddedMessageHistoryPage: state.history,
}));
vi.mock(import("../src/gmail-mailbox-access"), async (original) => ({
  ...(await original()),
  runAuthorizedGmailMailbox: async <Value>(
    _input: { mailboxId: string; userId: string },
    runner: (accessToken: string) => Promise<Value>
  ): Promise<Value> => await runner("fixture-token"),
}));
vi.mock(import("../src/verification-codes"), async (original) => ({
  ...(await original()),
  processMailVerificationCode: async ({
    loadMessage,
  }: Parameters<typeof processMailVerificationCode>[0]) => {
    await loadMessage();
  },
}));
vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      listThreads: state.page,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "Daily Brief persisted accounting",
  () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const mailboxId = randomUUID();
    const context = { userId };
    const input = { mailboxId };
    let settingsId = "";
    let created = false;

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Accounting integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Daily Brief accounting",
        updatedAt: now,
      });
      created = true;
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Daily Brief accounting",
        slug: organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId,
      });
      await db.insert(mailbox).values({
        accessMode: "private",
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        managedOwnerUserId: userId,
        organizationId,
        provider: "managed",
        status: "connected",
        updatedAt: now,
      });
    });

    beforeEach(async () => {
      state.generate.mockReset().mockResolvedValue([]);
      state.page.mockReset().mockResolvedValue({ messages: [] });
      await db
        .delete(dailyBriefSettings)
        .where(eq(dailyBriefSettings.mailboxId, mailboxId));
      await configureDailyBrief({
        context,
        input: {
          ...input,
          enabled: true,
          localTime: "06:00",
          scheduleEnabled: false,
          timeZone: "Pacific/Auckland",
        },
      });
      await refreshDailyBrief({ context, input });
      const [settings] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.mailboxId, mailboxId));
      settingsId = settings.id;
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
    });

    afterAll(async () => {
      if (!created) {
        return;
      }
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
    });

    test("does not evaluate already considered non-urgent mail again", async () => {
      state.page.mockResolvedValue({ messages: [received("routine")] });
      await markDailyBriefUrgentPending(input);
      await runDueDailyBriefs({ limit: 1 });
      const [first] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      const [edition] = await db
        .select()
        .from(dailyBriefEdition)
        .where(eq(dailyBriefEdition.id, first.editionId ?? ""));
      expect(edition.seenUrgentMessageIds).toContain("routine");
      expect(first.generationsToday).toBe(1);
      state.page.mockResolvedValue({
        messages: [received("routine"), received("fresh")],
      });
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
      await markDailyBriefUrgentPending(input);
      await runDueDailyBriefs({ limit: 1 });
      const evaluated = state.generate.mock.calls.at(-1)?.[0].candidates ?? [];
      expect(
        evaluated.some((candidate) => candidate.messageId === "fresh")
      ).toBeTruthy();
      expect(
        evaluated.some((candidate) => candidate.messageId === "routine")
      ).toBeFalsy();
    });

    test("retains older suppressions and preferences after more recent feedback", async () => {
      const older = new Date(Date.now() - 86_400_000);
      const preference = "Prioritize personal requests over automated updates.";
      await db.insert(dailyBriefFeedback).values([
        ...(["dismiss", "not_important", "defer"] as const).map((action) => ({
          action,
          createdAt: older,
          deferUntil: action === "defer" ? new Date(Date.now() + 60_000) : null,
          id: randomUUID(),
          itemId: `older-${action}`,
          preference: action === "not_important" ? preference : null,
          settingsId,
          sourceMessageIds: [`older-${action}`],
          updatedAt: older,
        })),
        ...Array.from({ length: 240 }, (_, index) => ({
          action: "dismiss" as const,
          createdAt: new Date(),
          id: randomUUID(),
          itemId: `later-${index}`,
          settingsId,
          sourceMessageIds: [`later-${index}`],
          updatedAt: new Date(),
        })),
      ]);
      state.page.mockResolvedValue({
        messages: [
          received("older-dismiss"),
          received("older-not_important"),
          received("older-defer"),
          received("fresh"),
        ],
      });
      await refreshDailyBrief({ context, input });
      const evaluated = state.generate.mock.calls.at(-1)?.[0];
      expect(
        evaluated?.candidates.some(
          (candidate) => candidate.messageId === "fresh"
        )
      ).toBeTruthy();
      expect(
        evaluated?.candidates.some((candidate) =>
          candidate.messageId.startsWith("older-")
        )
      ).toBeFalsy();
      expect(evaluated?.preferences).toContain(preference);
      await db
        .update(dailyBriefFeedback)
        .set({ deferUntil: older })
        .where(eq(dailyBriefFeedback.itemId, "older-defer"));
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
      await refreshDailyBrief({ context, input });
      expect(
        state.generate.mock.calls
          .at(-1)?.[0]
          .candidates.some((candidate) => candidate.messageId === "older-defer")
      ).toBeTruthy();
    });

    test("only schedules urgent Gmail work when history loads eligible inbox mail", async () => {
      const gmailMailboxId = randomUUID();
      const emailAddress = `${gmailMailboxId}@example.test`;
      const now = new Date();
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress,
        id: gmailMailboxId,
        organizationId,
        ownerUserId: userId,
        provider: "gmail",
        status: "connected",
        updatedAt: now,
      });
      await db.insert(dailyBriefSettings).values({
        createdAt: now,
        editionId: "existing-edition",
        enabled: true,
        id: randomUUID(),
        mailboxId: gmailMailboxId,
        updatedAt: now,
        userId,
      });
      await db.insert(gmailWatchState).values({
        createdAt: now,
        historyId: "1",
        mailboxId: gmailMailboxId,
        updatedAt: now,
      });
      state.gmailMessage.mockImplementation(async (_token, id) => {
        if (id === "deleted") {
          throw Object.assign(new Error("Deleted"), { status: 404 });
        }
        const message = received(id);
        if (id === "archived") {
          message.labelIds = [];
        } else if (id !== "eligible") {
          message.labelIds = ["INBOX", id];
        }
        return await Promise.resolve(message);
      });
      state.history.mockResolvedValue({
        hasMore: false,
        historyExpired: false,
        historyId: "2",
        messageIds: ["SENT", "DRAFT", "SPAM", "TRASH", "archived", "deleted"],
      });
      await processGmailPubSubNotification({
        emailAddress,
        historyId: "2",
        pubSubMessageId: randomUUID(),
      });
      const [ignored] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.mailboxId, gmailMailboxId));
      expect(ignored.urgentPending).toBeFalsy();
      state.history.mockResolvedValue({
        hasMore: false,
        historyExpired: false,
        historyId: "3",
        messageIds: ["eligible", "SENT"],
      });
      await processGmailPubSubNotification({
        emailAddress,
        historyId: "3",
        pubSubMessageId: randomUUID(),
      });
      const [pending] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.mailboxId, gmailMailboxId));
      expect(pending.urgentPending).toBeTruthy();
      await db.delete(mailbox).where(eq(mailbox.id, gmailMailboxId));
    });

    test("retains unevaluated mail after failure for a later retry", async () => {
      state.page.mockResolvedValue({ messages: [received("retry")] });
      state.generate.mockRejectedValueOnce(
        new Error("Controlled model failure")
      );
      await markDailyBriefUrgentPending(input);
      await runDueDailyBriefs({ limit: 1 });
      const [failed] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      const [edition] = await db
        .select()
        .from(dailyBriefEdition)
        .where(eq(dailyBriefEdition.id, failed.editionId ?? ""));
      expect(edition.seenUrgentMessageIds ?? []).not.toContain("retry");
      expect(failed.urgentPending).toBeTruthy();
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
      await runDueDailyBriefs({ limit: 1 });
      const retried = state.generate.mock.calls.at(-1)?.[0].candidates ?? [];
      expect(
        retried.some((candidate) => candidate.messageId === "retry")
      ).toBeTruthy();
    });

    test("keeps manual and due full editions available after the urgent allowance is exhausted", async () => {
      await db
        .update(dailyBriefSettings)
        .set({
          nextRunAt: new Date(Date.now() - 60_000),
          scheduleEnabled: true,
          urgentGenerationsToday: 1000,
          urgentPending: true,
        })
        .where(eq(dailyBriefSettings.id, settingsId));
      const scheduled = await runDueDailyBriefs({ limit: 1 });
      expect(scheduled.processed).toBeGreaterThan(0);
      const [afterSchedule] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      expect(afterSchedule.generationsToday).toBeGreaterThan(1);
      expect(afterSchedule.urgentGenerationsToday).toBe(1000);
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
      const manual = await refreshDailyBrief({ context, input });
      expect(manual.edition).not.toBeNull();
    });

    test("keeps urgent evaluation available when only the full-edition allowance is exhausted", async () => {
      await db
        .update(dailyBriefSettings)
        .set({
          generationsToday: 1000,
          urgentGenerationsToday: 0,
          urgentPending: true,
        })
        .where(eq(dailyBriefSettings.id, settingsId));
      const urgent = await runDueDailyBriefs({ limit: 1 });
      expect(urgent.processed).toBeGreaterThan(0);
      const [after] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      expect(after.generationsToday).toBe(1000);
      expect(after.urgentGenerationsToday).toBeGreaterThan(0);
    });

    test("resets both allowances atomically after the UTC date changes", async () => {
      await db
        .update(dailyBriefSettings)
        .set({
          generationDay: new Date(Date.now() - 86_400_000)
            .toISOString()
            .slice(0, 10),
          generationsToday: 1000,
          urgentGenerationsToday: 1000,
          urgentPending: true,
        })
        .where(eq(dailyBriefSettings.id, settingsId));
      await Promise.all([
        runDueDailyBriefs({ limit: 1 }),
        runDueDailyBriefs({ limit: 1 }),
      ]);
      const [after] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      expect(after.generationsToday).toBe(0);
      expect(after.urgentGenerationsToday).toBe(1);
      await db
        .update(dailyBriefSettings)
        .set({ lastAttemptAt: null })
        .where(eq(dailyBriefSettings.id, settingsId));
      await refreshDailyBrief({ context, input });
      const [full] = await db
        .select()
        .from(dailyBriefSettings)
        .where(eq(dailyBriefSettings.id, settingsId));
      expect(full.generationsToday).toBeGreaterThan(0);
      expect(full.urgentGenerationsToday).toBe(after.urgentGenerationsToday);
    });
  }
);
