import { QUIETER_DRAFT_HEADER_NAMES } from "@quieter/mail/compose/schema";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  getOutlookAttachment,
  getOutlookDeltaPage,
  getOutlookMessage,
  listOutlookConversationMessages,
  OutlookGraphError,
} from "../src/graph";
import type { OutlookMessage, OutlookSystemFolders } from "../src/graph";
import {
  aggregateOutlookThread,
  getOutlookMessageWebLink,
  normalizeOutlookMessage,
} from "../src/messages";

vi.mock(import("@quieter/mail/sender-avatar"), () => ({
  getSenderAvatarUrls: async () =>
    await Promise.resolve({
      dark: "https://avatar.invalid/dark",
      light: "https://avatar.invalid/light",
    }),
}));

const context = { accessToken: "synthetic-provider-token" };
const folders: OutlookSystemFolders = {
  archive: "ArchiveId",
  drafts: "DraftsId",
  inbox: "InboxId",
  sent: "SentId",
  spam: "SpamId",
  trash: "TrashId",
};
const message: OutlookMessage = {
  body: {
    content: '<p>Hello<img src="cid:logo@example.test"></p>',
    contentType: "html",
  },
  categories: ["Client Updates"],
  changeKey: "opaque-revision",
  conversationId: "conversation-id",
  from: { emailAddress: { address: "sender@example.test", name: "Sender" } },
  id: "message-id",
  internetMessageHeaders: [
    { name: "From", value: '"Sender" <sender@example.test>' },
    {
      name: "List-Unsubscribe",
      value: "<mailto:leave@example.test>, <https://example.test/leave>",
    },
    { name: "List-ID", value: "Updates <updates.example.test>" },
    { name: "In-Reply-To", value: "<parent@example.test>" },
    { name: "References", value: "<first@example.test> <parent@example.test>" },
    { name: "OTP-Token", value: '"123456";origin="https://example.test"' },
  ],
  internetMessageId: "<current@example.test>",
  isDraft: false,
  isRead: false,
  parentFolderId: folders.inbox,
  receivedDateTime: "2026-11-16T15:00:00Z",
  replyTo: [{ emailAddress: { address: "reply@example.test" } }],
  subject: "A useful message",
  toRecipients: [{ emailAddress: { address: "owner@example.test" } }],
  webLink: "https://outlook.office.com/mail/id/message-id",
};

describe("Outlook read boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("preserves scoped opaque delta links and validates a complete page before returning changes", async () => {
    const next =
      "https://graph.microsoft.com/v1.0/me/mailfolders('InboxId')/messages/delta?$skiptoken=opaque%2Bstate%3D";
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("prefer")).toContain(
          "ImmutableId"
        );
        expect(init?.redirect).toBe("manual");
        return await Promise.resolve(
          Response.json({
            "@odata.nextLink": next,
            value: [
              { id: message.id, isRead: true },
              { "@removed": { reason: "deleted" }, id: "moved-id" },
            ],
          })
        );
      }
    );
    vi.stubGlobal("fetch", fetch);
    const page = await getOutlookDeltaPage(context, {
      folderId: folders.inbox,
    });
    expect(page.continuation).toMatchObject({ kind: "next", url: next });
    expect(page.changes).toContainEqual({ id: "moved-id", kind: "removed" });
    expect(page.changes).toContainEqual({
      kind: "message",
      message: { id: message.id, isRead: true },
    });
    fetch.mockResolvedValueOnce(
      Response.json({
        "@odata.deltaLink": next,
        value: [
          { id: "valid" },
          { "@removed": { reason: "not-a-reason" }, id: "invalid" },
        ],
      })
    );
    await expect(
      getOutlookDeltaPage(context, { folderId: folders.inbox })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test.each([
    "https://outside.invalid/v1.0/me/mailFolders/InboxId/messages/delta",
    "https://graph.microsoft.com/v1.0/users/another/messages/delta",
    "https://graph.microsoft.com/v1.0/me/mailFolders/inboxid/messages/delta",
    "https://graph.microsoft.com/v1.0/me/mailFolders/Other/messages/delta",
    "https://user@graph.microsoft.com/v1.0/me/mailFolders/InboxId/messages/delta",
    "https://graph.microsoft.com:444/v1.0/me/mailFolders/InboxId/messages/delta",
  ])(
    "rejects an unsafe or different delta scope before forwarding credentials",
    async (cursor) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      await expect(
        getOutlookDeltaPage(context, { cursor, folderId: folders.inbox })
      ).rejects.toBeInstanceOf(OutlookGraphError);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  test("does not accept a mismatched message or conversation from a provider response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(
        async () => await Promise.resolve(Response.json(message))
      )
    );
    await expect(
      getOutlookMessage(context, { messageId: "other-id" })
    ).rejects.toMatchObject({ code: "invalid_response" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(
        async () => await Promise.resolve(Response.json({ value: [message] }))
      )
    );
    await expect(
      listOutlookConversationMessages(context, {
        conversationId: "other-conversation",
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test.each(["", ".", ".."])(
    "rejects a path-control identifier before a request",
    async (messageId) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      await expect(
        getOutlookMessage(context, { messageId })
      ).rejects.toMatchObject({ code: "invalid_response" });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  test("classifies throttling without exposing the response content or token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(
        async () =>
          await Promise.resolve(
            new Response("private-provider-content", {
              headers: { "retry-after": "30" },
              status: 429,
            })
          )
      )
    );
    const failure: unknown = await getOutlookMessage(context, {
      messageId: message.id,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OutlookGraphError);
    expect(failure).toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(failure).toHaveProperty("retryAt", expect.any(Date));
    expect(String(failure)).not.toMatch(
      /private-provider-content|synthetic-provider-token/u
    );
  });

  test.each([400, 404])(
    "recovers an expired delta continuation without hiding an actual missing resource",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(
          async () =>
            await Promise.resolve(
              Response.json(
                {
                  error: {
                    code: "syncStateNotFound",
                    message: "private details",
                  },
                },
                { status }
              )
            )
        )
      );
      await expect(
        getOutlookDeltaPage(context, {
          cursor:
            "https://graph.microsoft.com/v1.0/me/mailFolders/InboxId/messages/delta?$deltatoken=expired",
          folderId: folders.inbox,
        })
      ).rejects.toMatchObject({ code: "invalid_cursor" });
      await expect(
        getOutlookMessage(context, { messageId: message.id })
      ).rejects.toMatchObject({
        code: status === 404 ? "not_found" : "invalid_response",
      });
    }
  );

  test("rejects reference attachment downloads and keeps file bytes on the scoped attachment path", async () => {
    const reference = {
      "@odata.type": "#microsoft.graph.referenceAttachment",
      id: "ref",
      name: "Shared file",
      size: 0,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => await Promise.resolve(Response.json(reference))
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      getOutlookAttachment(context, {
        attachmentId: "ref",
        messageId: message.id,
      })
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        input instanceof Request ? new URL(input.url) : new URL(input);
      expect(url.pathname).toContain(
        `/messages/${message.id}/attachments/file`
      );
      return await Promise.resolve(
        url.pathname.endsWith("/$value")
          ? new Response(new Uint8Array([1, 2, 3]), {
              headers: { "content-type": "application/pdf" },
            })
          : Response.json({
              "@odata.type": "#microsoft.graph.fileAttachment",
              contentType: "application/pdf",
              id: "file",
              name: "file.pdf",
              size: 3,
            })
      );
    });
    const result = await getOutlookAttachment(context, {
      attachmentId: "file",
      messageId: message.id,
    });
    const metadataUrl = fetch.mock.calls
      .map(([input]) =>
        input instanceof Request ? new URL(input.url) : new URL(input)
      )
      .find((url) => url.pathname.endsWith("/file"));
    expect(metadataUrl?.searchParams.get("$select")).toContain("size");
    expect(metadataUrl?.searchParams.get("$select")).not.toContain(
      "contentBytes"
    );
    expect(result.bytes).toHaveLength(3);
    expect(result.attachment).toMatchObject({ id: "file", name: "file.pdf" });
  });

  test.each([undefined, "9999999999"])(
    "bounds streamed attachment bytes independently of metadata and length headers",
    async (contentLength) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (input) => {
          const url =
            input instanceof Request ? new URL(input.url) : new URL(input);
          const response = url.pathname.endsWith("/$value")
            ? new Response(new Uint8Array([1, 2, 3, 4]), {
                headers:
                  contentLength === undefined
                    ? undefined
                    : { "content-length": contentLength },
              })
            : Response.json({
                "@odata.type": "#microsoft.graph.itemAttachment",
                id: "attached-mail",
                name: "message.eml",
                size: 1,
              });
          return await Promise.resolve(response);
        })
      );
      await expect(
        getOutlookAttachment(context, {
          attachmentId: "attached-mail",
          maxBytes: 3,
          messageId: message.id,
        })
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  );
});

describe("Outlook canonical metadata", () => {
  test("retains rich source enrichment, canonical unread state and inline attachment identity", async () => {
    const normalized = await normalizeOutlookMessage({
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          contentId: "logo@example.test",
          contentType: "image/png",
          id: "inline-logo",
          isInline: true,
          name: "logo.png",
          size: 20,
        },
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          contentType: "application/pdf",
          id: "report",
          name: "report.pdf",
          size: 30,
        },
      ],
      message,
      systemFolders: folders,
    });
    expect(normalized).toMatchObject({
      inReplyTo: "<parent@example.test>",
      isUnread: true,
      messageHeaderId: "<current@example.test>",
      otpToken: { code: "123456", origin: "https://example.test" },
      receivedAt: message.receivedDateTime,
      unsubscribeKey: "list:updates.example.test",
      unsubscribeMailto: "mailto:leave@example.test",
    });
    expect(normalized.references).toContain("parent@example.test");
    expect(normalized.senderAvatarUrls?.light).toContain("avatar.invalid");
    expect(normalized.labelIds).toContain("UNREAD");
    expect(normalized.labelIds).toContain("INBOX");
    expect(normalized.labelIds).toContain("outlook-category:Client%20Updates");
    expect(normalized.attachments).toMatchObject([
      { attachmentId: "report", fileName: "report.pdf" },
    ]);
    expect(normalized.inlineImages).toMatchObject([
      { attachmentId: "inline-logo", contentId: "logo@example.test" },
    ]);
    const thread = aggregateOutlookThread({
      messages: [normalized, normalized],
      threadId: message.conversationId,
    });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      threadAttachmentCount: 1,
      threadAttachmentNames: ["report.pdf"],
      threadMessageCount: 1,
    });
    expect(() =>
      aggregateOutlookThread({ messages: [normalized], threadId: "another" })
    ).toThrow(OutlookGraphError);
  });

  test("keeps draft revisions and rejects external or credential-bearing source links", async () => {
    const draft = await normalizeOutlookMessage({
      attachments: [],
      message: {
        ...message,
        createdDateTime: "2026-11-16T16:00:00Z",
        internetMessageHeaders: [
          ...(message.internetMessageHeaders ?? []),
          {
            name: QUIETER_DRAFT_HEADER_NAMES.sourceMessageId,
            value: "source-message",
          },
          {
            name: QUIETER_DRAFT_HEADER_NAMES.sourceThreadId,
            value: "source-thread",
          },
          { name: QUIETER_DRAFT_HEADER_NAMES.seededBy, value: "reply" },
        ],
        isDraft: true,
        isRead: true,
        parentFolderId: folders.drafts,
        receivedDateTime: undefined,
        sentDateTime: undefined,
      },
      systemFolders: folders,
    });
    expect(draft).toMatchObject({
      baseRevision: message.changeKey,
      draftAnchor: {
        seededBy: "reply",
        sourceMessageId: "source-message",
        sourceThreadId: "source-thread",
      },
      draftId: message.id,
      internalDate: String(Date.parse("2026-11-16T16:00:00Z")),
      isUnread: false,
    });
    expect(draft.labelIds).toContain("DRAFT");
    expect(draft.labelIds).not.toContain("UNREAD");
    expect(getOutlookMessageWebLink(message)).toMatch(
      /^https:\/\/outlook\.office\.com\//u
    );
    expect(
      getOutlookMessageWebLink({
        ...message,
        webLink: "https://outside.invalid/message",
      })
    ).toBeUndefined();
    expect(
      getOutlookMessageWebLink({
        ...message,
        webLink: "https://secret@outlook.office.com/message",
      })
    ).toBeUndefined();
  });
});
