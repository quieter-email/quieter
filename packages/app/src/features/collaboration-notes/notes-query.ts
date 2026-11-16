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
import { useCallback, useEffect, useMemo } from "react";

import { collaborationFailure, transitionNotesClient } from "./notes-session";
import type { NotesSnapshotReceipt } from "./notes-session";
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
  const handleSnapshot = useCallback(
    ({ epoch: observedEpoch, snapshot: observed }: NotesSnapshotReceipt) => {
      const active = store.get();
      if (
        active.epoch !== observedEpoch ||
        !active.available ||
        active.authority.kind === "lost" ||
        observed.mailboxId !== mailboxId ||
        observed.threadId !== threadId
      ) {
        return;
      }
      const currentPermissions =
        active.authority.kind === "ready"
          ? active.authority.permissions
          : undefined;
      if (
        (!observed.permissions.writeOwnNotes &&
          currentPermissions?.writeOwnNotes !== false) ||
        (!observed.permissions.moderateNotes &&
          currentPermissions?.moderateNotes !== false)
      ) {
        void queryClient.cancelQueries({
          exact: true,
          queryKey: [...prefix, "authority", observedEpoch],
        });
      }
      store.setState((current) =>
        transitionNotesClient(current, {
          cursor:
            observed.state.kind === "prepared" ? observed.state.cursor : null,
          epoch: observedEpoch,
          kind: "permissions-observed",
          permissions: observed.permissions,
        })
      );
    },
    [mailboxId, prefix, queryClient, store, threadId]
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
        handleSnapshot({ epoch: activeEpoch, snapshot: prepared });
        queryClient.setQueryData(
          [...prefix, "authority", activeEpoch],
          prepared
        );
      }
    },
  });
  const authority = useQuery({
    enabled: client.available && !preparing.isPending,
    queryFn: async ({ signal }) => {
      const result = await rpc.collaboration.get(
        { mailboxId, threadId },
        { signal }
      );
      const active = store.get();
      if (!signal.aborted && active.epoch === epoch) {
        if (
          active.authority.kind === "ready" &&
          ((!active.authority.permissions.writeOwnNotes &&
            result.permissions.writeOwnNotes) ||
            (!active.authority.permissions.moderateNotes &&
              result.permissions.moderateNotes))
        ) {
          restart(true);
        } else {
          store.setState((current) =>
            transitionNotesClient(current, {
              cursor:
                result.state.kind === "prepared" ? result.state.cursor : null,
              epoch,
              kind: "authorized",
              permissions: result.permissions,
            })
          );
        }
      }
      return result;
    },
    queryKey: authorityKey,
    refetchInterval: 6000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (authority.isError) {
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
    authority.error,
    authority.isError,
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
      client.available && client.authority.kind === "ready" && cursor !== null,
    queryFn: async ({ signal }) => {
      const result = await rpc.collaboration.notes.list(
        {
          mailboxId,
          threadId,
          ...(cursor === null ? {} : { at: cursor }),
          ...(after === undefined ? {} : { after }),
        },
        { signal }
      );
      if (!signal.aborted) {
        handleSnapshot({ epoch, snapshot: result.snapshot });
      }
      return result;
    },
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

  const canWrite =
    client.authority.kind === "ready" &&
    client.authority.permissions.writeOwnNotes;
  const canModerate =
    client.authority.kind === "ready" &&
    client.authority.permissions.moderateNotes;
  const { attempt } = client;
  const validationKey = useMemo(
    () => [
      ...prefix,
      "private",
      "attempt",
      epoch,
      attempt?.noteId,
      attempt?.expected.contextId,
      attempt?.expected.revision,
      snapshot?.role,
    ],
    [
      attempt?.expected.contextId,
      attempt?.expected.revision,
      attempt?.noteId,
      epoch,
      prefix,
      snapshot?.role,
    ]
  );
  const validation = useQuery({
    enabled:
      client.available &&
      client.authority.kind === "ready" &&
      attempt !== null &&
      (attempt.kind !== "create" ||
        (attempt.kind === "create" && attempt.status === "uncertain")),
    queryFn: async ({ signal }) => {
      if (attempt === null) {
        throw new Error("No note is being reviewed.");
      }
      const result = await rpc.collaboration.notes.get(
        {
          contextId: attempt.expected.contextId,
          mailboxId,
          noteId: attempt.noteId,
          threadId,
        },
        { signal }
      );
      if (!signal.aborted) {
        handleSnapshot({ epoch, snapshot: result.snapshot });
      }
      return result;
    },
    queryKey: validationKey,
    refetchInterval: 6000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    void queryClient.invalidateQueries(
      { exact: true, queryKey: validationKey },
      { cancelRefetch: false }
    );
  }, [authority.dataUpdatedAt, page.dataUpdatedAt, queryClient, validationKey]);

  const listedNote = page.data?.notes.find(
    (note) => note.id === attempt?.noteId
  );
  const ownTarget =
    listedNote?.actions.edit ?? validation.data?.note?.actions.edit;
  useEffect(() => {
    if (
      validation.isError &&
      collaborationFailure(validation.error) === "lost"
    ) {
      loseAccess({ mailboxId, threadId });
      return;
    }
    if (
      attempt !== null &&
      attempt.kind !== "create" &&
      (listedNote?.actions[attempt.kind] === false ||
        (attempt.kind === "remove" && !canModerate && ownTarget === false) ||
        (validation.isSuccess &&
          (validation.data.note === null ||
            !validation.data.note.actions[attempt.kind])))
    ) {
      store.setState((current) =>
        current.attempt === attempt
          ? transitionNotesClient(current, { kind: "cancel" })
          : current
      );
      return;
    }
    if (
      validation.isError ||
      validation.data === undefined ||
      attempt === null ||
      attempt.kind === "remove"
    ) {
      return;
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
    canModerate,
    epoch,
    listedNote,
    loseAccess,
    mailboxId,
    ownTarget,
    prefix,
    queryClient,
    restart,
    store,
    threadId,
    validation.data,
    validation.error,
    validation.isError,
    validation.isSuccess,
  ]);

  const visible =
    client.available &&
    client.authority.kind === "ready" &&
    snapshot !== undefined &&
    !authority.isError &&
    !page.isError;
  const draftVisible =
    visible &&
    attempt !== null &&
    snapshot?.state.kind === "prepared" &&
    snapshot.state.cursor.contextId === attempt.expected.contextId &&
    canWrite &&
    (attempt.kind === "create" ||
      (validation.isSuccess &&
        validation.data.note?.actions[attempt.kind] === true &&
        listedNote?.actions[attempt.kind] !== false &&
        (attempt.kind !== "remove" || canModerate || ownTarget === true)));

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
      handleSnapshot({ epoch: active.epoch, snapshot: result.snapshot });
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
      active.authority.kind !== "ready" ||
      !active.authority.permissions.writeOwnNotes ||
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
      handleSnapshot({ epoch: activeEpoch, snapshot: prepared });
      const expected = prepared.state.cursor;
      queryClient.setQueryData(authorityKey, prepared);
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
      pending !== attempt ||
      pending.status === "saving" ||
      active.authority.kind !== "ready" ||
      !active.authority.permissions.writeOwnNotes ||
      (pending.kind === "remove" &&
        !active.authority.permissions.moderateNotes &&
        ownTarget !== true) ||
      !draftVisible
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
      if (
        store.get().epoch !== active.epoch ||
        store.get().attempt !== active.attempt
      ) {
        return;
      }
      handleSnapshot({ epoch: active.epoch, snapshot: result.snapshot });
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
      queryClient.setQueryData(validationKey, result);
      startEdit(result.note, result.snapshot.state.cursor);
    } catch (error) {
      if (
        store.get().epoch !== active.epoch ||
        store.get().attempt !== active.attempt
      ) {
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

  return {
    after,
    canModerate,
    canWrite,
    client,
    draftVisible,
    epoch,
    handleSnapshot,
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
