import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { getAuthorizedManagedMailbox } from "../src/mailbox/access";
import { getManagedMessageAttachment } from "../src/managed-mail/messages/attachments";
import type { readRawMailObject } from "../src/managed-mail/messages/raw-object";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn<typeof getAuthorizedManagedMailbox>(),
  limit: vi.fn<() => Promise<unknown[]>>(),
  read: vi.fn<typeof readRawMailObject>(),
  select: vi.fn<(...args: unknown[]) => unknown>(),
}));
vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, db: Object.assign(actual.db, { select: mocks.select }) };
});
vi.mock(import("../src/mailbox/access"), () => ({
  getAuthorizedManagedMailbox: mocks.authorize,
}));
vi.mock(import("../src/managed-mail/messages/raw-object"), () => ({
  readRawMailObject: mocks.read,
}));

const input = {
  attachmentId: "attachment-1",
  mailboxId: "mailbox-1",
  messageId: "message-1",
  userId: "owner-1",
};
const attachment = {
  contentId: null,
  fileName: "note.txt",
  id: input.attachmentId,
  inline: false,
  mimeType: "text/plain",
  partIndex: 1,
  size: 5,
};
const raw = new TextEncoder().encode(
  [
    "From: sender@example.test",
    'Content-Type: multipart/mixed; boundary="parts"',
    "",
    "--parts",
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: attachment; filename="note.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "Zmlyc3Q=",
    "--parts",
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: attachment; filename="note.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "b3RoZXI=",
    "--parts--",
    "",
  ].join("\r\n")
);

describe("managed attachment downloads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: mocks.limit }) }),
      }),
    });
    mocks.limit.mockResolvedValue([
      { attachment, message: { id: input.messageId } },
    ]);
    mocks.read.mockResolvedValue(raw);
  });

  test("selects the exact MIME part when two attachments have identical metadata", async () => {
    const result = await getManagedMessageAttachment(input);
    expect(mocks.authorize).toHaveBeenCalledWith(input);
    expect(result.file.name).toBe("note.txt");
    expect(result.file.type).toBe("text/plain");
    await expect(result.file.text()).resolves.toBe("other");
    expect(result.size).toBe(5);
  });

  test("denies access before looking up attachment data", async () => {
    mocks.authorize.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(getManagedMessageAttachment(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  test("does not read storage for an attachment outside the selected message", async () => {
    mocks.limit.mockResolvedValue([]);
    await expect(getManagedMessageAttachment(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  test.each([null, 8])(
    "rejects an ambiguous legacy attachment or invalid part index",
    async (partIndex) => {
      mocks.limit.mockResolvedValue([
        { attachment: { ...attachment, partIndex }, message: {} },
      ]);
      await expect(getManagedMessageAttachment(input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  );

  test("supports existing attachments when their metadata identifies one part", async () => {
    mocks.limit.mockResolvedValue([
      { attachment: { ...attachment, partIndex: null }, message: {} },
    ]);
    mocks.read.mockResolvedValue(
      new TextEncoder().encode(
        new TextDecoder()
          .decode(raw)
          .replace('name="note.txt"', 'name="first.txt"')
          .replace('filename="note.txt"', 'filename="first.txt"')
      )
    );
    const result = await getManagedMessageAttachment(input);
    await expect(result.file.text()).resolves.toBe("other");
  });
});
