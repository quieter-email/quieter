import { managedMailMessage } from "@quieter/database/schema";
import { describe, expect, test } from "bun:test";
import { matchesManagedMailRule } from "../src/managed-mail/search/evaluator";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;

const NOW = new Date("2026-06-29T12:00:00.000Z");

const message = (input: Partial<ManagedMessageRecord> = {}): ManagedMessageRecord => ({
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
    expect(matchesState(message(), "inbox")).toBe(true);
    expect(matchesState(message(), "sent")).toBe(false);
    expect(matchesState(message({ direction: "outbound" }), "sent")).toBe(true);
  });

  test("matches spam and trash mailbox states", () => {
    expect(matchesState(message({ mailboxState: "spam" }), "spam")).toBe(true);
    expect(matchesState(message({ mailboxState: "trash" }), "trash")).toBe(true);
    expect(matchesState(message({ mailboxState: "trash" }), "inbox")).toBe(false);
  });
});
