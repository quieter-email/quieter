import type { CollaborationCursor } from "@quieter/mail/collaboration";
import { describe, expect, test } from "vite-plus/test";

import {
  initialNotesClientState,
  transitionNotesClient,
} from "./notes-session";
import type { NoteDraft } from "./notes-session";

const cursor: CollaborationCursor = {
  contextId: "a8ce9de4-f393-44bb-9c8c-ef77e25c5d87",
  revision: "1",
};
const ready = transitionNotesClient(
  transitionNotesClient(initialNotesClientState, {
    available: true,
    keepDraft: false,
    kind: "restart",
  }),
  { canWrite: true, cursor, epoch: 1, kind: "authorized" }
);
const draft: NoteDraft = {
  body: "Temporary team text",
  expected: cursor,
  kind: "edit",
  mentions: [],
  noteId: "f79638ca-fb55-49be-bfde-adfa2e559bfd",
  status: "editing",
};

describe("note draft authority and attempts", () => {
  test("an older completion cannot reopen content after reconnect or while hidden", () => {
    const closed = transitionNotesClient(ready, {
      available: false,
      keepDraft: true,
      kind: "restart",
    });
    const stale = transitionNotesClient(closed, {
      canWrite: true,
      cursor,
      epoch: 1,
      kind: "authorized",
    });
    expect(stale.authority).toBe("checking");
    const hidden = transitionNotesClient(closed, {
      canWrite: true,
      cursor,
      epoch: closed.epoch,
      kind: "authorized",
    });
    expect(hidden.authority).toBe("checking");
    expect(hidden.available).toBeFalsy();
  });

  test("polling preserves the edit body and original write revision", () => {
    const editing = transitionNotesClient(ready, {
      attempt: draft,
      epoch: 1,
      kind: "begin",
    });
    const observed = transitionNotesClient(editing, {
      canWrite: true,
      cursor: { ...cursor, revision: "2" },
      epoch: 1,
      kind: "authorized",
    });
    expect(observed.attempt).toMatchObject({
      body: draft.body,
      expected: cursor,
    });
  });

  test("a replacement generation or write-access loss discards a previous draft", () => {
    const editing = transitionNotesClient(ready, {
      attempt: draft,
      epoch: 1,
      kind: "begin",
    });
    expect(
      transitionNotesClient(editing, {
        canWrite: true,
        cursor: {
          ...cursor,
          contextId: "3161454d-650e-4db3-9146-82483a2e31e5",
        },
        epoch: 1,
        kind: "authorized",
      }).attempt
    ).toBeNull();
    expect(
      transitionNotesClient(editing, {
        canWrite: false,
        cursor,
        epoch: 1,
        kind: "authorized",
      }).attempt
    ).toBeNull();
  });

  test("uncertain saves retain the attempt identity without accepting old callbacks", () => {
    const editing = transitionNotesClient(ready, {
      attempt: { ...draft, kind: "create" },
      epoch: 1,
      kind: "begin",
    });
    const sending = transitionNotesClient(editing, { kind: "sending" });
    const closed = transitionNotesClient(sending, {
      available: true,
      keepDraft: true,
      kind: "restart",
    });
    expect(closed.attempt).toMatchObject({
      expected: cursor,
      noteId: draft.noteId,
      status: "uncertain",
    });
    const oldSave = transitionNotesClient(closed, {
      epoch: 1,
      expected: cursor,
      kind: "saved",
      noteId: draft.noteId,
    });
    expect(oldSave.attempt).not.toBeNull();
    const reopened = transitionNotesClient(closed, {
      canWrite: true,
      cursor,
      epoch: closed.epoch,
      kind: "authorized",
    });
    expect(reopened.attempt).toMatchObject({
      expected: cursor,
      noteId: draft.noteId,
    });
  });

  test("confirmed scope loss destroys temporary text and ignores subsequent editing", () => {
    const editing = transitionNotesClient(ready, {
      attempt: draft,
      epoch: 1,
      kind: "begin",
    });
    const lost = transitionNotesClient(editing, {
      epoch: 1,
      failure: "lost",
      kind: "failed",
    });
    const changed = transitionNotesClient(lost, {
      body: "Old text must not return",
      kind: "change",
    });
    expect(changed.attempt).toBeNull();
    expect(changed.authority).toBe("lost");
    expect(
      transitionNotesClient(lost, {
        canWrite: true,
        cursor,
        epoch: lost.epoch,
        kind: "authorized",
      }).authority
    ).toBe("lost");
  });

  test("a completed older attempt cannot clear a newer draft", () => {
    const editing = transitionNotesClient(ready, {
      attempt: draft,
      epoch: 1,
      kind: "begin",
    });
    const newer = transitionNotesClient(editing, {
      attempt: { ...draft, noteId: "098c740e-a219-478b-99b7-d8432d0d363a" },
      epoch: 1,
      kind: "begin",
    });
    const completed = transitionNotesClient(newer, {
      epoch: 1,
      expected: cursor,
      kind: "saved",
      noteId: draft.noteId,
    });
    expect(completed.attempt?.noteId).toBe(newer.attempt?.noteId);
    expect(completed.attempt).not.toBeNull();
  });
});
