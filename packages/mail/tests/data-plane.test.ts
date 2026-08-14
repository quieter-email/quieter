import { describe, expect, test } from "vite-plus/test";

import { getMailboxCapabilities, mailCategorySchema } from "../src/data-plane";

describe("mail data plane", () => {
  test("keeps Archive in the shared category contract", () => {
    expect(mailCategorySchema.options).toStrictEqual([
      "inbox",
      "unread",
      "archive",
      "sent",
      "drafts",
      "spam",
      "trash",
    ]);
  });

  test("limits API mailboxes to read-only Sent", () => {
    expect(getMailboxCapabilities({ provider: "api" })).toMatchObject({
      canArchive: false,
      canManageKnowledge: false,
      canManageLabels: false,
      canSend: false,
      categories: ["sent"],
    });
  });

  test("derives managed actions from the mailbox role", () => {
    expect(
      getMailboxCapabilities({ provider: "managed", role: "reader" })
    ).toMatchObject({
      canArchive: false,
      canManageKnowledge: false,
      canMarkRead: false,
      canSend: false,
    });
    expect(
      getMailboxCapabilities({ provider: "managed", role: "responder" })
    ).toMatchObject({
      canArchive: true,
      canManageKnowledge: false,
      canManageLabels: false,
      canSend: true,
    });
    expect(
      getMailboxCapabilities({ provider: "managed", role: "manager" })
    ).toMatchObject({
      canArchive: true,
      canManageKnowledge: true,
      canManageLabels: true,
      canSend: true,
    });
  });

  test("exposes knowledge management through the mailbox capability contract", () => {
    expect(
      getMailboxCapabilities({ provider: "gmail" }).canManageKnowledge
    ).toBeTruthy();
  });
});
