import type {
  CollaborationCursor,
  CollaborationState,
} from "@quieter/mail/collaboration";
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

export type NotesPermissions = Pick<
  CollaborationState["permissions"],
  "writeOwnNotes" | "moderateNotes"
>;

export type NotesSnapshotReceipt = {
  epoch: number;
  snapshot: CollaborationState;
};

type NotesAuthority =
  | { kind: "checking" | "lost" | "retry" }
  | { kind: "ready"; permissions: NotesPermissions };

export type NotesClientState = {
  after: CollaborationNotesPage["next"];
  available: boolean;
  attempt: NoteDraft | NoteRemoval | null;
  authority: NotesAuthority;
  epoch: number;
};

export type NotesClientEvent =
  | { kind: "restart"; keepDraft: boolean; available: boolean }
  | {
      kind: "authorized";
      epoch: number;
      cursor: CollaborationCursor | null;
      permissions: NotesPermissions;
    }
  | {
      kind: "permissions-observed";
      epoch: number;
      cursor: CollaborationCursor | null;
      permissions: NotesPermissions;
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
        authority: { kind: "checking" },
        available: event.available,
        epoch: current.epoch + 1,
      };
    }
    case "authorized": {
      if (!current.available || current.authority.kind === "lost") {
        return current;
      }
      const attempt =
        current.attempt !== null &&
        (!event.permissions.writeOwnNotes ||
          current.attempt.expected.contextId !== event.cursor?.contextId)
          ? null
          : current.attempt;
      if (
        current.authority.kind === "ready" &&
        current.authority.permissions.writeOwnNotes ===
          event.permissions.writeOwnNotes &&
        current.authority.permissions.moderateNotes ===
          event.permissions.moderateNotes &&
        attempt === current.attempt
      ) {
        return current;
      }
      return {
        ...current,
        attempt,
        authority: { kind: "ready", permissions: event.permissions },
      };
    }
    case "permissions-observed": {
      if (!current.available || current.authority.kind === "lost") {
        return current;
      }
      const attempt =
        current.attempt !== null &&
        (!event.permissions.writeOwnNotes ||
          current.attempt.expected.contextId !== event.cursor?.contextId)
          ? null
          : current.attempt;
      if (current.authority.kind !== "ready") {
        return attempt === current.attempt ? current : { ...current, attempt };
      }
      const permissions: NotesPermissions = {
        moderateNotes:
          current.authority.permissions.moderateNotes &&
          event.permissions.moderateNotes,
        writeOwnNotes:
          current.authority.permissions.writeOwnNotes &&
          event.permissions.writeOwnNotes,
      };
      if (
        permissions.writeOwnNotes ===
          current.authority.permissions.writeOwnNotes &&
        permissions.moderateNotes ===
          current.authority.permissions.moderateNotes &&
        attempt === current.attempt
      ) {
        return current;
      }
      return {
        ...current,
        attempt,
        authority: { kind: "ready", permissions },
      };
    }
    case "failed": {
      return {
        ...current,
        attempt: event.failure === "lost" ? null : current.attempt,
        authority: { kind: event.failure },
      };
    }
    case "begin": {
      return current.authority.kind === "ready" &&
        current.authority.permissions.writeOwnNotes
        ? { ...current, attempt: event.attempt }
        : current;
    }
    case "change": {
      return current.authority.kind === "ready" &&
        current.authority.permissions.writeOwnNotes &&
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
      return current.authority.kind === "ready" &&
        current.authority.permissions.writeOwnNotes &&
        current.attempt !== null
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
  authority: { kind: "checking" },
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
