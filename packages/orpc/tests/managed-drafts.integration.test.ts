import "./sync-runtime-fixture";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailMessage,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { getManagedMessageAttachment } from "../src/managed-mail/messages/attachments";
import {
  deleteManagedDraft,
  saveManagedDraft,
} from "../src/managed-mail/messages/drafts";
import {
  setManagedMessageMailboxState,
  setManagedMessageReadState,
  setManagedThreadMailboxState,
  setManagedThreadReadState,
} from "../src/managed-mail/messages/service";

const state = vi.hoisted(() => ({
  barrier: undefined as (() => Promise<void>) | undefined,
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  objects: new Map<string, Uint8Array<ArrayBuffer>>(),
  rejectWrite: false,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      R2_BUCKET: "test",
    },
  };
});
vi.mock(
  import("../src/managed-mail/messages/raw-object"),
  async (original) => ({
    ...(await original()),
    // oxlint-disable-next-line eslint/require-await -- Retain the asynchronous storage contract in this in-memory fixture.
    deleteRawMailObject: async (object) => {
      state.objects.delete(object.key);
    },
    // oxlint-disable-next-line eslint/require-await -- Storage failures reject asynchronously.
    readRawMailObject: async (record) => {
      const raw = state.objects.get(record.rawObjectKey ?? "");
      if (!raw) {
        throw new Error("Object not found");
      }
      return raw;
    },
    writeRawMailObject: async (object, raw: Uint8Array) => {
      if (state.rejectWrite) {
        throw new Error("Storage unavailable");
      }
      state.objects.set(object.key, new Uint8Array(raw));
      await state.barrier?.();
    },
  })
);

describe.skipIf(state.databaseUrl === undefined)(
  "managed drafts on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const otherMailboxId = crypto.randomUUID();
    const draft = composeDraftInputSchema.parse({
      attachments: ["first", "other"].map((content) => ({
        file: new File([content], "same.txt", { type: "text/plain" }),
        id: content,
        isInline: false,
        mimeType: "text/plain",
        name: "same.txt",
        size: 5,
      })),
      bodyHtml: "<p>Draft</p>",
      bodyText: "Draft",
      inlineImages: [],
      localId: crypto.randomUUID(),
      recipients: { bcc: "", cc: "", to: "recipient@example.com" },
      saveStatus: "idle",
      subject: "Original",
      updatedAt: 0,
    });
    const input = { draft, mailboxId, userId };

    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Draft integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: true,
          id,
          name: "Draft test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Draft test",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "member",
          userId: id,
        }))
      );
      await db.insert(mailbox).values(
        [
          [mailboxId, userId],
          [otherMailboxId, otherUserId],
        ].map(([id, owner]) => ({
          accessMode: "private" as const,
          createdAt: now,
          emailAddress: `${id}@example.com`,
          id,
          managedOwnerUserId: owner,
          organizationId,
          provider: "managed" as const,
          updatedAt: now,
        }))
      );
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
      await db.$client.end();
    });

    test("saves and reopens identical attachment metadata using the correct MIME part", async () => {
      const saved = await saveManagedDraft(input);
      const attachments = await db
        .select()
        .from(managedMailAttachment)
        .where(eq(managedMailAttachment.messageId, saved.messageId))
        .orderBy(asc(managedMailAttachment.partIndex));
      const loaded = await Promise.all(
        attachments.map(async (attachment) => {
          const result = await getManagedMessageAttachment({
            attachmentId: attachment.id,
            mailboxId,
            messageId: saved.messageId,
            userId,
          });
          return await result.file.text();
        })
      );
      expect(loaded).toStrictEqual(["first", "other"]);
      await expect(
        getManagedMessageAttachment({
          attachmentId: attachments[0]?.id ?? "",
          mailboxId: otherMailboxId,
          messageId: saved.messageId,
          userId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await deleteManagedDraft({ draftId: saved.draftId, mailboxId, userId });
      expect(state.objects.size).toBe(0);
      await expect(
        saveManagedDraft({
          ...input,
          draft: { ...draft, draftId: saved.draftId },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("failed storage preserves the saved draft and attachment bytes", async () => {
      const saved = await saveManagedDraft(input);
      state.rejectWrite = true;
      try {
        await expect(
          saveManagedDraft({
            ...input,
            draft: {
              ...draft,
              baseVersion: saved.draftVersion,
              draftId: saved.draftId,
              subject: "Changed",
            },
          })
        ).rejects.toThrow("Storage unavailable");
      } finally {
        state.rejectWrite = false;
      }
      const [record] = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.id, saved.messageId));
      expect(record?.subject).toBe("Original");
      expect(state.objects.has(record?.rawObjectKey ?? "")).toBeTruthy();
      await deleteManagedDraft({ draftId: saved.draftId, mailboxId, userId });
    });

    test("thread archive excludes drafts while read changes and single-message archive include them", async () => {
      const saved = await saveManagedDraft({
        ...input,
        draft: { ...draft, localId: crypto.randomUUID() },
      });
      const sibling = await saveManagedDraft({
        ...input,
        draft: { ...draft, localId: crypto.randomUUID() },
      });
      const threadId = crypto.randomUUID();
      await db
        .update(managedMailMessage)
        .set({ threadId })
        .where(
          inArray(managedMailMessage.id, [saved.messageId, sibling.messageId])
        );
      await expect(
        setManagedThreadMailboxState({
          mailboxId,
          state: "archived",
          threadId,
          userId,
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Message thread not found.",
      });
      await db
        .update(managedMailMessage)
        .set({ mailboxState: "active" })
        .where(eq(managedMailMessage.id, sibling.messageId));
      const [before] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      await expect(
        setManagedThreadMailboxState({
          mailboxId,
          state: "archived",
          threadId,
          userId,
        })
      ).resolves.toStrictEqual({
        messages: [
          {
            id: sibling.messageId,
            isUnread: false,
            labelIds: [MAILBOX_LABELS.archive],
          },
        ],
        threadId,
      });
      const unread = await setManagedThreadReadState({
        mailboxId,
        read: false,
        threadId,
        userId,
      });
      expect(unread.threadId).toBe(threadId);
      expect(unread.messages).toHaveLength(2);
      expect(unread.messages).toStrictEqual(
        expect.arrayContaining([
          {
            id: saved.messageId,
            isUnread: true,
            labelIds: [MAILBOX_LABELS.drafts, MAILBOX_LABELS.unread],
          },
          {
            id: sibling.messageId,
            isUnread: true,
            labelIds: [MAILBOX_LABELS.archive, MAILBOX_LABELS.unread],
          },
        ])
      );
      await expect(
        setManagedMessageReadState({
          mailboxId,
          messageId: saved.messageId,
          read: true,
          userId,
        })
      ).resolves.toStrictEqual({
        id: saved.messageId,
        isUnread: false,
        labelIds: [MAILBOX_LABELS.drafts],
      });
      await expect(
        setManagedMessageMailboxState({
          mailboxId,
          messageId: saved.messageId,
          state: "archived",
          userId,
        })
      ).resolves.toStrictEqual({
        id: saved.messageId,
        isUnread: false,
        labelIds: [MAILBOX_LABELS.archive],
      });
      const records = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.threadId, threadId));
      expect(records).toHaveLength(2);
      expect(
        records.every((record) => record.mailboxState === "archived")
      ).toBeTruthy();
      expect(
        records.find((record) => record.id === sibling.messageId)?.isRead
      ).toBeFalsy();
      const [after] = await db
        .select()
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      expect(after?.contentRevision).toBe((before?.contentRevision ?? 0) + 4);
    });

    test("concurrent saves cannot silently overwrite each other", async () => {
      const saved = await saveManagedDraft(input);
      const gate = Promise.withResolvers<boolean>();
      let arrivals = 0;
      state.barrier = async () => {
        arrivals += 1;
        if (arrivals === 2) {
          gate.resolve(true);
        }
        await gate.promise;
      };
      const results = await Promise.allSettled(
        ["One", "Two"].map(
          async (subject) =>
            await saveManagedDraft({
              ...input,
              draft: {
                ...draft,
                baseVersion: saved.draftVersion,
                draftId: saved.draftId,
                subject,
              },
            })
        )
      );
      state.barrier = undefined;
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected")
      ).toMatchObject({ reason: { code: "CONFLICT" } });
      const [record] = await db
        .select()
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.id, saved.messageId),
            eq(managedMailMessage.mailboxId, mailboxId)
          )
        );
      expect(record?.subject).toBe(
        results.find((result) => result.status === "fulfilled")?.value.subject
      );
      await deleteManagedDraft({ draftId: saved.draftId, mailboxId, userId });
    });
  }
);
