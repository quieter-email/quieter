"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import type { CollaborationScope } from "@quieter/mail/collaboration";
import { collaborationNoteBodySchema } from "@quieter/mail/collaboration-notes";
import { ActionFooter } from "@quieter/ui/action-footer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { useId } from "react";

import { NoteParticipants } from "./note-participants";
import { useThreadNotes } from "./notes-query";
import { transitionNotesClient } from "./notes-session";

const ThreadNotesScope = ({ mailboxId, threadId }: CollaborationScope) => {
  const notes = useThreadNotes({ mailboxId, threadId });
  const id = useId();
  const { timeFormat } = useDateTimePreferences();
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    hour12: timeFormat === "12h",
    timeStyle: "short",
  });
  const { attempt } = notes.client;
  const cursor =
    notes.page?.snapshot.state.kind === "prepared"
      ? notes.page.snapshot.state.cursor
      : null;
  const currentCursor =
    notes.snapshot?.state.kind === "prepared"
      ? notes.snapshot.state.cursor
      : null;
  const stale =
    attempt !== null &&
    (currentCursor === null ||
      attempt.expected.contextId !== currentCursor.contextId ||
      attempt.expected.revision !== currentCursor.revision);
  const bodyValid =
    attempt !== null &&
    attempt.kind !== "remove" &&
    collaborationNoteBodySchema.safeParse(attempt.body).success;
  return (
    <Surface data-internal-notes>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <Text as="h3" size="sm" weight="normal">
              Internal notes
            </Text>
            <Text size="caption" tone="muted">
              Visible to authorized teammates. Notes are never email replies.
            </Text>
          </div>
          {notes.visible && notes.canWrite ? (
            <Button
              disabled={attempt !== null || notes.writing}
              onClick={() => {
                void notes.startCreate();
              }}
              size="sm"
            >
              Add internal note
            </Button>
          ) : null}
        </div>
        {notes.visible ? (
          <>
            {notes.canWrite ? null : (
              <Text size="caption" tone="muted">
                You can read team notes. Reply access is required to add a note.
              </Text>
            )}
            {notes.snapshot?.state.kind === "prepared" &&
            notes.page === undefined ? (
              <Text size="sm" tone="muted">
                Loading notes...
              </Text>
            ) : null}
            {notes.snapshot?.state.kind === "unprepared" ||
            notes.page?.notes.length === 0 ? (
              <Text size="sm" tone="muted">
                No internal notes yet.
              </Text>
            ) : null}
            <div className="space-y-4">
              {notes.page?.notes.map((note) => (
                <article
                  aria-label="Internal note"
                  className="space-y-2"
                  key={note.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text as="span" size="caption">
                        {note.author.kind === "member"
                          ? note.author.name
                          : "Former teammate"}
                      </Text>
                      <Text as="span" size="caption" tone="muted">
                        <time dateTime={note.createdAt}>
                          {dateFormat.format(new Date(note.createdAt))}
                        </time>
                      </Text>
                      {note.updatedAt === note.createdAt ? null : (
                        <Text as="span" size="caption" tone="muted">
                          Edited
                        </Text>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {note.actions.edit &&
                      notes.canWrite &&
                      cursor !== null ? (
                        <Button
                          disabled={attempt !== null}
                          onClick={() => {
                            notes.startEdit(note, cursor);
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          Edit
                        </Button>
                      ) : null}
                      {note.actions.remove &&
                      (notes.canModerate ||
                        (note.actions.edit && notes.canWrite)) &&
                      cursor !== null ? (
                        <Button
                          disabled={attempt !== null}
                          onClick={() => {
                            notes.startRemove(note, cursor);
                          }}
                          size="sm"
                          variant="destructive"
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <Text
                    className="wrap-break-word whitespace-pre-wrap"
                    size="sm"
                  >
                    {note.body}
                  </Text>
                  {note.mentions.length > 0 ? (
                    <Text size="caption" tone="muted">
                      Notified{" "}
                      {note.mentions.map((person) => person.name).join(", ")}
                    </Text>
                  ) : null}
                </article>
              ))}
            </div>
            {notes.after !== undefined || notes.page?.next ? (
              <ActionFooter>
                {notes.after === undefined ? null : (
                  <Button
                    onClick={() => {
                      notes.store.setState((state) =>
                        transitionNotesClient(state, {
                          after: null,
                          kind: "page",
                        })
                      );
                    }}
                    variant={notes.page?.next ? "secondary" : undefined}
                  >
                    Latest notes
                  </Button>
                )}
                {notes.page?.next ? (
                  <Button
                    onClick={() => {
                      const next = notes.page?.next;
                      if (next) {
                        notes.store.setState((state) =>
                          transitionNotesClient(state, {
                            after: next,
                            kind: "page",
                          })
                        );
                      }
                    }}
                  >
                    Earlier notes
                  </Button>
                ) : null}
              </ActionFooter>
            ) : null}
            {notes.draftVisible &&
            attempt !== null &&
            attempt.kind !== "remove" ? (
              <form
                className="space-y-3"
                onKeyDownCapture={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (bodyValid && !stale && !notes.writing) {
                    notes.save();
                  }
                }}
              >
                <Field>
                  <FieldLabel htmlFor={id}>Internal note</FieldLabel>
                  <Textarea
                    disabled={notes.writing}
                    id={id}
                    maxLength={20_000}
                    onChange={(event) => {
                      const body = event.currentTarget.value;
                      notes.store.setState((state) =>
                        transitionNotesClient(state, { body, kind: "change" })
                      );
                    }}
                    placeholder="Write an internal note for your teammates"
                    required
                    value={attempt.body}
                    variant="composer"
                  />
                </Field>
                <NoteParticipants
                  disabled={notes.writing}
                  epoch={notes.epoch}
                  onAccessLost={() => {
                    notes.loseAccess({ mailboxId, threadId });
                  }}
                  onChange={(mentions) => {
                    notes.store.setState((state) =>
                      transitionNotesClient(state, { kind: "change", mentions })
                    );
                  }}
                  prefix={notes.prefix}
                  scope={{ mailboxId, threadId }}
                  selected={attempt.mentions}
                />
                {stale || attempt.status === "conflict" ? (
                  <div className="space-y-2">
                    <Text size="sm" tone="muted">
                      Notes changed while you were editing. Your unsaved text is
                      kept here.
                    </Text>
                    {attempt.kind === "edit" ? (
                      <>
                        <Text size="caption" tone="muted">
                          Reloading replaces your unsaved changes with the
                          latest note.
                        </Text>
                        <Button
                          onClick={() => {
                            void notes.reloadAttempt();
                          }}
                          variant="secondary"
                        >
                          Reload latest note
                        </Button>
                      </>
                    ) : (
                      <Text size="caption" tone="muted">
                        Review the latest notes, then cancel this draft and
                        start a new note if needed.
                      </Text>
                    )}
                  </div>
                ) : null}
                {attempt.status === "uncertain" ? (
                  <Text size="sm" tone="muted">
                    The save could not be confirmed. Retrying keeps the same
                    note attempt.
                  </Text>
                ) : null}
                {!bodyValid && attempt.body.length > 0 ? (
                  <Text size="caption" tone="destructive">
                    Write valid plain text within 10,000 characters.
                  </Text>
                ) : null}
                <ActionFooter>
                  <Button
                    disabled={notes.writing}
                    onClick={() => {
                      notes.store.setState((state) =>
                        transitionNotesClient(state, { kind: "cancel" })
                      );
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      !bodyValid ||
                      stale ||
                      notes.writing ||
                      attempt.status === "conflict"
                    }
                    pending={notes.writing}
                    type="submit"
                  >
                    {attempt.kind === "create" ? "Add note" : "Save note"}
                  </Button>
                </ActionFooter>
              </form>
            ) : null}
            {attempt !== null &&
            attempt.kind !== "create" &&
            !notes.draftVisible ? (
              <div className="space-y-2">
                <Text size="sm" tone="muted">
                  {notes.validationFailed
                    ? "This note could not be checked."
                    : "Checking access to this note..."}
                </Text>
                <ActionFooter>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      notes.store.setState((state) =>
                        transitionNotesClient(state, { kind: "cancel" })
                      );
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      notes.restart(true);
                    }}
                  >
                    Check again
                  </Button>
                </ActionFooter>
              </div>
            ) : null}
            {notes.snapshot === undefined ? null : (
              <Button
                onClick={() => {
                  const href = notes.snapshot?.href;
                  if (href) {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(
                          new URL(href, window.location.origin).toString()
                        );
                      } catch (error) {
                        toastError(error, {
                          boundary: "internal-note-link-copy",
                          report: !(
                            error instanceof DOMException &&
                            error.name === "NotAllowedError"
                          ),
                        });
                      }
                    })();
                  }
                }}
                size="sm"
                variant="secondary"
              >
                Copy conversation link
              </Button>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <Text size="sm" tone="muted">
              {notes.client.authority === "lost"
                ? "These notes are not available with your current access."
                : "Checking access to notes..."}
            </Text>
            {notes.client.authority === "lost" ||
            notes.client.authority === "retry" ? (
              <Button
                onClick={() => {
                  notes.restart(true);
                }}
                variant="secondary"
              >
                Reload notes
              </Button>
            ) : null}
          </div>
        )}
        <AlertDialog
          open={notes.draftVisible && attempt?.kind === "remove"}
          onOpenChange={(open) => {
            if (!open && !notes.writing) {
              notes.store.setState((state) =>
                transitionNotesClient(state, { kind: "cancel" })
              );
            }
          }}
        >
          <AlertDialogContent>
            <div className="space-y-4">
              <AlertDialogTitle>Delete this internal note?</AlertDialogTitle>
              <AlertDialogDescription>
                Its text and mention notifications will be removed for the team.
              </AlertDialogDescription>
              <ActionFooter>
                <Button
                  disabled={notes.writing}
                  onClick={() => {
                    notes.store.setState((state) =>
                      transitionNotesClient(state, { kind: "cancel" })
                    );
                  }}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={notes.writing || stale}
                  onClick={() => {
                    notes.save();
                  }}
                  pending={notes.writing}
                  variant="destructive"
                >
                  Delete note
                </Button>
              </ActionFooter>
              {stale ? (
                <Text size="sm" tone="muted">
                  Notes changed. Cancel and review the latest notes before
                  deleting.
                </Text>
              ) : null}
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Surface>
  );
};

export const ThreadNotes = ({ mailboxId, threadId }: CollaborationScope) => (
  <ThreadNotesScope
    key={JSON.stringify([mailboxId, threadId])}
    mailboxId={mailboxId}
    threadId={threadId}
  />
);
