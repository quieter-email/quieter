import { describe, expect, test } from "vite-plus/test";

import { getChatSlashCommand, getChatSlashItems } from "./chat-slash-commands";

describe("chat slash commands", () => {
  test("finds only the slash fragment before the caret", () => {
    const prefix = "First line\nKeep this: ";
    const fragment = "/snippet launch checklist";
    const caret = prefix.length + fragment.length;
    expect(
      getChatSlashCommand(`${prefix}${fragment} and keep this`, caret, caret)
    ).toMatchObject({
      from: prefix.length,
      kind: "snippet",
      query: "launch checklist",
      to: caret,
    });
  });

  test("leaves links, paths, and selected text alone", () => {
    for (const value of ["https://example.test/path", "Open /tmp/report.txt"]) {
      expect(getChatSlashCommand(value, value.length, value.length)).toBeNull();
    }
    expect(getChatSlashCommand("/model", 0, 6)).toBeNull();
  });

  test("filters model choices and allows a single matching result", () => {
    const value = "/model automatic";
    const command = getChatSlashCommand(value, value.length, value.length);
    if (command === null) {
      throw new Error("Expected a model command");
    }
    expect(getChatSlashItems(command, [])).toMatchObject([
      { kind: "model", model: "auto" },
    ]);
  });

  test("finds snippets by name and inserts their plain-text lines", () => {
    const value = "/LaunchCheck";
    const command = getChatSlashCommand(value, value.length, value.length);
    if (command === null) {
      throw new Error("Expected a snippet search");
    }
    expect(
      getChatSlashItems(command, [
        {
          bodyText: "Check the dates.\r\nList open items.",
          id: "a",
          name: "Launch checklist",
        },
        { bodyText: "Reply to the team.", id: "b", name: "Follow-up" },
      ])
    ).toMatchObject([
      { kind: "snippet", text: "Check the dates.\nList open items." },
    ]);
  });
});
