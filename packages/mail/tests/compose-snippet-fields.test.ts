import { describe, expect, test } from "vite-plus/test";

import {
  composeDraftInputSchema,
  composeMessageInputSchema,
} from "../src/compose/schema";

const draft = {
  attachments: [],
  bodyHtml: "<p>Ready</p>",
  bodyText: "Ready",
  inlineImages: [],
  localId: "snippet-draft",
  recipients: { bcc: "", cc: "", to: "reader@example.test" },
  saveStatus: "idle",
  subject: "Review",
  updatedAt: 0,
};

describe("snippet send admission", () => {
  test("drafts retain incomplete fields while send admission rejects either unresolved alternative", () => {
    for (const content of [
      { bodyHtml: "<p>{{?<strong>project</strong>}}</p>", bodyText: "Ready" },
      { bodyHtml: "<p>Ready</p>", bodyText: "{{@unknown.context}}" },
    ]) {
      const incomplete = { ...draft, ...content };
      expect(
        composeDraftInputSchema.safeParse(incomplete).success
      ).toBeTruthy();
      expect(
        composeMessageInputSchema.safeParse(incomplete).success
      ).toBeFalsy();
    }
    expect(
      composeMessageInputSchema.safeParse({
        ...draft,
        bodyHtml: "<p>Use {{name}} or \\{{?literal}} in the example.</p>",
        bodyText: "Use {{name}} or \\{{?literal}} in the example.",
      }).success
    ).toBeTruthy();
  });
});
