import { describe, expect, test } from "bun:test";
import type { MessageListItem } from "~/lib/gmail/gmail";
import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
} from "./compose-actions";
import {
  draftToComposeFormValues,
  writeComposeFormValues,
  type ComposeFormValues,
} from "./compose-form";
import { createEmptyComposeDraft, getRenderableComposeBodyHtml } from "./draft";

const sourceMessage = {
  id: "msg-1",
  threadId: "thread-1",
  from: "Alex Sender <alex@example.com>",
  to: "Me <me@example.com>",
  cc: "Casey <casey@example.com>",
  subject: "Project update",
  messageHeaderId: "<msg-1@example.com>",
  references: "<root@example.com>",
  date: "2026-04-20T10:00:00.000Z",
  bodyHtml: "<p>Hello from Alex.</p>",
  bodyText: "Hello from Alex.",
} satisfies MessageListItem;

describe("buildComposeDraftFromMessageAction", () => {
  test("builds a reply draft that can populate the compose form", () => {
    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      message: sourceMessage,
    });

    expect(draft.recipients).toEqual({
      to: "Alex Sender <alex@example.com>",
      cc: "",
      bcc: "",
    });
    expect(draft.subject).toBe("Re: Project update");
    expect(draft.bodyHtml).toContain("<blockquote><p>Hello from Alex.</p></blockquote>");
    expect(draft.replyContext).toEqual({
      threadId: "thread-1",
      messageHeaderId: "<msg-1@example.com>",
      references: ["<root@example.com>", "<msg-1@example.com>"],
    });
    expect(draftToComposeFormValues(draft)).toMatchObject({
      to: "Alex Sender <alex@example.com>",
      subject: "Re: Project update",
      bodyHtml: expect.stringContaining("Hello from Alex."),
      bodyText: expect.stringContaining("Hello from Alex."),
    });
  });

  test("uses saved draft content when continuing a linked reply draft", () => {
    const savedDraftMessage = {
      id: "draft-message-1",
      threadId: "thread-1",
      draftId: "draft-1",
      to: "Alex Sender <alex@example.com>",
      subject: "Re: Project update",
      bodyHtml: "<p>Already started.</p>",
      bodyText: "Already started.",
      draftAnchor: {
        seededBy: "reply",
        sourceMessageId: "msg-1",
        sourceThreadId: "thread-1",
      },
    } satisfies MessageListItem;

    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      existingDraftMessage: savedDraftMessage,
      message: sourceMessage,
    });

    expect(draft.draftId).toBe("draft-1");
    expect(draft.messageId).toBe("draft-message-1");
    expect(draft.bodyHtml).toBe("<p>Already started.</p>");
    expect(draftToComposeFormValues(draft)).toMatchObject({
      to: "Alex Sender <alex@example.com>",
      subject: "Re: Project update",
      bodyHtml: "<p>Already started.</p>",
    });
    expect(buildComposeDraftFromSavedDraftMessage(savedDraftMessage).saveStatus).toBe("saved");
  });
});

describe("writeComposeFormValues", () => {
  test("writes every mounted compose field after reset", () => {
    const values: ComposeFormValues = {
      to: "alex@example.com",
      cc: "casey@example.com",
      bcc: "",
      subject: "Re: Project update",
      bodyHtml: "<p>Reply body</p>",
      bodyText: "Reply body",
    };
    const fieldWrites: Array<[keyof ComposeFormValues, string]> = [];
    const resetWrites: ComposeFormValues[] = [];
    const validateWrites: string[] = [];
    const form = {
      reset: (nextValues: ComposeFormValues) => {
        resetWrites.push(nextValues);
      },
      setFieldValue: (field: keyof ComposeFormValues, value: string) => {
        fieldWrites.push([field, value]);
      },
      validateAllFields: (cause: "change") => {
        validateWrites.push(cause);
      },
    };

    writeComposeFormValues(form, values);

    expect(resetWrites).toEqual([values]);
    expect(fieldWrites).toEqual([
      ["to", "alex@example.com"],
      ["cc", "casey@example.com"],
      ["bcc", ""],
      ["subject", "Re: Project update"],
      ["bodyHtml", "<p>Reply body</p>"],
      ["bodyText", "Reply body"],
    ]);
    expect(validateWrites).toEqual(["change"]);
  });
});

describe("draft body rendering", () => {
  test("uses text content when loaded draft html is blank", () => {
    const draft = {
      ...createEmptyComposeDraft(),
      bodyHtml: "<p></p>",
      bodyText: "Loaded draft body\nSecond line",
    };

    expect(getRenderableComposeBodyHtml(draft.bodyHtml, draft.bodyText)).toBe(
      "<p>Loaded draft body<br>Second line</p>",
    );
    expect(draftToComposeFormValues(draft).bodyHtml).toBe(
      "<p>Loaded draft body<br>Second line</p>",
    );
  });
});
