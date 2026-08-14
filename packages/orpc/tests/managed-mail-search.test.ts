import type { managedMailMessage } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import { matchesManagedMailRule } from "../src/managed-mail/search/evaluator";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;

const NOW = new Date("2026-06-29T12:00:00.000Z");

const message = (
  input: Partial<ManagedMessageRecord> = {}
): ManagedMessageRecord => ({
  bcc: null,
  bccNormalized: "",
  bodyHtml: null,
  bodyText: "Body",
  cc: null,
  ccNormalized: "",
  createdAt: NOW,
  direction: "inbound",
  from: "Sender <sender@example.com>",
  fromNormalized: "sender sender@example.com",
  headers: [],
  id: "message-1",
  inReplyTo: null,
  isRead: false,
  mailboxId: "mailbox-1",
  mailboxState: "active",
  messageHeaderId: "<message-1@example.com>",
  providerMessageId: "provider-message-1",
  rawObjectBucket: null,
  rawObjectKey: null,
  rawObjectProvider: null,
  rawSizeBytes: null,
  references: null,
  replyTo: null,
  s3Bucket: null,
  s3Key: null,
  searchText: "sender@example.com subject body",
  sentAt: NOW,
  snippet: "Body",
  subject: "Subject",
  threadId: "thread-1",
  to: "recipient@example.com",
  toNormalized: "recipient@example.com",
  updatedAt: NOW,
  ...input,
});

const matchesState = (record: ManagedMessageRecord, value: string) =>
  matchesManagedMailRule({
    attachments: [],
    matchMode: "all",
    message: record,
    now: NOW,
    search: { filters: [{ type: "is", value }], text: "" },
  });

describe("managed mail search evaluator", () => {
  test("matches active inbox and sent states by direction", () => {
    expect(matchesState(message(), "inbox")).toBeTruthy();
    expect(matchesState(message(), "sent")).toBeFalsy();
    expect(
      matchesState(message({ direction: "outbound" }), "sent")
    ).toBeTruthy();
  });

  test("matches spam and trash mailbox states", () => {
    expect(
      matchesState(message({ mailboxState: "spam" }), "spam")
    ).toBeTruthy();
    expect(
      matchesState(message({ mailboxState: "trash" }), "trash")
    ).toBeTruthy();
    expect(
      matchesState(message({ mailboxState: "trash" }), "inbox")
    ).toBeFalsy();
  });

  test("matches rule labels and headers", () => {
    expect(
      matchesManagedMailRule({
        attachments: [],
        customLabelIds: ["label-vip"],
        matchMode: "all",
        message: message({ headers: [{ name: "X-Account", value: "VIP" }] }),
        search: {
          filters: [
            { type: "label", value: "label-vip" },
            { type: "header", value: "X-Account:vip" },
          ],
          text: "",
        },
      })
    ).toBeTruthy();
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message({ headers: [{ name: "X-Account", value: "VIP" }] }),
        search: { filters: [{ type: "header", value: "X-Account" }], text: "" },
      })
    ).toBeFalsy();
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message({ headers: [{ name: "X-Account", value: "VIP" }] }),
        search: { filters: [{ type: "header", value: ":VIP" }], text: "" },
      })
    ).toBeFalsy();
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message({ headers: [{ name: "X-Account", value: "VIP" }] }),
        search: {
          filters: [{ type: "header", value: "X-Account:" }],
          text: "",
        },
      })
    ).toBeFalsy();
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message({ headers: [{ name: "X-Account", value: "VIP" }] }),
        search: {
          filters: [{ type: "header", value: "X-Account:other" }],
          text: "",
        },
      })
    ).toBeFalsy();
  });

  test("matches custom label names in rules", () => {
    expect(
      matchesManagedMailRule({
        attachments: [],
        customLabelNames: ["VIP/Important"],
        matchMode: "all",
        message: message(),
        search: {
          filters: [{ type: "label", value: "vip/important" }],
          text: "",
        },
      })
    ).toBeTruthy();
  });

  test("matches absolute and relative date conditions", () => {
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message(),
        now: NOW,
        search: { filters: [{ type: "after", value: "2026-06-28" }], text: "" },
      })
    ).toBeTruthy();
    expect(
      matchesManagedMailRule({
        attachments: [],
        matchMode: "all",
        message: message(),
        now: NOW,
        search: { filters: [{ type: "older_than", value: "1d" }], text: "" },
      })
    ).toBeFalsy();
  });
});
