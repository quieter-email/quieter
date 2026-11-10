import { ORPCError } from "@orpc/server";
import { getGmailCapturedSnapshot, listGmailMessageIds } from "@quieter/gmail";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { writeGmailCapturedMessage } from "../src/mail-capture";
import { assertAccessibleMailbox } from "../src/mailbox/service";
import { advanceSemanticMailImport } from "../src/semantic-mail-import";

vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getGmailCapturedSnapshot: vi.fn<typeof getGmailCapturedSnapshot>(),
  listGmailMessageIds: vi.fn<typeof listGmailMessageIds>(),
}));
vi.mock(import("../src/gmail-mailbox-access"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    runAuthorizedGmailMailbox: (async (_scope, run) =>
      await run(
        "synthetic-token"
      )) satisfies typeof actual.runAuthorizedGmailMailbox,
  };
});
vi.mock(import("../src/mail-capture"), () => ({
  writeGmailCapturedMessage: vi.fn<typeof writeGmailCapturedMessage>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: vi.fn<typeof assertAccessibleMailbox>(),
}));

const input = {
  mailboxId: "private",
  pageToken: null,
  pendingIds: [],
  userId: "actor",
};
const snapshot: CapturedMailSnapshot = {
  attachments: [],
  bodyHtml: null,
  bodyText: "A synthetic imported message.",
  headers: [],
  id: "message",
  internalDate: "1",
  labelIds: [],
  providerRevision: "2",
  threadId: "thread",
  truncation: {
    attachments: false,
    bodyHtml: false,
    bodyText: false,
    headers: false,
  },
};

describe("explicit semantic mail import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAccessibleMailbox).mockReset();
    vi.mocked(assertAccessibleMailbox).mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 1,
      id: input.mailboxId,
      organizationId: "organization",
      provider: "gmail",
    });
    vi.mocked(listGmailMessageIds).mockReset();
    vi.mocked(listGmailMessageIds).mockResolvedValue({
      messageIds: [snapshot.id],
      nextPageToken: undefined,
    });
    vi.mocked(getGmailCapturedSnapshot).mockReset();
    vi.mocked(getGmailCapturedSnapshot).mockResolvedValue(snapshot);
    vi.mocked(writeGmailCapturedMessage).mockResolvedValue();
  });

  test("denied access cannot read the provider or retain messages", async () => {
    vi.mocked(assertAccessibleMailbox).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    await expect(advanceSemanticMailImport(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(listGmailMessageIds).not.toHaveBeenCalled();
    expect(writeGmailCapturedMessage).not.toHaveBeenCalled();
  });

  test("access revoked while provider content is loading prevents retention", async () => {
    const read = Promise.withResolvers<CapturedMailSnapshot>();
    vi.mocked(getGmailCapturedSnapshot).mockReturnValue(read.promise);
    const pending = advanceSemanticMailImport(input);
    await vi.waitFor(() => {
      expect(getGmailCapturedSnapshot).toHaveBeenCalledWith(
        "synthetic-token",
        snapshot.id,
        undefined
      );
    });
    vi.mocked(assertAccessibleMailbox).mockRejectedValue(
      new ORPCError("NOT_FOUND")
    );
    read.resolve(snapshot);
    await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writeGmailCapturedMessage).not.toHaveBeenCalled();
  });

  test("a resumed page does not list again and retains its next-page cursor", async () => {
    const result = await advanceSemanticMailImport({
      ...input,
      pageToken: "next-page",
      pendingIds: [snapshot.id],
    });
    expect(result).toMatchObject({
      complete: false,
      pageToken: "next-page",
      pendingIds: [],
    });
    expect(listGmailMessageIds).not.toHaveBeenCalled();
    expect(writeGmailCapturedMessage).toHaveBeenCalledWith({
      mailboxId: input.mailboxId,
      snapshot,
      source: "search",
    });
  });

  test("missing messages and messages moved out of the corpus do not block completion", async () => {
    vi.mocked(listGmailMessageIds).mockResolvedValue({
      messageIds: ["deleted", "moved", snapshot.id],
      nextPageToken: undefined,
    });
    vi.mocked(getGmailCapturedSnapshot).mockImplementation(
      async (_token, messageId) => {
        if (messageId === "deleted") {
          throw Object.assign(new Error("Missing message"), { status: 404 });
        }
        return await Promise.resolve(
          messageId === "moved"
            ? { ...snapshot, id: messageId, labelIds: ["TRASH"] }
            : snapshot
        );
      }
    );
    await expect(advanceSemanticMailImport(input)).resolves.toMatchObject({
      complete: true,
      pendingIds: [],
    });
    expect(writeGmailCapturedMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ snapshot })
    );
  });

  test("an expired provider page can restart without skipping retained messages", async () => {
    vi.mocked(listGmailMessageIds).mockRejectedValueOnce(
      Object.assign(new Error("Invalid page token"), { status: 400 })
    );
    const restarted = await advanceSemanticMailImport({
      ...input,
      pageToken: "expired-page",
    });
    expect(restarted).toMatchObject({
      complete: false,
      pageToken: null,
      pendingIds: [],
    });
    await expect(
      advanceSemanticMailImport({ ...input, ...restarted })
    ).resolves.toMatchObject({ complete: true });
    expect(writeGmailCapturedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot })
    );
  });

  test("a partial provider failure does not return a completed checkpoint or disclose its payload", async () => {
    vi.mocked(listGmailMessageIds).mockResolvedValue({
      messageIds: [snapshot.id, "failed"],
      nextPageToken: "following-page",
    });
    vi.mocked(getGmailCapturedSnapshot).mockImplementation(
      async (_token, messageId) => {
        if (messageId === "failed") {
          throw new Error("Private provider response body");
        }
        return await Promise.resolve(snapshot);
      }
    );
    await expect(advanceSemanticMailImport(input)).rejects.not.toThrow(
      /Private provider/u
    );
    expect(writeGmailCapturedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot })
    );
  });
});
