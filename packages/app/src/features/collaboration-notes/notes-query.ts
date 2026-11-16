"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type {
  CollaborationCursor,
  CollaborationScope,
} from "@quieter/mail/collaboration";
import type {
  CollaborationNote,
  CollaborationNoteCommand,
} from "@quieter/mail/collaboration-notes";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { collaborationFailure, transitionNotesClient } from "./notes-session";
import { useNotesSession } from "./use-notes-session";

export const useThreadNotes = ({ mailboxId, threadId }: CollaborationScope) => {
  const { client, store, prefix, queryClient, restart, loseAccess } =
    useNotesSession({
      mailboxId,
      threadId,
    });
  const { epoch } = client;
  const authorityKey = useMemo(
    () => [...prefix, "authority", epoch],
    [epoch, prefix]
  );
  const preparing = useMutation({
    mutationFn: async (_epoch: number) =>
      await rpc.collaboration.prepare({ mailboxId, threadId }),
    mutationKey: [...prefix, "prepare"],
    onSuccess: async (prepared, activeEpoch) => {
      await queryClient.cancelQueries({
        queryKey: [...prefix, "authority", activeEpoch],
      });
      if (store.get().epoch === activeEpoch) {
        queryClient.setQueryData(
          [...prefix, "authority", activeEpoch],
          prepared
        );
      }
    },
  });
  const authority = useQuery({
    enabled: client.available && !preparing.isPending,
    queryFn: async ({ signal }) =>
      await rpc.collaboration.get({ mailboxId, threadId }, { signal }),
    queryKey: authorityKey,
    refetchInterval: 6000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (
      authority.isSuccess &&
      !authority.isFetching &&
      authority.data !== undefined
    ) {
      const snapshot = authority.data;
      store.setState((current) =>
        transitionNotesClient(current, {
          canWrite: snapshot.permissions.writeOwnNotes,
          cursor:
            snapshot.state.kind === "prepared" ? snapshot.state.cursor : null,
          epoch,
          kind: "authorized",
        })
      );
    } else if (authority.isError) {
      const kind = collaborationFailure(authority.error);
      if (kind === "lost") {
        loseAccess({ mailboxId, threadId });
        return;
      }
      const key = [...prefix, "private"];
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.removeQueries({ queryKey: key });
      store.setState((current) =>
        transitionNotesClient(current, {
          epoch,
          failure: "retry",
          kind: "failed",
        })
      );
    }
  }, [
    authority.data,
    authority.dataUpdatedAt,
    authority.error,
    authority.isError,
    authority.isFetching,
    authority.isSuccess,
    epoch,
    loseAccess,
    mailboxId,
    prefix,
    queryClient,
    store,
    threadId,
  ]);

  const snapshot = authority.data;
  const cursor =
    snapshot?.state.kind === "prepared" ? snapshot.state.cursor : null;
  const after =
    client.after !== null &&
    cursor !== null &&
    client.after.contextId === cursor.contextId &&
    client.after.revision === cursor.revision
      ? client.after
      : undefined;
  const page = useQuery({
    enabled:
      client.available && client.authority === "ready" && cursor !== null,
    queryFn: async ({ signal }) =>
      await rpc.collaboration.notes.list(
        {
          mailboxId,
          threadId,
          ...(cursor === null ? {} : { at: cursor }),
          ...(after === undefined ? {} : { after }),
        },
        { signal }
      ),
    queryKey: [
      ...prefix,
      "private",
      "notes",
      cursor?.contextId,
      cursor?.revision,
      snapshot?.role,
      epoch,
      after,
    ],
    refetchInterval: 6000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (!page.isError) {
      return;
    }
    const failure = collaborationFailure(page.error);
    if (failure === "lost") {
      loseAccess({ mailboxId, threadId });
    } else if (failure === "conflict") {
      restart(true);
    } else {
      store.setState((current) =>
        transitionNotesClient(current, {
          epoch,
          failure: "retry",
          kind: "failed",
        })
      );
    }
  }, [
    epoch,
    loseAccess,
    mailboxId,
    page.error,
    page.isError,
    restart,
    store,
    threadId,
  ]);

  const { attempt } = client;
  const validation = useQuery({
    enabled:
      client.available &&
      client.authority === "ready" &&
      attempt !== null &&
      (attempt.kind === "edit" ||
        (attempt.kind === "create" && attempt.status === "uncertain")),
    queryFn: async ({ signal }) => {
      if (attempt === null) {
        throw new Error("No note is being reviewed.");
      }
      return await rpc.collaboration.notes.get(
        {
          contextId: attempt.expected.contextId,
          mailboxId,
          noteId: attempt.noteId,
          threadId,
        },
        { signal }
      );
    },
    queryKey: [
      ...prefix,
      "private",
      "attempt",
      epoch,
      attempt?.noteId,
      attempt?.expected.contextId,
      attempt?.expected.revision,
    ],
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (validation.isError) {
      const failure = collaborationFailure(validation.error);
      if (failure === "lost") {
        loseAccess({ mailboxId, threadId });
      }
      return;
    }
    if (
      validation.data === undefined ||
      attempt === null ||
      attempt.kind === "remove"
    ) {
      return;
    }
    if (
      attempt.kind === "edit" &&
      (validation.data.note === null || !validation.data.note.actions.edit)
    ) {
      store.setState((current) =>
        transitionNotesClient(current, { kind: "cancel" })
      );
    }
    if (
      attempt.kind === "create" &&
      attempt.status === "uncertain" &&
      validation.data.note !== null
    ) {
      const { note } = validation.data;
      if (
        note.actions.edit &&
        note.body === attempt.body &&
        note.mentions
          .map((mention) => mention.memberId)
          .toSorted()
          .join(",") ===
          attempt.mentions
            .map((mention) => mention.memberId)
            .toSorted()
            .join(",")
      ) {
        store.setState((current) =>
          transitionNotesClient(current, {
            epoch,
            expected: attempt.expected,
            kind: "saved",
            noteId: attempt.noteId,
          })
        );
        queryClient.setQueryData(authorityKey, validation.data.snapshot);
        void queryClient.invalidateQueries({
          queryKey: [...prefix, "private", "notes"],
        });
      } else {
        store.setState((current) =>
          transitionNotesClient(current, { epoch, kind: "conflict" })
        );
      }
    }
  }, [
    attempt,
    authorityKey,
    epoch,
    loseAccess,
    mailboxId,
    prefix,
    queryClient,
    restart,
    store,
    threadId,
    validation.data,
    validation.error,
    validation.isError,
  ]);

  const writing = useMutation({
    mutationFn: async ({
      command,
    }: {
      command: CollaborationNoteCommand;
      epoch: number;
    }) => await rpc.collaboration.notes.mutate(command),
    onError: (error, active) => {
      if (store.get().epoch !== active.epoch) {
        return;
      }
      const failure = collaborationFailure(error);
      toastError(error, { boundary: "internal-note-save" });
      if (failure === "lost") {
        loseAccess({ mailboxId, threadId });
        return;
      }
      store.setState((current) =>
        transitionNotesClient(current, {
          epoch: active.epoch,
          kind: failure === "conflict" ? "conflict" : "uncertain",
        })
      );
      restart(true);
    },
    onSuccess: async (result, active) => {
      if (store.get().epoch !== active.epoch) {
        return;
      }
      store.setState((current) =>
        transitionNotesClient(current, {
          epoch: active.epoch,
          expected: active.command.expected,
          kind: "saved",
          noteId: active.command.noteId,
        })
      );
      queryClient.setQueryData(
        [...prefix, "authority", active.epoch],
        result.snapshot
      );
      await queryClient.invalidateQueries({ queryKey: [...prefix, "private"] });
    },
  });

  const startCreate = async () => {
    const active = store.get();
    if (
      active.authority !== "ready" ||
      active.attempt !== null ||
      queryClient.isMutating({ mutationKey: [...prefix, "prepare"] }) > 0
    ) {
      return;
    }
    const activeEpoch = active.epoch;
    try {
      const prepared =
        snapshot?.state.kind === "prepared"
          ? snapshot
          : await preparing.mutateAsync(activeEpoch);
      if (
        store.get().epoch !== activeEpoch ||
        prepared.state.kind !== "prepared" ||
        !prepared.permissions.writeOwnNotes
      ) {
        return;
      }
      const expected = prepared.state.cursor;
      queryClient.setQueryData(authorityKey, prepared);
      store.setState((current) =>
        transitionNotesClient(current, {
          canWrite: prepared.permissions.writeOwnNotes,
          cursor: expected,
          epoch: activeEpoch,
          kind: "authorized",
        })
      );
      store.setState((current) =>
        transitionNotesClient(current, {
          attempt: {
            body: "",
            expected,
            kind: "create",
            mentions: [],
            noteId: crypto.randomUUID(),
            status: "editing",
          },
          epoch: activeEpoch,
          kind: "begin",
        })
      );
    } catch (error) {
      if (store.get().epoch === activeEpoch) {
        toastError(error, { boundary: "internal-note-prepare" });
        if (collaborationFailure(error) === "lost") {
          loseAccess({ mailboxId, threadId });
        } else {
          restart(true);
        }
      }
    }
  };

  const startEdit = (
    note: CollaborationNote,
    expected: CollaborationCursor
  ) => {
    store.setState((current) =>
      transitionNotesClient(current, {
        attempt: {
          body: note.body,
          expected,
          kind: "edit",
          mentions: note.mentions,
          noteId: note.id,
          status: "editing",
        },
        epoch: current.epoch,
        kind: "begin",
      })
    );
  };
  const startRemove = (
    note: CollaborationNote,
    expected: CollaborationCursor
  ) => {
    store.setState((current) =>
      transitionNotesClient(current, {
        attempt: {
          expected,
          kind: "remove",
          noteId: note.id,
          status: "confirming",
        },
        epoch: current.epoch,
        kind: "begin",
      })
    );
  };

  const save = () => {
    const active = store.get();
    const pending = active.attempt;
    if (
      pending === null ||
      pending.status === "saving" ||
      active.authority !== "ready"
    ) {
      return;
    }
    const common = {
      expected: pending.expected,
      mailboxId,
      noteId: pending.noteId,
      threadId,
    };
    const command: CollaborationNoteCommand =
      pending.kind === "remove"
        ? { ...common, kind: "remove" }
        : {
            ...common,
            body: pending.body,
            kind: pending.kind,
            mentionMemberIds: pending.mentions.map(
              (mention) => mention.memberId
            ),
          };
    store.setState((current) =>
      transitionNotesClient(current, { kind: "sending" })
    );
    writing.mutate({ command, epoch: active.epoch });
  };

  const reloadAttempt = async () => {
    const active = store.get();
    if (active.attempt?.kind !== "edit") {
      return;
    }
    try {
      const result = await rpc.collaboration.notes.get({
        contextId: active.attempt.expected.contextId,
        mailboxId,
        noteId: active.attempt.noteId,
        threadId,
      });
      if (store.get().epoch !== active.epoch) {
        return;
      }
      queryClient.setQueryData(authorityKey, result.snapshot);
      if (
        result.note === null ||
        !result.note.actions.edit ||
        result.snapshot.state.kind !== "prepared"
      ) {
        store.setState((current) =>
          transitionNotesClient(current, { kind: "cancel" })
        );
        return;
      }
      queryClient.setQueryData(
        [
          ...prefix,
          "private",
          "attempt",
          active.epoch,
          result.note.id,
          result.snapshot.state.cursor.contextId,
          result.snapshot.state.cursor.revision,
        ],
        result
      );
      startEdit(result.note, result.snapshot.state.cursor);
    } catch (error) {
      if (store.get().epoch !== active.epoch) {
        return;
      }
      toastError(error, { boundary: "internal-note-reload" });
      if (collaborationFailure(error) === "lost") {
        loseAccess({ mailboxId, threadId });
      } else {
        restart(true);
      }
    }
  };

  const visible =
    client.available &&
    client.authority === "ready" &&
    snapshot !== undefined &&
    !authority.isError &&
    !page.isError;
  const draftVisible =
    visible &&
    attempt !== null &&
    snapshot?.state.kind === "prepared" &&
    snapshot.state.cursor.contextId === attempt.expected.contextId &&
    snapshot.permissions.writeOwnNotes &&
    (attempt.kind !== "edit" ||
      (validation.isSuccess && validation.data.note?.actions.edit === true));
  return {
    after,
    canModerate:
      snapshot?.permissions.moderateNotes === true &&
      page.data?.snapshot.permissions.moderateNotes !== false,
    canWrite:
      snapshot?.permissions.writeOwnNotes === true &&
      page.data?.snapshot.permissions.writeOwnNotes !== false,
    client,
    draftVisible,
    epoch,
    loseAccess,
    page: visible ? page.data : undefined,
    prefix,
    reloadAttempt,
    restart,
    save,
    snapshot,
    startCreate,
    startEdit,
    startRemove,
    store,
    validationFailed: validation.isError,
    visible,
    writing: writing.isPending || preparing.isPending,
  };
};
