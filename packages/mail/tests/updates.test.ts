import { describe, expect, test } from "vite-plus/test";

import { mailUpdateSchema } from "../src/updates";

const received = {
  eventId: "59948802-409c-4cfe-a148-97ee4991ef89",
  mailboxId: "mailbox-a",
  messageId: "message-a",
  receivedAt: "2026-11-16T12:30:00.123Z",
  threadIds: ["thread-a"],
  type: "mail.received",
};

describe("mail update wire", () => {
  test("retains the exact received-message identity and source time", () => {
    expect(mailUpdateSchema.parse(received)).toStrictEqual(received);
  });

  test("rejects incomplete, ambiguous and content-bearing receive frames", () => {
    const invalid = [
      { ...received, eventId: "not-a-uuid" },
      { ...received, mailboxId: "" },
      { ...received, messageId: undefined },
      { ...received, messageId: "" },
      { ...received, threadIds: undefined },
      { ...received, threadIds: [] },
      { ...received, threadIds: [""] },
      { ...received, threadIds: ["thread-a", "thread-b"] },
      { ...received, receivedAt: undefined },
      { ...received, receivedAt: "2026-02-29T12:30:00.123Z" },
      { ...received, receivedAt: "2026-11-16T12:30:00Z" },
      { ...received, receivedAt: "2026-11-16T13:30:00.123+01:00" },
      { ...received, subject: "private subject" },
      { ...received, body: "private body" },
      { ...received, revision: "123" },
      { ...received, reminderId: "0ee8504a-fe3b-4bc8-b372-29f12660fe57" },
    ];
    for (const frame of invalid) {
      expect(mailUpdateSchema.safeParse(frame).success).toBeFalsy();
    }
  });

  test("preserves existing hint metadata and unknown-field stripping", () => {
    const metadata = {
      eventId: "59948802-409c-4cfe-a148-97ee4991ef89",
      mailboxId: "mailbox-a",
      reminderId: "0ee8504a-fe3b-4bc8-b372-29f12660fe57",
      revision: "12345678901234567890",
      scheduleVersion: 7,
      threadIds: ["thread-a", "thread-b"],
    };
    for (const type of [
      "mailbox.changed",
      "labels.changed",
      "details.changed",
      "reminders.changed",
    ]) {
      expect(
        mailUpdateSchema.parse({ ...metadata, ignored: true, type })
      ).toStrictEqual({ ...metadata, type });
      expect(
        mailUpdateSchema.parse({
          eventId: metadata.eventId,
          mailboxId: metadata.mailboxId,
          type,
        })
      ).toMatchObject({ type });
    }
  });
});
