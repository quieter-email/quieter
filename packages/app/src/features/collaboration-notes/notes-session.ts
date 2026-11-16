import type { CollaborationCursor } from "@quieter/mail/collaboration";
import type {
  CollaborationNoteParticipant,
  CollaborationNotesPage,
} from "@quieter/mail/collaboration-notes";

export type NoteDraft = {
  body: string;
  expected: CollaborationCursor;
  kind: "create" | "edit";
  mentions: CollaborationNoteParticipant[];
  noteId: string;
  status: "editing" | "saving" | "uncertain" | "conflict";
};

export type NoteRemoval = {
  expected: CollaborationCursor;
  kind: "remove";
  noteId: string;
  status: "confirming" | "saving";
};

export type NotesClientState = {
  after: CollaborationNotesPage["next"];
  available: boolean;
  attempt: NoteDraft | NoteRemoval | null;
  authority: "checking" | "ready" | "lost" | "retry";
  epoch: number;
};

export type NotesClientEvent =
  | { kind: "restart"; keepDraft: boolean; available: boolean }
  | {
      kind: "authorized";
      epoch: number;
      cursor: CollaborationCursor | null;
      canWrite: boolean;
    }
  | { kind: "failed"; epoch: number; failure: "lost" | "retry" }
  | { kind: "begin"; epoch: number; attempt: NoteDraft | NoteRemoval }
  | { kind: "change"; body?: string; mentions?: CollaborationNoteParticipant[] }
  | { kind: "sending" }
  | { kind: "uncertain"; epoch: number }
  | { kind: "conflict"; epoch: number }
  | {
      kind: "saved";
      epoch: number;
      noteId: string;
      expected: CollaborationCursor;
    }
  | { kind: "cancel" }
  | { kind: "page"; after: CollaborationNotesPage["next"] };

export const transitionNotesClient = (
  current: NotesClientState,
  event: NotesClientEvent
): NotesClientState => {
  if ("epoch" in event && event.epoch !== current.epoch) {
    return current;
  }
  switch (event.kind) {
    case "restart": {
      const attempt =
        event.keepDraft && current.attempt?.kind !== "remove"
          ? current.attempt
          : null;
      return {
        after: null,
        attempt:
          attempt?.status === "saving"
            ? { ...attempt, status: "uncertain" }
            : attempt,
        authority: "checking",
        available: event.available,
        epoch: current.epoch + 1,
      };
    }
    case "authorized": {
      if (!current.available || current.authority === "lost") {
        return current;
      }
      const attempt =
        current.attempt !== null &&
        (!event.canWrite ||
          current.attempt.expected.contextId !== event.cursor?.contextId)
          ? null
          : current.attempt;
      if (current.authority === "ready" && attempt === current.attempt) {
        return current;
      }
      return { ...current, attempt, authority: "ready" };
    }
    case "failed": {
      return {
        ...current,
        attempt: event.failure === "lost" ? null : current.attempt,
        authority: event.failure,
      };
    }
    case "begin": {
      return current.authority === "ready"
        ? { ...current, attempt: event.attempt }
        : current;
    }
    case "change": {
      return current.authority === "ready" &&
        current.attempt !== null &&
        current.attempt.kind !== "remove" &&
        current.attempt.status !== "saving"
        ? {
            ...current,
            attempt: {
              ...current.attempt,
              body: event.body ?? current.attempt.body,
              mentions: event.mentions ?? current.attempt.mentions,
            },
          }
        : current;
    }
    case "sending": {
      return current.authority === "ready" && current.attempt !== null
        ? { ...current, attempt: { ...current.attempt, status: "saving" } }
        : current;
    }
    case "uncertain":
    case "conflict": {
      return {
        ...current,
        attempt:
          current.attempt !== null && current.attempt.kind !== "remove"
            ? { ...current.attempt, status: event.kind }
            : null,
      };
    }
    case "saved": {
      if (
        current.attempt?.noteId !== event.noteId ||
        current.attempt.expected.contextId !== event.expected.contextId ||
        current.attempt.expected.revision !== event.expected.revision
      ) {
        return current;
      }
      return { ...current, after: null, attempt: null };
    }
    case "cancel": {
      return { ...current, attempt: null };
    }
    case "page": {
      return { ...current, after: event.after };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
};

export const initialNotesClientState: NotesClientState = {
  after: null,
  attempt: null,
  authority: "checking",
  available: false,
  epoch: 0,
};

export const collaborationFailure = (
  error: unknown
): "lost" | "conflict" | "retry" => {
  if (typeof error !== "object" || error === null) {
    return "retry";
  }
  const code = "code" in error ? error.code : undefined;
  const status = "status" in error ? error.status : undefined;
  if (
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "NOT_FOUND" ||
    status === 401 ||
    status === 403 ||
    status === 404
  ) {
    return "lost";
  }
  return code === "CONFLICT" || status === 409 ? "conflict" : "retry";
};
