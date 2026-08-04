import { describe, expect, test } from "vite-plus/test";
import { getGmailMailboxDisplayName } from "../src/mailbox/display-name";

describe("getGmailMailboxDisplayName", () => {
  test("uses Gmail when no custom name is stored", () => {
    expect(getGmailMailboxDisplayName(null, "person@gmail.com")).toBe("Gmail");
  });

  test("replaces legacy address names with Gmail", () => {
    expect(getGmailMailboxDisplayName(" PERSON@GMAIL.COM ", "person@gmail.com")).toBe("Gmail");
  });

  test("keeps a custom name", () => {
    expect(getGmailMailboxDisplayName("Personal", "person@gmail.com")).toBe("Personal");
  });
});
