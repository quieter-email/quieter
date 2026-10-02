import { describe, expect, it } from "vite-plus/test";

import { restoreComposeDraft } from "./draft-recovery";

const draft = {
  attachments: [],
  bodyHtml: "<p>Unfinished text</p>",
  bodyText: "Unfinished text",
  errorMessage: null,
  inlineImages: [],
  localId: "local",
  recipients: { bcc: "", cc: "", to: "unfinished@" },
  saveStatus: "idle",
  subject: "Work",
  updatedAt: 1,
};

describe("compose recovery", () => {
  it("preserves incomplete recipients without validating a send", () => {
    expect(
      restoreComposeDraft(JSON.stringify(draft), "editor", 42)
    ).toMatchObject({
      bodyText: draft.bodyText,
      recipients: { to: "unfinished@" },
      recoveryEditorId: "editor",
      recoveryUpdatedAt: 42,
    });
  });

  it("keeps remote attachments and asks for missing local files", () => {
    const recovered = restoreComposeDraft(
      JSON.stringify({
        ...draft,
        attachments: [
          {
            id: "local",
            isInline: false,
            mimeType: "text/plain",
            name: "notes.txt",
            size: 1,
          },
          {
            gmailAttachmentId: "saved",
            id: "remote",
            isInline: false,
            mimeType: "text/plain",
            name: "saved.txt",
            size: 1,
          },
        ],
        bodyHtml: '<p>Text</p><img src="blob:lost">',
      }),
      "editor"
    );
    expect(recovered.attachments).toHaveLength(1);
    expect(recovered.bodyHtml).toBe("<p>Text</p>");
    expect(recovered.errorMessage).toContain("notes.txt");
  });

  it("does not silently retry a send interrupted by closing the tab", () => {
    const recovered = restoreComposeDraft(
      JSON.stringify({ ...draft, saveStatus: "sending" }),
      "editor"
    );
    expect(recovered.saveStatus).toBe("error");
    expect(recovered.errorMessage).toContain("Check Sent");
  });
});
