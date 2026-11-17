import { describe, expect, test } from "vite-plus/test";

import {
  collaborationChangesInputSchema,
  collaborationCursorSchema,
  collaborationScopeSchema,
  compareCollaborationCursor,
} from "../src/collaboration";

const cursor = collaborationCursorSchema.parse({
  contextId: "3aebba3a-dae7-41a0-a047-cba5712f87dc",
  revision: "9007199254740993",
});

describe("collaboration reconnect cursors", () => {
  test("detects revision changes beyond JavaScript's safe integer range", () => {
    expect(
      compareCollaborationCursor(
        { cursor, kind: "prepared" },
        { ...cursor, revision: "9007199254740992" }
      )
    ).toMatchObject({ changed: true, reset: false });
    expect(
      compareCollaborationCursor({ cursor, kind: "prepared" }, cursor)
    ).toMatchObject({ changed: false, reset: false });
  });

  test("resets data when the conversation generation is replaced or removed", () => {
    expect(
      compareCollaborationCursor(
        {
          cursor: {
            contextId: "bb653d91-398b-4b7c-b57b-2cfabf226ae3",
            revision: "1",
          },
          kind: "prepared",
        },
        cursor
      )
    ).toMatchObject({ changed: true, reset: true });
    expect(
      compareCollaborationCursor({ kind: "unprepared" }, cursor)
    ).toMatchObject({ changed: true, reset: true });
  });

  test("forces a fresh read for an impossible future cursor", () => {
    expect(
      compareCollaborationCursor(
        { cursor: { ...cursor, revision: "2" }, kind: "prepared" },
        { ...cursor, revision: "3" }
      )
    ).toMatchObject({ changed: true, reset: true });
    expect(compareCollaborationCursor({ kind: "unprepared" })).toMatchObject({
      changed: true,
      reset: false,
    });
  });

  test("rejects actor injection and malformed cursors at the RPC boundary", () => {
    const scope = { mailboxId: "shared-box", threadId: "thread-1" };
    expect(
      collaborationScopeSchema.safeParse({ ...scope, userId: "another-user" })
        .success
    ).toBeFalsy();
    expect(
      collaborationChangesInputSchema.safeParse({
        ...scope,
        after: { ...cursor, revision: "-1" },
      }).success
    ).toBeFalsy();
    expect(
      collaborationChangesInputSchema.safeParse({
        ...scope,
        after: { ...cursor, mailboxId: "other-box" },
      }).success
    ).toBeFalsy();
  });
});
