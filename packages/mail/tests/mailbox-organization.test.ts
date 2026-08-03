import { describe, expect, test } from "vite-plus/test";
import { getManagedMailboxRuleActions } from "../src/mailbox-organization";

describe("getManagedMailboxRuleActions", () => {
  test("treats an explicit empty action list as authoritative", () => {
    expect(getManagedMailboxRuleActions({ actions: [], labelIds: ["legacy-label"] })).toEqual([]);
  });

  test("synthesizes legacy label actions only when actions are absent", () => {
    expect(getManagedMailboxRuleActions({ labelIds: ["legacy-label"] })).toEqual([
      { addIds: ["legacy-label"], kind: "set-labels", removeIds: [] },
    ]);
  });
});
