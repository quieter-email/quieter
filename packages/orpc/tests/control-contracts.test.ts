import type { MessageListItem } from "@quieter/mail/messages";
import { describe, expect, test } from "vite-plus/test";

import {
  controlContracts,
  controlErrorSchema,
  controlMailMessageSchema,
  controlOperationReceiptSchema,
  toControlMailMessage,
} from "../src/control/contracts";
import { createControlOpenApiDocument } from "../src/control/openapi";

describe("management runtime contracts", () => {
  test("rejects client identity claims while retaining one explicit resource binding", () => {
    const read = {
      mailboxId: "mailbox-a",
      organizationId: "organization-a",
      threadId: "thread-a",
    };
    expect(
      controlContracts["mail.read_thread"].input.safeParse(read).success
    ).toBeTruthy();
    expect(
      controlContracts["mail.read_thread"].input.safeParse({
        ...read,
        userId: "another-user",
      }).success
    ).toBeFalsy();
    expect(
      controlContracts["mail.read_thread"].input.safeParse({
        ...read,
        organizationId: " ",
      }).success
    ).toBeFalsy();
    expect(
      controlContracts["settings.read"].input.safeParse({ role: "owner" })
        .success
    ).toBeFalsy();
  });

  test("retains the calendar service's range and time-zone validation", () => {
    const events = {
      calendarId: "calendar-a",
      connectionId: "connection-a",
      end: "2026-11-17T10:00:00Z",
      start: "2026-11-16T10:00:00Z",
      timeZone: "Europe/Berlin",
    };
    expect(
      controlContracts["calendar.events"].input.safeParse(events).success
    ).toBeTruthy();
    for (const invalid of [
      { ...events, end: events.start },
      { ...events, end: "2028-11-17T10:00:00Z" },
      { ...events, timeZone: "not-a-time-zone" },
      { ...events, userId: "another-user" },
    ]) {
      expect(
        controlContracts["calendar.events"].input.safeParse(invalid).success
      ).toBeFalsy();
    }
  });

  test("preserves enriched mail and binds its source link without retaining credential metadata", () => {
    const message: MessageListItem = {
      attachments: [
        {
          attachmentId: "attachment-a",
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: 20,
        },
      ],
      baseRevision: "revision-a",
      bcc: "hidden@example.test",
      bodyHtml: "<p>Current message</p>",
      bodyText: "Current message",
      cc: "colleague@example.test",
      draftAnchor: {
        seededBy: "reply",
        sourceMessageHeaderId: "<source@example.test>",
        sourceMessageId: "message-original",
        sourceThreadId: "thread-original",
      },
      draftId: "draft-a",
      from: "Sender <sender@example.test>",
      id: "message/a?b",
      inReplyTo: "<source@example.test>",
      inlineImages: [
        {
          attachmentId: "image-a",
          contentId: "inline-a",
          fileName: "image.png",
          mimeType: "image/png",
          size: 12,
        },
      ],
      isImportant: true,
      isUnread: true,
      labelIds: ["label-a"],
      messageHeaderId: "<message@example.test>",
      receivedAt: "2026-11-16T10:00:00Z",
      references: "<source@example.test>",
      replyTo: "reply@example.test",
      senderAvatarUrls: {
        dark: "https://example.test/dark.png",
        light: "https://example.test/light.png",
      },
      subject: "Representative message",
      threadAttachmentCount: 1,
      threadAttachmentNames: ["notes.txt"],
      threadId: "thread/a?b",
      threadIsImportant: true,
      threadLabelIds: ["label-thread"],
      threadMessageCount: 3,
      to: "recipient@example.test",
      unsubscribeMailto: "mailto:unsubscribe@example.test",
      unsubscribeStatus: "requested",
      unsubscribeUrl: "https://example.test/unsubscribe",
    };
    const internal = {
      ...message,
      accessToken: "must-not-leak",
      apiSource: {
        canCreateMailbox: true,
        canManageMailbox: true,
        includedInMailbox: false,
        organizationId: "private-internal-row",
        senderAddress: "sender@example.test",
        senderMailboxId: null,
      },
      encryptedRefreshToken: "must-not-leak",
      unsubscribeKey: "private-action-key",
    };
    const result = toControlMailMessage({
      mailboxId: "mailbox/a?b",
      message: internal,
    });
    expect(result).toMatchObject(message);
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("encryptedRefreshToken");
    expect(result).not.toHaveProperty("apiSource");
    expect(result).not.toHaveProperty("unsubscribeKey");
    const link = new URL(result.source.href, "https://app.example.test");
    expect(link.searchParams.get("mailboxId")).toBe(result.source.mailboxId);
    expect(link.searchParams.get("threadId")).toBe(result.threadId);
    expect(link.searchParams.get("messageId")).toBe(result.id);
    expect(link.origin).toBe("https://app.example.test");
  });

  test("keeps private source and credential fields out of read results", () => {
    const result = controlContracts["calendar.accounts"].output.parse({
      accounts: [
        {
          email: "owner@example.test",
          id: "account-a",
          mailboxId: "mailbox-a",
          name: "My calendar",
          provider: "google_calendar",
          refreshToken: "must-not-leak",
          status: "connected",
        },
      ],
      privateDatabaseRow: { userId: "another-user" },
    });
    expect(result.accounts[0]).toMatchObject({
      id: "account-a",
      mailboxId: "mailbox-a",
      status: "connected",
    });
    expect(result.accounts[0]).not.toHaveProperty("refreshToken");
    expect(result.accounts[0]).not.toHaveProperty("provider");
    expect(result).not.toHaveProperty("privateDatabaseRow");
    expect(
      controlMailMessageSchema.safeParse({ id: "message", threadId: "thread" })
        .success
    ).toBeFalsy();
  });

  test("requires approval and replay references for an actual mutation request", () => {
    const request = {
      mailboxId: "mailbox-a",
      organizationId: "organization-a",
      read: true,
      threadId: "thread-a",
    };
    expect(
      controlContracts["mail.set_read"].input.safeParse(request).success
    ).toBeFalsy();
    expect(
      controlContracts["mail.set_read"].input.safeParse({
        ...request,
        approvalId: "approval-a",
        idempotencyKey: "request-a",
      }).success
    ).toBeTruthy();
    expect(
      controlContracts["organization.settings.update"].input.safeParse({
        approvalId: "approval-a",
        idempotencyKey: "request-a",
        organizationId: "organization-a",
      }).success
    ).toBeFalsy();
  });

  test("distinguishes pending and uncertain outcomes from completed or failed mutations", () => {
    const base = {
      createdAt: "2026-11-16T10:00:00Z",
      operationId: "operation-a",
    };
    const contract = controlContracts["mail.set_read"].output;
    const pending = contract.parse({ ...base, state: "pending" });
    const uncertain = contract.parse({ ...base, state: "uncertain" });
    expect(pending).not.toHaveProperty("result");
    expect(uncertain).not.toHaveProperty("completedAt");
    expect(
      contract.safeParse({ ...base, state: "succeeded" }).success
    ).toBeFalsy();
    expect(
      contract.safeParse({
        ...base,
        completedAt: "2026-11-16T10:01:00Z",
        state: "failed",
      }).success
    ).toBeFalsy();
    expect(
      contract.safeParse({
        ...base,
        completedAt: "2026-11-16T10:01:00Z",
        result: { read: true, threadId: "thread-a" },
        state: "succeeded",
      }).success
    ).toBeTruthy();
    expect(
      controlOperationReceiptSchema.safeParse({
        ...base,
        completedAt: "2026-11-16T10:01:00Z",
        state: "cancelled",
      }).success
    ).toBeTruthy();
  });

  test("projects safe errors without retaining raw request or database details", () => {
    const result = controlErrorSchema.parse({
      error: {
        code: "FORBIDDEN",
        details: { query: "private search", token: "private-token" },
        message: "Access denied.",
      },
      stack: "internal stack",
    });
    expect(result.error).toMatchObject({ code: "FORBIDDEN" });
    expect(result.error).not.toHaveProperty("details");
    expect(result).not.toHaveProperty("stack");
  });

  test("generates closed input and sanitized output definitions for explicitly selected contracts", () => {
    const document = createControlOpenApiDocument({
      operations: ["mail.read_thread"],
    });
    const read = document.paths["/api/control/mail.read_thread"];
    expect(read).toBeDefined();
    expect(document.paths).not.toHaveProperty("/api/control/mail.set_read");
    const input = read?.post.requestBody.content["application/json"].schema;
    expect(input).toHaveProperty("additionalProperties", false);
    expect(input?.required).toContain("mailboxId");
    expect(input?.required).toContain("organizationId");
    const output =
      read?.post.responses["200"].content["application/json"].schema;
    const encoded = JSON.stringify(output);
    expect(encoded).toContain('"source"');
    expect(encoded).not.toContain("encryptedRefreshToken");
    expect(encoded).not.toContain("apiSource");
  });
});
