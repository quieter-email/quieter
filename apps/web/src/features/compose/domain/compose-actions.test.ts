import { describe, expect, test } from "vite-plus/test";

import type { MessageListItem } from "#/lib/gmail/gmail";

import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
} from "./compose-actions";
import {
  composeFormValuesToDraft,
  draftToComposeFormValues,
  shouldPersistComposeDraft,
  writeComposeFormValues,
} from "./compose-form";
import type { ComposeFormValues } from "./compose-form";
import {
  appendComposeSignature,
  createEmptyComposeDraft,
  getRenderableComposeBodyHtml,
} from "./draft";

const sourceMessage = {
  bodyHtml: "<p>Hello from Alex.</p>",
  bodyText: "Hello from Alex.",
  cc: "Casey <casey@example.com>",
  date: "2026-04-20T10:00:00.000Z",
  from: "Alex Sender <alex@example.com>",
  id: "msg-1",
  messageHeaderId: "<msg-1@example.com>",
  references: "<root@example.com>",
  subject: "Project update",
  threadId: "thread-1",
  to: "Me <me@example.com>",
} satisfies MessageListItem;

describe(buildComposeDraftFromMessageAction, () => {
  test("preserves reply metadata when saving edited inline form values on navigation", () => {
    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      message: sourceMessage,
    });
    const values = {
      ...draftToComposeFormValues(draft),
      bodyHtml: `<p>I will review this today.</p>${draft.bodyHtml}`,
      bodyText: `I will review this today.\n\n${draft.bodyText}`,
    };
    const savedDraft = composeFormValuesToDraft(values, draft);

    expect(
      shouldPersistComposeDraft({
        currentDraft: draft,
        nextDraft: savedDraft,
        values,
      })
    ).toBeTruthy();
    expect(savedDraft).toMatchObject({
      draftAnchor: draft.draftAnchor,
      recipients: draft.recipients,
      replyContext: draft.replyContext,
    });
    expect(savedDraft.bodyHtml).toContain("I will review this today.");
    expect(draft.bodyHtml).not.toContain("I will review this today.");
  });

  test("builds a reply draft that can populate the compose form", () => {
    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      message: sourceMessage,
    });

    expect(draft).toMatchObject({
      recipients: {
        bcc: "",
        cc: "",
        to: "Alex Sender <alex@example.com>",
      },
      replyContext: {
        messageHeaderId: "<msg-1@example.com>",
        references: ["<root@example.com>", "<msg-1@example.com>"],
        threadId: "thread-1",
      },
      subject: "Re: Project update",
    });
    expect(draft.bodyHtml).toContain(
      "<blockquote><p>Hello from Alex.</p></blockquote>"
    );
    const formValues = draftToComposeFormValues(draft);
    expect(formValues).toMatchObject({
      subject: "Re: Project update",
      to: "Alex Sender <alex@example.com>",
    });
    expect(formValues.bodyHtml).toContain("Hello from Alex.");
    expect(formValues.bodyText).toContain("Hello from Alex.");
  });

  test("uses saved draft content when continuing a linked reply draft", () => {
    const savedDraftMessage = {
      bodyHtml: "<p>Already started.</p>",
      bodyText: "Already started.",
      draftAnchor: {
        seededBy: "reply",
        sourceMessageId: "msg-1",
        sourceThreadId: "thread-1",
      },
      draftId: "draft-1",
      id: "draft-message-1",
      subject: "Re: Project update",
      threadId: "thread-1",
      to: "Alex Sender <alex@example.com>",
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
      bodyHtml: "<p>Already started.</p>",
      subject: "Re: Project update",
      to: "Alex Sender <alex@example.com>",
    });
    expect(
      buildComposeDraftFromSavedDraftMessage(savedDraftMessage).saveStatus
    ).toBe("saved");
  });

  test("rebuilds reply content when a linked draft has no body", () => {
    const emptyLinkedDraft = {
      draftAnchor: {
        seededBy: "reply",
        sourceMessageId: "msg-1",
        sourceThreadId: "thread-1",
      },
      draftId: "draft-empty",
      id: "draft-message-empty",
      subject: "Re: Project update",
      threadId: "thread-1",
    } satisfies MessageListItem;

    const draft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      existingDraftMessage: emptyLinkedDraft,
      message: sourceMessage,
    });

    expect(draft.draftId).toBeUndefined();
    expect(draft.bodyHtml).toContain(
      "<blockquote><p>Hello from Alex.</p></blockquote>"
    );
    expect(draft.recipients.to).toBe("Alex Sender <alex@example.com>");
  });
});

describe(appendComposeSignature, () => {
  test("adds one mailbox signature to a new draft", () => {
    const draft = appendComposeSignature(createEmptyComposeDraft(), {
      html: "<p>Alex</p>",
      text: "Alex",
    });

    expect(draft.bodyHtml).toContain('data-quieter-signature="true"');
    expect(draft.bodyHtml).toContain("<p>Alex</p>");
    expect(draft.bodyText).toBe("Alex");
  });

  test("does not duplicate an existing signature", () => {
    const draft = appendComposeSignature(
      {
        ...createEmptyComposeDraft(),
        bodyHtml:
          '<p>Hello</p><div data-quieter-signature="true"><p>Alex</p></div>',
        bodyText: "Hello\n\nAlex",
      },
      { html: "<p>Alex</p>", text: "Alex" }
    );

    expect(draft.bodyHtml.match(/data-quieter-signature/gu)).toHaveLength(1);
    expect(draft.bodyText).toBe("Hello\n\nAlex");
  });

  test("derives plain text when only an HTML signature is available", () => {
    const draft = appendComposeSignature(createEmptyComposeDraft(), {
      html: "<p>Alex Support</p>",
      text: null,
    });

    expect(draft.bodyText).toBe("Alex Support");
  });
});

describe(writeComposeFormValues, () => {
  test("writes every mounted compose field after reset", () => {
    const values: ComposeFormValues = {
      bcc: "",
      bodyHtml: "<p>Reply body</p>",
      bodyText: "Reply body",
      cc: "casey@example.com",
      subject: "Re: Project update",
      to: "alex@example.com",
    };
    const fieldWrites: [keyof ComposeFormValues, string][] = [];
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

    expect(resetWrites).toStrictEqual([values]);
    expect(fieldWrites).toStrictEqual([
      ["to", "alex@example.com"],
      ["cc", "casey@example.com"],
      ["bcc", ""],
      ["subject", "Re: Project update"],
      ["bodyHtml", "<p>Reply body</p>"],
      ["bodyText", "Reply body"],
    ]);
    expect(validateWrites).toStrictEqual(["change"]);
  });
});

describe(shouldPersistComposeDraft, () => {
  test("does not save an unchanged generated reply draft", () => {
    const currentDraft = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "me@example.com",
      message: sourceMessage,
    });

    expect(
      shouldPersistComposeDraft({
        currentDraft,
        nextDraft: currentDraft,
        values: draftToComposeFormValues(currentDraft),
      })
    ).toBeFalsy();
  });

  test("saves a new message after the user adds content", () => {
    const currentDraft = createEmptyComposeDraft();
    const values: ComposeFormValues = {
      ...draftToComposeFormValues(currentDraft),
      bodyHtml: "<p>Hello Alex.</p>",
      bodyText: "Hello Alex.",
      to: "alex@example.com",
    };
    const nextDraft = composeFormValuesToDraft(values, {
      attachments: currentDraft.attachments,
      draftAnchor: currentDraft.draftAnchor,
      draftId: currentDraft.draftId,
      errorMessage: currentDraft.errorMessage,
      inlineImages: currentDraft.inlineImages,
      lastSavedAt: currentDraft.lastSavedAt,
      localId: currentDraft.localId,
      messageId: currentDraft.messageId,
      replyContext: currentDraft.replyContext,
      saveStatus: currentDraft.saveStatus,
      updatedAt: Date.now(),
    });

    expect(
      shouldPersistComposeDraft({
        currentDraft,
        nextDraft,
        values,
      })
    ).toBeTruthy();
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
      "<p>Loaded draft body<br>Second line</p>"
    );
    expect(draftToComposeFormValues(draft).bodyHtml).toBe(
      "<p>Loaded draft body<br>Second line</p>"
    );
  });
});
