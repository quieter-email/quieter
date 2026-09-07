import { SESv2Client, SESv2ServiceException } from "@aws-sdk/client-sesv2";
import { reserveOrganizationMailSend } from "@quieter/billing/mail-send-reservation";
import type { ingestPolarEvents } from "@quieter/billing/polar";
import { db } from "@quieter/database/client";
import {
  billingCreditUsageEvent,
  mailbox,
  mailObjectCleanup,
  managedMailAttachment,
  managedMailMessage,
  organization,
  organizationMailSendIdempotency,
  organizationMailUsageSettings,
} from "@quieter/database/schema";
import type { MailSendSnapshot } from "@quieter/database/schema";
import { parseRawMailAttachments } from "@quieter/mail/raw-message";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { recoverMailSends, sendPreparedMail } from "../src/mail-send";
import {
  cleanupMailObjects,
  storeRawMailObject,
} from "../src/managed-mail/messages/raw-object-lifecycle";
import { sendOrganizationMailMessage } from "../src/organization-mail";
import { recordOrganizationMailFeedback } from "../src/organization-mail-delivery";
import type { assertOrganizationOwnsVerifiedSenderDomain } from "../src/organization-mail-policy";
import { hashRequest } from "../src/request-hash";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  failProjection: false,
  objects: new Map<string, Uint8Array<ArrayBuffer>>(),
  send: vi.fn<() => Promise<{ MessageId: string }>>(),
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
vi.mock(
  import("../src/managed-mail/messages/raw-object"),
  async (original) => ({
    ...(await original()),
    // oxlint-disable-next-line eslint/require-await -- Match the storage contract.
    deleteRawMailObject: async (object) => {
      state.objects.delete(object.key);
    },
    // oxlint-disable-next-line eslint/require-await -- Match the storage contract.
    readRawMailObject: async (record) => {
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
      state.failProjection = false;
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
        raw: "Hello",
        requestHash: hashRequest(snapshot),
        snapshot,
      };
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, organizationIds));
      if (state.objects.size > 0) {
        await db
          .delete(mailObjectCleanup)
          .where(inArray(mailObjectCleanup.key, [...state.objects.keys()]));
      }
      await db.$client.end();
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
      state.send.mockRejectedValueOnce(
        new Error("Connection reset after submission")
      );
      await expect(sendPreparedMail(request)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(sendPreparedMail(request)).rejects.toMatchObject({
        code: "CONFLICT",
      });
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
    });

    test("garbage collection retains referenced MIME and removes abandoned uploads", async () => {
      await sendPreparedMail(request);
      const orphan = await storeRawMailObject(new Uint8Array([2]));
      await db
        .update(mailObjectCleanup)
        .set({ notBefore: new Date(0) })
        .where(inArray(mailObjectCleanup.key, [...state.objects.keys()]));
      await cleanupMailObjects();
      const [message] = await db
        .select()
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.mailboxId, mailboxId),
            eq(managedMailMessage.direction, "outbound")
          )
        );
      expect(state.objects.has(orphan.key)).toBeFalsy();
      expect(state.objects.has(message?.rawObjectKey ?? "")).toBeTruthy();
    });
  }
);
