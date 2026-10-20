import { describe, expect, test } from "vite-plus/test";

import {
  getManagedMailboxRuleActions,
  mailboxLabelColorSchema,
} from "../src/mailbox-organization";

describe("label color validation", () => {
  test("accepts custom colors while retaining existing named colors", () => {
    for (const color of ["#3a789c", "#A1B2C3", "gray", "green"]) {
      expect(mailboxLabelColorSchema.safeParse(color).success).toBeTruthy();
    }
  });

  test("rejects malformed colors and CSS expressions", () => {
    for (const color of [
      "#abc",
      "#12345g",
      "#12345678",
      "red; color: transparent",
      "var(--fg)",
      "url(https://example.com)",
    ]) {
      expect(mailboxLabelColorSchema.safeParse(color).success).toBeFalsy();
    }
  });
});

describe(getManagedMailboxRuleActions, () => {
  test("treats an explicit empty action list as authoritative", () => {
    expect(
      getManagedMailboxRuleActions({ actions: [], labelIds: ["legacy-label"] })
    ).toStrictEqual([]);
  });

  test("synthesizes legacy label actions only when actions are absent", () => {
    expect(
      getManagedMailboxRuleActions({ labelIds: ["legacy-label"] })
    ).toStrictEqual([
      { addIds: ["legacy-label"], kind: "set-labels", removeIds: [] },
    ]);
  });
});
