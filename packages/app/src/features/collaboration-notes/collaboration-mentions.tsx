"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import type { CollaborationScope } from "@quieter/mail/collaboration";
import type { CollaborationMentionsInput } from "@quieter/mail/collaboration-notes";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { Pill } from "@quieter/ui/pill";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { Text } from "@quieter/ui/text";
import { useMutation, useQueries } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useState } from "react";

import { collaborationFailure, transitionNotesClient } from "./notes-session";
import { useNotesSession } from "./use-notes-session";

type MentionMailbox = { label: string; mailboxId: string };

const MentionsScope = ({
  mailboxes,
  onOpenConversation,
}: {
  mailboxes: readonly MentionMailbox[];
  onOpenConversation: (scope: CollaborationScope) => void;
}) => {
  const mailboxIds = useMemo(
    () => mailboxes.map((mailbox) => mailbox.mailboxId),
    [mailboxes]
  );
  const blockedStore = useCreateStore(new Set<string>());
  const blocked = useSelector(blockedStore, (value) => value);
  const onAccessLost = useCallback(
    (loss: { mailboxId: string }) => {
      blockedStore.setState((current) => new Set([...current, loss.mailboxId]));
    },
    [blockedStore]
  );
  const { client, store, prefix, queryClient, restart, loseAccess } =
    useNotesSession({
      mailboxIds,
      onAccessLost,
    });
  const positionStore = useCreateStore<
    Map<string, NonNullable<CollaborationMentionsInput["after"]>>
  >(new Map());
  const positions = useSelector(positionStore, (value) => value);
  const [open, setOpen] = useState(false);
  const { timeFormat } = useDateTimePreferences();
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    hour12: timeFormat === "12h",
    timeStyle: "short",
  });
  const { epoch } = client;
  useEffect(() => {
    blockedStore.setState(() => new Set());
    positionStore.setState(() => new Map());
  }, [blockedStore, epoch, positionStore]);

  const heads = useQueries({
    queries: mailboxes.map((mailbox) => ({
      enabled: client.available && !blocked.has(mailbox.mailboxId),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        await rpc.collaboration.mentions.list(
          { mailboxId: mailbox.mailboxId },
          { signal }
        ),
      queryKey: [...prefix, "private", mailbox.mailboxId, "head", epoch],
      refetchInterval: 6000,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    })),
  });
  const pages = useQueries({
    queries: mailboxes.map((mailbox) => ({
      enabled:
        open &&
        client.available &&
        !blocked.has(mailbox.mailboxId) &&
        positions.has(mailbox.mailboxId),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        await rpc.collaboration.mentions.list(
          {
            after: positions.get(mailbox.mailboxId),
            mailboxId: mailbox.mailboxId,
          },
          { signal }
        ),
      queryKey: [
        ...prefix,
        "private",
        mailbox.mailboxId,
        "page",
        epoch,
        positions.get(mailbox.mailboxId),
      ],
      refetchInterval: 6000,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
    })),
  });
  useEffect(() => {
    const failures = mailboxes.filter(
      (mailbox, index) =>
        (heads[index]?.isError || pages[index]?.isError) &&
        !blocked.has(mailbox.mailboxId)
    );
    if (failures.length > 0) {
      blockedStore.setState(
        (current) =>
          new Set([...current, ...failures.map((mailbox) => mailbox.mailboxId)])
      );
      for (const mailbox of failures) {
        const index = mailboxes.indexOf(mailbox);
        if (
          [heads[index]?.error, pages[index]?.error].some(
            (error) => collaborationFailure(error) === "lost"
          )
        ) {
          loseAccess({ mailboxId: mailbox.mailboxId });
        }
        const key = [...prefix, "private", mailbox.mailboxId];
        void queryClient.cancelQueries({ queryKey: key });
        queryClient.removeQueries({ queryKey: key });
      }
    }
    if (heads.some((query) => query.isSuccess) || failures.length > 0) {
      store.setState((current) =>
        transitionNotesClient(current, {
          canWrite: false,
          cursor: null,
          epoch,
          kind: "authorized",
        })
      );
    }
  }, [
    blocked,
    blockedStore,
    epoch,
    heads,
    mailboxes,
    loseAccess,
    pages,
    prefix,
    queryClient,
    store,
  ]);

  const acknowledge = useMutation({
    mutationFn: async (
      input: CollaborationScope & {
        contextId: string;
        noteId: string;
        epoch: number;
      }
    ) =>
      await rpc.collaboration.mentions.acknowledge({
        contextId: input.contextId,
        mailboxId: input.mailboxId,
        noteId: input.noteId,
        threadId: input.threadId,
      }),
    onError: (error, input) => {
      if (store.get().epoch === input.epoch) {
        toastError(error, { boundary: "internal-note-mention-read" });
        if (collaborationFailure(error) === "lost") {
          loseAccess({ mailboxId: input.mailboxId });
        }
        blockedStore.setState(
          (current) => new Set([...current, input.mailboxId])
        );
        const key = [...prefix, "private", input.mailboxId];
        void queryClient.cancelQueries({ queryKey: key });
        queryClient.removeQueries({ queryKey: key });
      }
    },
    onSuccess: async (_result, input) => {
      if (store.get().epoch === input.epoch) {
        await queryClient.invalidateQueries({
          queryKey: [...prefix, "private", input.mailboxId],
        });
      }
    },
  });

  const visible = client.available && client.authority === "ready";
  const complete = mailboxes.every(
    (mailbox, index) =>
      blocked.has(mailbox.mailboxId) || heads[index]?.isSuccess
  );
  const hasNew =
    visible &&
    heads.some((query, index) => {
      const mailbox = mailboxes[index];
      return (
        mailbox !== undefined &&
        query.isSuccess &&
        !blocked.has(mailbox.mailboxId) &&
        query.data.mentions.length > 0
      );
    });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          positionStore.setState(() => new Map());
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger render={<Button size="sm" variant="secondary" />}>
        Mentions{hasNew ? <Pill size="xs">New</Pill> : null}
      </PopoverTrigger>
      <PopoverContent align="end" scrollable size="sm">
        <div className="space-y-4">
          <PopoverTitle>Internal note mentions</PopoverTitle>
          {visible && complete ? null : (
            <Text size="sm" tone="muted">
              Checking mention access...
            </Text>
          )}
          {blocked.size > 0 ? (
            <div className="space-y-2">
              <Text size="sm" tone="muted">
                Some mentions could not be loaded.
              </Text>
              <Button
                onClick={() => {
                  restart(false);
                }}
                size="sm"
                variant="secondary"
              >
                Check again
              </Button>
            </div>
          ) : null}
          {visible
            ? mailboxes.map((mailbox, index) => {
                const query = positions.has(mailbox.mailboxId)
                  ? pages[index]
                  : heads[index];
                if (blocked.has(mailbox.mailboxId) || !query?.isSuccess) {
                  return null;
                }
                const { data } = query;
                if (
                  data.mentions.length === 0 &&
                  !positions.has(mailbox.mailboxId)
                ) {
                  return null;
                }
                return (
                  <section className="space-y-3" key={mailbox.mailboxId}>
                    <Text as="h3" size="sm">
                      {mailbox.label}
                    </Text>
                    {data.mentions.map((mention) => (
                      <div className="space-y-2" key={mention.noteId}>
                        <Text size="caption" tone="muted">
                          Internal note,{" "}
                          <time dateTime={mention.createdAt}>
                            {dateFormat.format(new Date(mention.createdAt))}
                          </time>
                        </Text>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={acknowledge.isPending}
                            onClick={() => {
                              acknowledge.mutate({ ...mention, epoch });
                              setOpen(false);
                              onOpenConversation({
                                mailboxId: mention.mailboxId,
                                threadId: mention.threadId,
                              });
                            }}
                            size="sm"
                          >
                            Open conversation
                          </Button>
                          <Button
                            disabled={acknowledge.isPending}
                            onClick={() => {
                              acknowledge.mutate({ ...mention, epoch });
                            }}
                            size="sm"
                            variant="secondary"
                          >
                            Mark read
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {positions.has(mailbox.mailboxId) ? (
                        <Button
                          onClick={() => {
                            positionStore.setState((current) => {
                              const next = new Map(current);
                              next.delete(mailbox.mailboxId);
                              return next;
                            });
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          Latest
                        </Button>
                      ) : null}
                      {data.next ? (
                        <Button
                          onClick={() => {
                            const position = data.next;
                            if (position) {
                              positionStore.setState(
                                (current) =>
                                  new Map([
                                    ...current,
                                    [mailbox.mailboxId, position],
                                  ])
                              );
                            }
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          Earlier mentions
                        </Button>
                      ) : null}
                    </div>
                  </section>
                );
              })
            : null}
          {visible && complete && !hasNew && blocked.size === 0 ? (
            <Text size="sm" tone="muted">
              No unread mentions.
            </Text>
          ) : null}
          <ActionFooter>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </ActionFooter>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const CollaborationMentions = ({
  mailboxes,
  onOpenConversation,
}: {
  mailboxes: readonly MentionMailbox[];
  onOpenConversation: (scope: CollaborationScope) => void;
}) => {
  const unique = useMemo(
    () => [
      ...new Map(
        mailboxes.map((mailbox) => [mailbox.mailboxId, mailbox])
      ).values(),
    ],
    [mailboxes]
  );
  if (unique.length === 0) {
    return null;
  }
  return (
    <MentionsScope
      key={JSON.stringify(
        unique.map((mailbox) => mailbox.mailboxId).toSorted()
      )}
      mailboxes={unique}
      onOpenConversation={onOpenConversation}
    />
  );
};
