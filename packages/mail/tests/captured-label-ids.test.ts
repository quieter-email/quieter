import { describe, expect, test } from "vite-plus/test";

import { readCapturedLabelIds } from "../src/capture";

describe("captured label ids", () => {
  test("reads a stored json string of labels as the label list", () => {
    const stored = JSON.stringify(["SENT", "INBOX"]);
    const labelIds = readCapturedLabelIds(stored);

    expect(Array.isArray(labelIds)).toBeTruthy();
    expect(
      labelIds.some((label) => ["SENT", "DRAFT"].includes(label))
    ).toBeTruthy();
    expect(labelIds).toStrictEqual(["SENT", "INBOX"]);
  });

  test("keeps a label array", () => {
    const labelIds = readCapturedLabelIds(["INBOX", "UNREAD"]);

    expect(labelIds.some((label) => label === "SENT")).toBeFalsy();
    expect(labelIds).toStrictEqual(["INBOX", "UNREAD"]);
  });

  test("rejects a stored label value that is not a list of labels", () => {
    expect(() => readCapturedLabelIds(JSON.stringify({ INBOX: true }))).toThrow(
      TypeError
    );
  });
});
