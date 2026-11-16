import { describe, expect, test } from "vite-plus/test";

import {
  collaborationNoteBodySchema,
  collaborationNoteCommandSchema,
} from "../src/collaboration-notes";

const command = {
  body: "A team-only update",
  expected: {
    contextId: "ee588d0c-777d-4d55-b633-a1b61508714a",
    revision: "1",
  },
  kind: "create",
  mailboxId: "shared-mailbox",
  mentionMemberIds: ["current-member"],
  noteId: "b2529670-108d-4193-8fc1-3d4d0cb2fbad",
  threadId: "thread",
};

describe("internal note input boundary", () => {
  test("preserves multiline plaintext and accepts Unicode code points", () => {
    const body = "  A team update\n\n<script>ordinary text</script> 🐈\n";
    expect(collaborationNoteBodySchema.parse(body)).toBe(body);
    expect(
      collaborationNoteBodySchema.safeParse("🐈".repeat(6000)).success
    ).toBeTruthy();
  });

  test("rejects blank, unsupported or oversized text", () => {
    for (const body of [
      " \n\t",
      "bad\u0000text",
      "bad\uD800text",
      "x".repeat(100_000),
    ]) {
      expect(collaborationNoteBodySchema.safeParse(body).success).toBeFalsy();
    }
  });

  test("rejects injected author or actor authority and unrelated mutation fields", () => {
    expect(
      collaborationNoteCommandSchema.safeParse(command).success
    ).toBeTruthy();
    for (const extra of [
      { authorMemberId: "someone-else" },
      { userId: "someone-else" },
      { permissions: { writeOwnNotes: true } },
    ]) {
      expect(
        collaborationNoteCommandSchema.safeParse({ ...command, ...extra })
          .success
      ).toBeFalsy();
    }
    expect(
      collaborationNoteCommandSchema.safeParse({ ...command, kind: "remove" })
        .success
    ).toBeFalsy();
  });

  test("rejects duplicate participants and unprepared or lossy write cursors", () => {
    expect(
      collaborationNoteCommandSchema.safeParse({
        ...command,
        mentionMemberIds: ["member", "member"],
      }).success
    ).toBeFalsy();
    expect(
      collaborationNoteCommandSchema.safeParse({
        ...command,
        expected: undefined,
      }).success
    ).toBeFalsy();
    expect(
      collaborationNoteCommandSchema.safeParse({
        ...command,
        expected: { ...command.expected, revision: 1 },
      }).success
    ).toBeFalsy();
  });
});
