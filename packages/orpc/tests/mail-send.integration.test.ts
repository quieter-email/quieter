import { setTimeout as delay } from "node:timers/promises";

/* oxlint-disable vitest/no-conditional-expect -- Each parameterized delivery failure has a different recovery sequence. */
import {
  SESv2Client,
  SESv2ServiceException,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { reserveOrganizationMailSend } from "@quieter/billing/mail-send-reservation";
import type { ingestPolarEvents } from "@quieter/billing/polar";
import { db } from "@quieter/database/client";
import {
  billingCreditUsageEvent,
  mailbox,
  mailboxGrant,
  mailObjectCleanup,
  managedMailAttachment,
  managedMailMessage,
  managedMailRuleRun,
  member,
  organization,
  organizationMailSendIdempotency,
  organizationMailUsageSettings,
  user,
  userAiContextEvent,
} from "@quieter/database/schema";
import type {
  MailboxGrantRole,
  MailSendSnapshot,
} from "@quieter/database/schema";
import { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { managedMailboxRuleDefinitionSchema } from "@quieter/mail/mailbox-organization";
import {
  parseRawMailAttachments,
  assertRawMailSender,
} from "@quieter/mail/raw-message";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { recordAiGeneratedMailBody } from "../src/ai-mail-authorship";
import { recoverMailSends, sendPreparedMail } from "../src/mail-send";
import {
  cleanupMailObjects,
  storeRawMailObject,
} from "../src/managed-mail/messages/raw-object-lifecycle";
import { sendManagedMailboxMessage } from "../src/managed-mail/messages/send";
import { processManagedRuleBackfills } from "../src/managed-mail/rules/backfill";
import { applyManagedRulesToMessage } from "../src/managed-mail/rules/evaluator";
import {
  createManagedRule,
  startManagedRuleBackfill,
  getManagedRuleBackfill,
  cancelManagedRuleBackfill,
  updateManagedRule,
} from "../src/managed-mail/rules/service";
import {
  getOrganizationApiMailboxId,
  listOrganizationApiMailMessages,
} from "../src/organization-api-mail";
import { sendOrganizationMailMessage } from "../src/organization-mail";
import {
  recordOrganizationMailFeedback,
  suppressOrganizationMailRecipient,
  unsuppressOrganizationMailRecipient,
} from "../src/organization-mail-delivery";
import { OrganizationMailSendError } from "../src/organization-mail-policy";
import type { assertOrganizationOwnsVerifiedSenderDomain } from "../src/organization-mail-policy";
import { hashRequest } from "../src/request-hash";

const state = vi.hoisted(() => ({
  beforeRead: undefined as (() => Promise<void>) | undefined,
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  failMemoryCapture: false,
  failProjection: false,
  objects: new Map<string, Uint8Array<ArrayBuffer>>(),
  send: vi.fn<(...args: unknown[]) => Promise<{ MessageId: string }>>(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      AWS_REGION: "eu-central-1",
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});
vi.mock(import("@quieter/billing/entitlements"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    // oxlint-disable-next-line eslint/require-await -- Match the asynchronous entitlement boundary without external billing calls.
    getOrganizationBillingEntitlement: async ({ organizationId }) => ({
      account: {
        creditAmountCents: 0,
        currentPeriodEnd: new Date("2100-01-01"),
        currentPeriodStart: new Date("2020-01-01"),
        externalCustomerId: organizationId,
        organizationId,
        product: "managed" as const,
      },
      hasAccess: true,
      hasUnlimitedAccess: false,
      product: "managed" as const,
    }),
  };
});
vi.mock(import("@quieter/billing/polar"), () => ({
  ingestPolarEvents: vi.fn<typeof ingestPolarEvents>().mockResolvedValue(),
}));
vi.mock(import("../src/local-managed-mail"), () => ({
  assertLocalMailSend: vi.fn<() => void>(),
}));
vi.mock(import("../src/organization-mail-policy"), async (original) => ({
  ...(await original()),
  assertOrganizationOwnsVerifiedSenderDomain: vi
    .fn<typeof assertOrganizationOwnsVerifiedSenderDomain>()
    .mockResolvedValue("example.com"),
}));
vi.mock(import("../src/managed-mail/messages/outbound"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    recordOutboundManagedMessageForSender: async (input) => {
      if (state.failProjection) {
        throw new Error("Projection unavailable");
      }
      return await actual.recordOutboundManagedMessageForSender(input);
    },
  };
});
vi.mock(import("../src/ai-memory"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    recordAiMemoryEvent: async (input) => {
      if (state.failMemoryCapture) {
        throw new Error("Memory persistence unavailable");
      }
      return await actual.recordAiMemoryEvent(input);
    },
  };
});
vi.mock(
  import("../src/managed-mail/messages/raw-object"),
  async (original) => ({
    ...(await original()),
    // oxlint-disable-next-line eslint/require-await -- Match the storage contract.
    deleteRawMailObject: async (object) => {
      state.objects.delete(object.key);
    },
    readRawMailObject: async (record) => {
      await state.beforeRead?.();
      const raw = state.objects.get(record.rawObjectKey ?? "");
      if (raw === undefined) {
        throw new Error("Object not found");
      }
      return raw;
    },
    // oxlint-disable-next-line eslint/require-await -- Match the storage contract.
    writeRawMailObject: async (object, raw) => {
      state.objects.set(object.key, new Uint8Array(raw));
    },
  })
);

describe.skipIf(state.databaseUrl === undefined)(
  "durable mail sends on PostgreSQL",
  () => {
    const organizationIds: string[] = [];
    const userIds: string[] = [];
    let organizationId = "";
    let mailboxId = "";
    let request: Parameters<typeof sendPreparedMail>[0];
    beforeAll(() => {
      // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- The SDK's final overload is callback-based; this code uses its Promise overload.
      vi.spyOn(SESv2Client.prototype, "send").mockImplementation(state.send);
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Send integration tests require loopback quieter_migration_test."
        );
      }
    });
    beforeEach(async () => {
      organizationId = crypto.randomUUID();
      mailboxId = crypto.randomUUID();
      organizationIds.push(organizationId);
      state.send
        .mockReset()
        .mockResolvedValue({ MessageId: crypto.randomUUID() });
      state.beforeRead = undefined;
      state.failProjection = false;
      state.failMemoryCapture = false;
      const now = new Date();
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Send test",
        slug: organizationId,
      });
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${mailboxId}@example.com`,
        id: mailboxId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(organizationMailUsageSettings).values({
        createdAt: now,

        monthlyOverageLimitMicroCents: 20_000,
        organizationId,
        overageEnabled: true,
        updatedAt: now,
      });
      const snapshot: MailSendSnapshot = {
        attachments: [],
        bcc: [],
        bodyText: "Hello",
        cc: [],
        headers: [],
        kind: "mailbox",
        mailboxId,
        rawSizeBytes: 5,
        replyTo: [],
        sender: `${mailboxId}@example.com`,
        sentAt: now.toISOString(),
        subject: "Hello",
        tags: [],
        to: ["recipient@example.com"],
      };
      const id = crypto.randomUUID();
      request = {
        id,
        idempotencyKey: id,
        messageHeaderId: `<${id}@example.com>`,
        organizationId,
        raw: `From: ${snapshot.sender}\r\nSubject: Hello\r\n\r\nHello`,
        requestHash: hashRequest(snapshot),
        snapshot,
      };
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, organizationIds));
      if (userIds.length > 0) {
        await db.delete(user).where(inArray(user.id, userIds));
      }
      if (state.objects.size > 0) {
        await db
          .delete(mailObjectCleanup)
          .where(inArray(mailObjectCleanup.key, [...state.objects.keys()]));
      }
      await db.$client.end();
    });

    test("does not submit stored MIME with a different sender identity", async () => {
      request.raw = "From: victim@victim.example\r\n\r\nHello";
      await expect(sendPreparedMail(request)).rejects.toThrow(/sender/iu);
      expect(state.send).not.toHaveBeenCalled();
    });

    test("submits raw MIME and provider identity for the same sender", async () => {
      await sendPreparedMail(request);
      const command = state.send.mock.calls[0]?.[0];
      if (!(command instanceof SendEmailCommand)) {
        throw new Error("No delivery command was submitted.");
      }
      const raw = command.input.Content?.Raw?.Data;
      expect(command?.input.FromEmailAddress).toBe(request.snapshot.sender);
      expect(raw).toBeDefined();
      await expect(
        assertRawMailSender(raw ?? new Uint8Array(), request.snapshot.sender)
      ).resolves.toBe(command?.input.FromEmailAddress);
    });

    const createMailboxActor = async ({
      role = "manager",
    }: { role?: MailboxGrantRole } = {}) => {
      const now = new Date();
      const userId = crypto.randomUUID();
      userIds.push(userId);
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: "Mail sender",
        updatedAt: now,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId,
        role: "member",
        userId,
      });
      await db.insert(mailboxGrant).values({
        createdAt: now,
        id: crypto.randomUUID(),
        mailboxId,
        role,
        updatedAt: now,
        userId,
      });
      return userId;
    };

    test.each(["to", "cc", "bcc"] as const)(
      "a manual suppression committed during preparation blocks %s dispatch",
      async (recipientField) => {
        request.snapshot.to = [];
        request.snapshot[recipientField] = [
          "Recipient <Recipient@Example.com>",
        ];
        request.requestHash = hashRequest(request.snapshot);
        const actorUserId = await createMailboxActor();
        state.beforeRead = async () => {
          await suppressOrganizationMailRecipient({
            actorUserId,
            organizationId,
            recipient: "recipient@example.com",
          });
        };
        await expect(sendPreparedMail(request)).rejects.toThrow(
          /cannot receive mail/u
        );
        expect(state.send).not.toHaveBeenCalled();
        const [operation] = await db
          .select()
          .from(organizationMailSendIdempotency)
          .where(eq(organizationMailSendIdempotency.id, request.id));
        expect(operation?.status).toBe("rejected");
        state.beforeRead = undefined;
        await unsuppressOrganizationMailRecipient({
          actorUserId,
          organizationId,
          recipient: "recipient@example.com",
        });
        await sendPreparedMail(request);
        await sendPreparedMail(request);
        expect(state.send).toHaveBeenCalledOnce();
      }
    );

    test.each(["complained", "unsubscribed", "bounced"] as const)(
      "%s suppression commits on an independent connection before the send claim",
      async (eventType) => {
        const connection = postgres(state.databaseUrl ?? "", { max: 1 });
        const { messageId: providerMessageId } =
          await sendPreparedMail(request);
        if (providerMessageId === null || providerMessageId === undefined) {
          throw new Error("Missing accepted message ID");
        }
        request = {
          ...request,
          id: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        };
        state.send.mockClear();
        await db
          .update(organizationMailUsageSettings)
          .set({ monthlyOverageLimitMicroCents: 100_000 })
          .where(
            eq(organizationMailUsageSettings.organizationId, organizationId)
          );
        try {
          state.beforeRead = async () => {
            const { feedback: completedFeedback } = await connection.begin(
              async (transaction) => {
                await transaction`select id from organization where id = ${organizationId} for update`;
                const feedback = recordOrganizationMailFeedback({
                  eventType,
                  occurredAt: new Date(),
                  permanentFailure: eventType === "bounced",
                  provider: "ses",
                  providerMessageId,
                  recipients: [{ emailAddress: "Recipient@Example.com" }],
                  sourceEventId: crypto.randomUUID(),
                });
                for (let attempt = 0; attempt < 100; attempt += 1) {
                  const waiting = await transaction`
                select pid from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock'
                  and pid <> pg_backend_pid()`;
                  if (waiting.length > 0) {
                    return { feedback };
                  }
                  await delay(10);
                }
                throw new Error(
                  "Feedback did not wait for the independent policy lock"
                );
              }
            );
            await completedFeedback;
          };
          await expect(sendPreparedMail(request)).rejects.toThrow(
            /cannot receive mail/u
          );
          expect(state.send).not.toHaveBeenCalled();
        } finally {
          await connection.end();
        }
      }
    );

    test("the claim waits for a suppression committing on an independent connection", async () => {
      const connection = postgres(state.databaseUrl ?? "", { max: 1 });
      const reading = Promise.withResolvers<unknown>();
      const resume = Promise.withResolvers<unknown>();
      state.beforeRead = async () => {
        reading.resolve(null);
        await resume.promise;
      };
      const sending = (async () => {
        try {
          await sendPreparedMail(request);
          return null;
        } catch (error) {
          return error;
        }
      })();
      try {
        await reading.promise;
        await connection.begin(async (transaction) => {
          await transaction`select id from organization where id = ${organizationId} for update`;
          resume.resolve(null);
          let waiting = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const locks = await transaction`
              select pid from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'
                and pid <> pg_backend_pid()`;
            if (locks.length > 0) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          expect(waiting).toBeTruthy();
          await transaction`
            insert into "organizationMailRecipientSuppression"
              ("organizationId", recipient, reason, "createdAt", "updatedAt")
            values (${organizationId}, 'recipient@example.com', 'manual', now(), now())`;
        });
        await expect(sending).resolves.toBeInstanceOf(
          OrganizationMailSendError
        );
        expect(state.send).not.toHaveBeenCalled();
      } finally {
        resume.resolve(null);
        await connection.end();
      }
    });

    test("manual suppression waits for an independent policy lock", async () => {
      const actorUserId = await createMailboxActor();
      const connection = postgres(state.databaseUrl ?? "", { max: 1 });
      let suppression: Promise<{ changed: boolean }> | undefined;
      try {
        await connection.begin(async (transaction) => {
          await transaction`select id from organization where id = ${organizationId} for update`;
          suppression = suppressOrganizationMailRecipient({
            actorUserId,
            organizationId,
            recipient: "recipient@example.com",
          });
          let waiting = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const locks = await transaction`
              select pid from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'
                and pid <> pg_backend_pid()`;
            if (locks.length > 0) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          expect(waiting).toBeTruthy();
        });
        await expect(suppression).resolves.toMatchObject({ changed: true });
      } finally {
        await suppression;
        await connection.end();
      }
    });

    test("a stale prepared replay preserves uncertainty after another request is authorized", async () => {
      const actorUserId = await createMailboxActor();
      const reading = Promise.withResolvers<unknown>();
      const resume = Promise.withResolvers<unknown>();
      let reads = 0;
      state.beforeRead = async () => {
        reads += 1;
        if (reads === 1) {
          reading.resolve(null);
          await resume.promise;
        }
      };
      state.send.mockImplementationOnce(async () => {
        await suppressOrganizationMailRecipient({
          actorUserId,
          organizationId,
          recipient: "recipient@example.com",
        });
        return { MessageId: crypto.randomUUID() };
      });
      const stale = (async () => {
        try {
          return await sendPreparedMail(request);
        } catch (error) {
          return error;
        }
      })();
      try {
        await reading.promise;
        await sendPreparedMail(request);
      } finally {
        resume.resolve(null);
      }
      await expect(stale).resolves.toMatchObject({
        code: "CONFLICT",
        data: { deliveryUncertain: true },
      });
      expect(state.send).toHaveBeenCalledOnce();
    });

    test("suppression after authorization preserves accepted send and replay accounting", async () => {
      const actorUserId = await createMailboxActor();
      state.send.mockImplementationOnce(async () => {
        await suppressOrganizationMailRecipient({
          actorUserId,
          organizationId,
          recipient: "recipient@example.com",
        });
        return { MessageId: crypto.randomUUID() };
      });
      const sent = await sendPreparedMail(request);
      const replay = await sendPreparedMail(request);
      expect(replay).toMatchObject({ id: sent.id, messageId: sent.messageId });
      expect(state.send).toHaveBeenCalledOnce();
      const usage = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(eq(billingCreditUsageEvent.organizationId, organizationId));
      expect(usage).toHaveLength(1);
    });

    const createSendFixture = async ({ shared = false } = {}) => {
      const userId = await createMailboxActor();
      await db
        .update(mailbox)
        .set({
          accessMode: shared ? "shared" : "private",
          managedOwnerUserId: shared ? null : userId,
        })
        .where(eq(mailbox.id, mailboxId));
      return {
        mailboxId,
        message: composeMessageInputSchema.parse({
          attachments: [],
          bodyHtml:
            "<p>I will send the revised plan tomorrow.</p><blockquote>A quoted request</blockquote>",
          bodyText:
            "I will send the revised plan tomorrow.\n> A quoted request",
          inlineImages: [],
          localId: crypto.randomUUID(),
          recipients: { bcc: "", cc: "", to: "recipient@example.com" },
          saveStatus: "saved",
          subject: "Revised plan",
          updatedAt: Date.now(),
        }),
        userId,
      };
    };

    const createRuleFixture = async () => {
      const userId = await createMailboxActor();
      const now = new Date();
      const messageId = crypto.randomUUID();
      await db.insert(managedMailMessage).values({
        bodyText: "Message",
        createdAt: now,
        direction: "inbound",
        from: "sender@example.com",
        id: messageId,
        isRead: false,
        mailboxId,
        providerMessageId: messageId,
        sentAt: now,
        subject: "Original",
        threadId: messageId,
        updatedAt: now,
      });
      const definition = managedMailboxRuleDefinitionSchema.parse({
        actions: [
          { kind: "set-read", read: true },
          {
            includeAttachments: false,
            kind: "forward",
            recipients: ["original@example.com"],
          },
          { destination: "archive", kind: "move" },
        ],
        enabled: true,
        labelIds: [],
        matchMode: "all",
        name: "Forward unread",
        search: { filters: [{ type: "is", value: "unread" }], text: "" },
      });
      const rule = await createManagedRule({ definition, mailboxId, userId });
      if (rule === undefined) {
        throw new Error("Rule was not created");
      }
      return { definition, messageId, now, rule, userId };
    };

    test("recovered managed sends capture their original author's writing once", async () => {
      const input = await createSendFixture();
      const { userId } = input;
      const replayingUserId = await createMailboxActor({ role: "responder" });
      state.failProjection = true;
      const sent = await sendManagedMailboxMessage(input);
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toHaveLength(0);
      state.failProjection = false;
      await Promise.all([
        recoverMailSends(),
        sendManagedMailboxMessage({ ...input, userId: replayingUserId }),
      ]);
      await recoverMailSends();
      await expect(
        db
          .select()
          .from(organizationMailSendIdempotency)
          .where(eq(organizationMailSendIdempotency.id, sent.id))
      ).resolves.toMatchObject([
        { snapshot: { actorUserId: userId }, status: "completed" },
      ]);
      const observations = await db
        .select()
        .from(userAiContextEvent)
        .where(eq(userAiContextEvent.mailboxId, mailboxId));
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({
        metadata: {
          authorship: "observed_outbound",
          bodyText: "I will send the revised plan tomorrow.",
          memoryScope: "user",
          messageId: sent.id,
          observationKind: "sent_message",
          sender: request.snapshot.sender,
          userAuthored: null,
        },
        userId,
      });
      expect(observations[0]?.metadata.from).toContain(request.snapshot.sender);
      expect(state.send).toHaveBeenCalledOnce();
    });

    test("recovered managed sends retain generated-writing provenance", async () => {
      const input = await createSendFixture();
      await recordAiGeneratedMailBody({
        ...input.message,
        mailboxId,
        userId: input.userId,
      });
      state.failProjection = true;
      const sent = await sendManagedMailboxMessage(input);
      state.failProjection = false;
      await recoverMailSends();
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        {
          metadata: {
            aiGenerated: true,
            authorship: "ai_generated",
            messageId: sent.id,
            userAuthored: false,
          },
          userId: input.userId,
        },
      ]);
    });

    test.each([
      {
        name: "the private mailbox changes owners",
        revoke: async (_actorUserId: string) => {
          const nextOwnerUserId = await createMailboxActor();
          await db
            .update(mailbox)
            .set({ managedOwnerUserId: nextOwnerUserId })
            .where(eq(mailbox.id, mailboxId));
        },
        shared: false,
      },
      {
        name: "the author loses team membership",
        revoke: async (actorUserId: string) => {
          await db
            .delete(member)
            .where(
              and(
                eq(member.organizationId, organizationId),
                eq(member.userId, actorUserId)
              )
            );
        },
        shared: false,
      },
      {
        name: "the shared mailbox author loses their grant",
        revoke: async (actorUserId: string) => {
          await createMailboxActor();
          await db
            .delete(mailboxGrant)
            .where(
              and(
                eq(mailboxGrant.mailboxId, mailboxId),
                eq(mailboxGrant.userId, actorUserId)
              )
            );
        },
        shared: true,
      },
    ])(
      "send recovery skips learning when $name",
      async ({ revoke, shared }) => {
        const input = await createSendFixture({ shared });
        state.failProjection = true;
        const sent = await sendManagedMailboxMessage(input);
        await revoke(input.userId);
        state.failProjection = false;
        await recoverMailSends();
        await expect(
          db
            .select()
            .from(organizationMailSendIdempotency)
            .where(eq(organizationMailSendIdempotency.id, sent.id))
        ).resolves.toMatchObject([{ status: "completed" }]);
        await expect(
          db
            .select()
            .from(userAiContextEvent)
            .where(eq(userAiContextEvent.mailboxId, mailboxId))
        ).resolves.toHaveLength(0);
      }
    );

    test("shared managed sends capture the acting user's private evidence", async () => {
      const input = await createSendFixture({ shared: true });
      state.failProjection = true;
      const sent = await sendManagedMailboxMessage(input);
      state.failProjection = false;
      await recoverMailSends();
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        {
          metadata: { memoryScope: "user", messageId: sent.id },
          userId: input.userId,
        },
      ]);
    });

    test("shared responders never learn under another manager's identity", async () => {
      const input = await createSendFixture({ shared: true });
      const responderUserId = await createMailboxActor({ role: "responder" });
      state.failProjection = true;
      const sent = await sendManagedMailboxMessage({
        ...input,
        userId: responderUserId,
      });
      state.failProjection = false;
      await recoverMailSends();
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        {
          metadata: { memoryScope: "user", messageId: sent.id },
          userId: responderUserId,
        },
      ]);
    });

    test.each(["legacy", "api"] as const)(
      "%s sends never infer an author from mailbox managers",
      async (kind) => {
        const { userId } = await createSendFixture({ shared: true });
        request.snapshot = {
          ...request.snapshot,
          actorUserId: kind === "api" ? userId : undefined,
          kind: kind === "api" ? "api" : "mailbox",
        };
        state.failProjection = true;
        await sendPreparedMail(request);
        state.failProjection = false;
        await recoverMailSends();
        await expect(
          db
            .select()
            .from(userAiContextEvent)
            .where(eq(userAiContextEvent.mailboxId, mailboxId))
        ).resolves.toHaveLength(0);
      }
    );

    test("memory persistence failures leave accepted sends recoverable", async () => {
      const input = await createSendFixture();
      state.failMemoryCapture = true;
      const sent = await sendManagedMailboxMessage(input);
      await expect(
        db
          .select()
          .from(organizationMailSendIdempotency)
          .where(eq(organizationMailSendIdempotency.id, sent.id))
      ).resolves.toMatchObject([{ status: "accepted" }]);
      state.failMemoryCapture = false;
      await Promise.all([recoverMailSends(), sendManagedMailboxMessage(input)]);
      await expect(
        db
          .select()
          .from(organizationMailSendIdempotency)
          .where(eq(organizationMailSendIdempotency.id, sent.id))
      ).resolves.toMatchObject([{ status: "completed" }]);
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        { metadata: { messageId: sent.id }, userId: input.userId },
      ]);
      expect(state.send).toHaveBeenCalledOnce();
    });

    test("a fresh send attempt records its verified retrying actor", async () => {
      const input = await createSendFixture({ shared: true });
      const retryingUserId = await createMailboxActor();
      state.send.mockRejectedValueOnce(
        new SESv2ServiceException({
          $fault: "client",
          $metadata: { httpStatusCode: 400 },
          message: "Rejected",
          name: "MessageRejected",
        })
      );
      await expect(sendManagedMailboxMessage(input)).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toHaveLength(0);
      const sent = await sendManagedMailboxMessage({
        ...input,
        userId: retryingUserId,
      });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        {
          metadata: { memoryScope: "user", messageId: sent.id },
          userId: retryingUserId,
        },
      ]);
    });

    test.each(["rejected", "unknown", "concurrent"] as const)(
      "rule forwards recover after %s delivery without repeating completed actions",
      async (failure) => {
        const { definition, messageId, now, rule, userId } =
          await createRuleFixture();
        if (failure === "rejected") {
          state.send.mockRejectedValueOnce(
            new SESv2ServiceException({
              $fault: "client",
              $metadata: { httpStatusCode: 400 },
              message: "Rejected",
              name: "MessageRejected",
            })
          );
        } else if (failure === "unknown") {
          state.send.mockRejectedValueOnce(
            new Error("Connection reset after submission")
          );
        }
        const input = { mailboxId, messageId };
        if (failure === "concurrent") {
          await Promise.all([
            applyManagedRulesToMessage(input),
            applyManagedRulesToMessage(input),
          ]);
        } else {
          const result = await applyManagedRulesToMessage(input);
          expect(result.error).not.toBeNull();
          await updateManagedRule({
            definition: {
              ...definition,
              actions: [
                {
                  includeAttachments: false,
                  kind: "forward",
                  recipients: ["edited@example.com"],
                },
              ],
            },
            mailboxId,
            ruleId: rule.id,
            userId,
          });
        }
        if (failure === "unknown") {
          const result = await applyManagedRulesToMessage(input);
          expect(result.error).not.toBeNull();
          const [operation] = await db
            .select()
            .from(organizationMailSendIdempotency)
            .where(
              eq(organizationMailSendIdempotency.organizationId, organizationId)
            );
          await recordOrganizationMailFeedback({
            eventType: "sent",
            occurredAt: now,
            provider: "ses",
            providerMessageId: "confirmed-rule-forward",
            recipients: [{ emailAddress: "original@example.com" }],
            sendOperationId: operation.id,
            sender: request.snapshot.sender,
            sourceEventId: crypto.randomUUID(),
          });
          await recoverMailSends();
        }
        await expect(applyManagedRulesToMessage(input)).resolves.toStrictEqual({
          error: null,
          matched: true,
        });
        await expect(applyManagedRulesToMessage(input)).resolves.toStrictEqual({
          error: null,
          matched: true,
        });
        const [message] = await db
          .select()
          .from(managedMailMessage)
          .where(eq(managedMailMessage.id, messageId));
        expect(message).toMatchObject({
          isRead: true,
          mailboxState: "archived",
        });
        const runs = await db
          .select()
          .from(managedMailRuleRun)
          .where(eq(managedMailRuleRun.messageId, messageId));
        expect(runs).toHaveLength(1);
        expect(runs[0].completedAt).not.toBeNull();
        const [operation] = await db
          .select()
          .from(organizationMailSendIdempotency)
          .where(
            eq(organizationMailSendIdempotency.organizationId, organizationId)
          );
        expect(operation.snapshot?.to).toStrictEqual(["original@example.com"]);
        expect(state.send).toHaveBeenCalledTimes(
          failure === "rejected" ? 2 : 1
        );
      }
    );

    test("backfills run without readers and resume failed messages from their original snapshot", async () => {
      const { definition, rule, userId } = await createRuleFixture();
      const input = { mailboxId, ruleId: rule.id, userId };
      const starts = await Promise.allSettled([
        startManagedRuleBackfill(input),
        startManagedRuleBackfill(input),
      ]);
      expect(
        starts.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const started = starts.find((result) => result.status === "fulfilled");
      if (started?.status !== "fulfilled") {
        throw new Error("Backfill did not start");
      }
      const statusInput = { backfillId: started.value.id, mailboxId, userId };
      await expect(getManagedRuleBackfill(statusInput)).resolves.toMatchObject({
        processedCount: 0,
        status: "pending",
      });
      expect(state.send).not.toHaveBeenCalled();
      state.send.mockRejectedValueOnce(
        new SESv2ServiceException({
          $fault: "client",
          $metadata: { httpStatusCode: 400 },
          message: "Rejected",
          name: "MessageRejected",
        })
      );
      await Promise.all([
        processManagedRuleBackfills(),
        processManagedRuleBackfills(),
      ]);
      await expect(getManagedRuleBackfill(statusInput)).resolves.toMatchObject({
        cursor: null,
        errorCount: 1,

        processedCount: 0,
        status: "failed",
      });
      await expect(startManagedRuleBackfill(input)).resolves.toMatchObject({
        id: started.value.id,
        status: "pending",
      });
      await updateManagedRule({
        ...input,
        definition: {
          ...definition,
          actions: [
            {
              includeAttachments: false,
              kind: "forward",
              recipients: ["edited@example.com"],
            },
          ],
        },
      });
      await processManagedRuleBackfills();
      await expect(getManagedRuleBackfill(statusInput)).resolves.toMatchObject({
        lastError: null,
        matchedCount: 1,
        processedCount: 1,
        status: "completed",
      });
      const [operation] = await db
        .select()
        .from(organizationMailSendIdempotency)
        .where(
          eq(organizationMailSendIdempotency.organizationId, organizationId)
        );
      expect(operation.snapshot?.to).toStrictEqual(["original@example.com"]);
      expect(state.send).toHaveBeenCalledTimes(2);
    });

    test("cancellation during a forward cannot be overwritten by the backfill processor", async () => {
      const { rule, userId } = await createRuleFixture();
      const backfill = await startManagedRuleBackfill({
        mailboxId,
        ruleId: rule.id,
        userId,
      });
      const input = { backfillId: backfill.id, mailboxId, userId };
      state.send.mockImplementationOnce(async () => {
        await cancelManagedRuleBackfill(input);
        return { MessageId: crypto.randomUUID() };
      });
      await processManagedRuleBackfills();
      await processManagedRuleBackfills();
      await expect(getManagedRuleBackfill(input)).resolves.toMatchObject({
        completedAt: null,
        processedCount: 0,
        status: "cancelled",
      });
      expect(state.send).toHaveBeenCalledOnce();
    });

    test("reserves a limited balance atomically with a single-connection pool", async () => {
      const rawObject = await storeRawMailObject(new Uint8Array([1]));
      const other = {
        ...request,
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      };
      const results = await Promise.allSettled([
        reserveOrganizationMailSend({ ...request, rawObject }),
        reserveOrganizationMailSend({ ...other, rawObject }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
      const rows = await db
        .select()
        .from(organizationMailSendIdempotency)
        .where(
          eq(organizationMailSendIdempotency.organizationId, organizationId)
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("prepared");
    });

    test("concurrent requests and subsequent retries send and charge once", async () => {
      const results = await Promise.allSettled([
        sendPreparedMail(request),
        sendPreparedMail({ ...request, id: crypto.randomUUID() }),
      ]);
      expect(
        results.some((result) => result.status === "fulfilled")
      ).toBeTruthy();
      const replay = await sendPreparedMail(request);
      expect(replay.idempotent).toBeTruthy();
      expect(state.send).toHaveBeenCalledOnce();
      const messages = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.mailboxId, mailboxId));
      const charges = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(eq(billingCreditUsageEvent.organizationId, organizationId));
      expect(messages).toHaveLength(1);
      expect(messages[0]?.rawObjectKey).toBeTruthy();
      expect(charges).toHaveLength(1);
    });

    test("a confirmed rejection releases the reservation and permits retry", async () => {
      state.send.mockRejectedValueOnce(
        new SESv2ServiceException({
          $fault: "client",
          $metadata: { httpStatusCode: 400 },
          message: "Rejected",
          name: "MessageRejected",
        })
      );
      await expect(sendPreparedMail(request)).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
      await expect(sendPreparedMail(request)).resolves.toMatchObject({
        sent: true,
      });
      expect(state.send).toHaveBeenCalledTimes(2);
    });

    test("a lost provider response blocks resend until authenticated feedback confirms it", async () => {
      const { userId } = await createSendFixture();
      request.snapshot.actorUserId = userId;
      state.send.mockRejectedValueOnce(
        new Error("Connection reset after submission")
      );
      await expect(sendPreparedMail(request)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(sendPreparedMail(request)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toHaveLength(0);
      await recordOrganizationMailFeedback({
        eventType: "sent",
        occurredAt: new Date(),
        provider: "ses",
        providerMessageId: "accepted-after-timeout",
        recipients: [{ emailAddress: "recipient@example.com" }],
        sendOperationId: request.id,
        sender: request.snapshot.sender,
        sourceEventId: crypto.randomUUID(),
      });
      await recoverMailSends();
      await expect(sendPreparedMail(request)).resolves.toMatchObject({
        messageId: "accepted-after-timeout",
        sent: true,
      });
      await expect(
        db
          .select()
          .from(userAiContextEvent)
          .where(eq(userAiContextEvent.mailboxId, mailboxId))
      ).resolves.toMatchObject([
        { metadata: { observationKind: "sent_message" }, userId },
      ]);
      expect(state.send).toHaveBeenCalledOnce();
    });

    test("accepted sends recover their missing projection without a second send or charge", async () => {
      state.failProjection = true;
      await expect(sendPreparedMail(request)).resolves.toMatchObject({
        sent: true,
      });
      state.failProjection = false;
      await recoverMailSends();
      const [operation] = await db
        .select()
        .from(organizationMailSendIdempotency)
        .where(eq(organizationMailSendIdempotency.id, request.id));
      const charges = await db
        .select()
        .from(billingCreditUsageEvent)
        .where(eq(billingCreditUsageEvent.organizationId, organizationId));
      expect(operation?.status).toBe("completed");
      expect(charges).toHaveLength(1);
      expect(state.send).toHaveBeenCalledOnce();
    });

    test.each([false, true])(
      "send recovery preserves a draft only when it was edited afterward: %s",
      async (edited) => {
        const draftId = crypto.randomUUID();
        const savedAt = new Date();
        await db.insert(managedMailMessage).values({
          createdAt: savedAt,
          direction: "outbound",
          from: request.snapshot.sender,
          id: draftId,
          mailboxId,
          mailboxState: "draft",
          providerMessageId: `draft:${draftId}`,
          sentAt: savedAt,
          threadId: draftId,
          updatedAt: savedAt,
        });
        request.snapshot.draftId = draftId;
        request.snapshot.draftUpdatedAt = savedAt.toISOString();
        state.failProjection = true;
        await sendPreparedMail(request);
        if (edited) {
          await db
            .update(managedMailMessage)
            .set({
              bodyText: "Later edits",
              updatedAt: new Date(savedAt.getTime() + 1),
            })
            .where(eq(managedMailMessage.id, draftId));
        }
        state.failProjection = false;
        await recoverMailSends();
        const drafts = await db
          .select()
          .from(managedMailMessage)
          .where(eq(managedMailMessage.id, draftId));
        expect(drafts).toHaveLength(edited ? 1 : 0);
      }
    );

    test("API sends retain file and inline bytes in the managed Sent mailbox", async () => {
      const userId = await createMailboxActor();
      await db
        .update(mailbox)
        .set({ includeApiSentMessages: true })
        .where(eq(mailbox.id, mailboxId));
      await db
        .update(organizationMailUsageSettings)
        .set({ monthlyOverageLimitMicroCents: 100_000 })
        .where(
          eq(organizationMailUsageSettings.organizationId, organizationId)
        );
      await sendOrganizationMailMessage({
        message: sendMessageInputSchema.parse({
          attachments: [
            {
              content: Buffer.from("document bytes").toString("base64"),
              contentType: "text/plain",
              filename: "document.txt",
            },
            {
              content: Buffer.from([0, 1, 128, 255]).toString("base64"),
              contentId: "photo",
              contentType: "image/png",
              disposition: "inline",
              filename: "photo.png",
            },
          ],
          from: request.snapshot.sender,
          html: '<p>Hello<img src="cid:photo"></p>',
          subject: "With files",
          text: "Hello",
          to: "recipient@example.com",
        }),
        organizationId,
      });
      const [message] = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.mailboxId, mailboxId));
      const raw = state.objects.get(message?.rawObjectKey ?? "");
      expect(raw).toBeDefined();
      const parts = await parseRawMailAttachments(raw ?? new Uint8Array());
      const attachments = await db
        .select()
        .from(managedMailAttachment)
        .where(eq(managedMailAttachment.mailboxId, mailboxId));
      expect(attachments).toHaveLength(2);
      for (const attachment of attachments) {
        const part = parts[attachment.partIndex ?? -1];
        expect(part?.fileName).toBe(attachment.fileName);
        expect(part?.content).toStrictEqual(
          attachment.inline
            ? new Uint8Array([0, 1, 128, 255])
            : new TextEncoder().encode("document bytes")
        );
      }
      const apiPage = await listOrganizationApiMailMessages({
        category: "sent",
        mailboxId: getOrganizationApiMailboxId(organizationId),
        userId,
      });
      const attachmentNames = apiPage.messages[0]?.threadAttachmentNames;
      expect(attachmentNames).toContain("document.txt");
      expect(attachmentNames).not.toContain("photo.png");
    });

    test("garbage collection retains referenced MIME and removes abandoned uploads", async () => {
      await sendPreparedMail(request);
      const orphan = await storeRawMailObject(new Uint8Array([2]));
      const [message] = await db
        .select()
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.mailboxId, mailboxId),
            eq(managedMailMessage.direction, "outbound")
          )
        );
      await db
        .update(mailObjectCleanup)
        .set({ notBefore: new Date(0) })
        .where(
          inArray(mailObjectCleanup.key, [
            orphan.key,
            message.rawObjectKey ?? "",
          ])
        );
      await cleanupMailObjects();
      expect(state.objects.has(orphan.key)).toBeFalsy();
      expect(state.objects.has(message?.rawObjectKey ?? "")).toBeTruthy();
    });
  }
);
