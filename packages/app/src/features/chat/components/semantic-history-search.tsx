"use client";

import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SubmitEvent } from "react";

type SearchKind = "chat" | "mail";
type HistorySearchItem = Awaited<
  ReturnType<typeof rpc.search.history>
>["items"][number];
type SubmittedSearch = { kind: SearchKind; query: string; request: number };

export const SemanticHistorySearch = ({
  mailboxId,
  onChatSelect,
  onOpenChange,
  open,
}: {
  mailboxId: string;
  onChatSelect: (chatId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const setMailboxSearch = useMailboxSearchActions();
  const workspace = useAgentWorkspace();
  const [kind, setKind] = useState<SearchKind>("chat");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const search = useQuery({
    enabled: open && submitted !== null,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (submitted === null) {
        throw new Error("Submit a history search first.");
      }
      try {
        return await rpc.search.history(
          { kind: submitted.kind, mailboxId, query: submitted.query },
          { signal }
        );
      } catch (error) {
        if (!signal.aborted) {
          toastError(error, {
            boundary: "semantic-history-search",
            fallback: "Could not search your history. Try again.",
          });
        }
        throw error;
      }
    },
    queryKey: ["mailbox", mailboxId, "semantic-history", submitted],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  const preparation = useQuery({
    enabled: open && (submitted !== null || kind === "mail"),
    queryFn: async ({ signal }) =>
      await rpc.search.status({ kind, mailboxId }, { signal }),
    queryKey: ["mailbox", mailboxId, "semantic-index-status", kind],
    refetchInterval: open ? 5000 : false,
    retry: false,
  });
  const prepareMail = useMutation({
    mutationFn: async () => await rpc.search.prepareMail({ mailboxId }),
    onError: (error) => {
      toastError(error, {
        boundary: "semantic-mail-prepare",
        fallback: "Could not prepare older mail. Try again.",
      });
    },
    onSuccess: async () => {
      await preparation.refetch();
    },
  });
  const pausePreparation = useMutation({
    mutationFn: async () => await rpc.search.pause({ kind, mailboxId }),
    onError: (error) => {
      toastError(error, {
        boundary: "semantic-index-pause",
        fallback: "Could not stop preparation. Try again.",
      });
    },
    onSuccess: async () => {
      await preparation.refetch();
    },
  });
  const openResult = async (item: HistorySearchItem) => {
    if (item.kind === "chat") {
      onChatSelect(item.chatId);
      setSubmitted(null);
      onOpenChange(false);
      return;
    }
    workspace?.control.cancel();
    try {
      await setMailboxSearch(
        {
          mailbox: "inbox",
          mailboxId,
          messageId: item.messageId,
          query: "",
          threadId: item.threadId,
          view: "inbox",
          workspace: null,
        },
        { replace: false }
      );
      setSubmitted(null);
      onOpenChange(false);
    } catch (error) {
      toastError(error, {
        boundary: "semantic-history-open-mail",
        fallback: "Could not open this email. Try again.",
      });
    }
  };
  const submitSearch = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (normalizedQuery === "" || search.isFetching) {
      return;
    }
    setSubmitted((previous) => ({
      kind,
      query: normalizedQuery,
      request: (previous?.request ?? 0) + 1,
    }));
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setSubmitted(null);
        }
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent>
        <form className="flex max-h-[90dvh] flex-col" onSubmit={submitSearch}>
          <DialogHeader>
            <DialogTitle>Search conversations and mail</DialogTitle>
            <DialogDescription>
              Describe what you remember to find related conversations or mail.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            <div aria-label="Search history type" className="flex gap-2">
              {(["chat", "mail"] satisfies SearchKind[]).map((searchKind) => (
                <Button
                  aria-pressed={kind === searchKind}
                  disabled={search.isFetching}
                  key={searchKind}
                  onClick={() => {
                    setKind(searchKind);
                    setSubmitted(null);
                  }}
                  type="button"
                  variant="option"
                >
                  {searchKind === "chat" ? "Conversations" : "Mail"}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Search conversations and mail"
              maxLength={2000}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="What are you looking for?"
              value={query}
            />
            {kind === "mail" ? (
              <Text size="caption" tone="muted">
                Searches mail already saved in Quieter.
              </Text>
            ) : null}
            <div aria-live="polite">
              {search.isFetching ? (
                <Text size="sm" tone="muted">
                  Searching your history…
                </Text>
              ) : null}
              {search.isError ? (
                <Text size="sm" tone="muted">
                  Search could not finish. Try again.
                </Text>
              ) : null}
              {search.data ? (
                <div className="space-y-3">
                  {search.data.coverage.complete ? null : (
                    <Text size="caption" tone="muted">
                      Results may be incomplete while search is prepared.
                    </Text>
                  )}
                  {search.data.items.length === 0 ? (
                    <Text size="sm" tone="muted">
                      No matching history found.
                    </Text>
                  ) : (
                    <ul className="max-h-80 space-y-1 overflow-y-auto">
                      {search.data.items.map((item) => (
                        <li
                          key={
                            item.kind === "chat"
                              ? `chat:${item.chatId}:${item.messageId}`
                              : `mail:${item.messageId}`
                          }
                        >
                          <Button
                            onClick={() => {
                              void openResult(item);
                            }}
                            type="button"
                            variant="result"
                          >
                            <span className="flex min-w-0 flex-col gap-1">
                              <Text as="span" size="sm" weight="medium">
                                {item.title?.trim() ||
                                  (item.kind === "chat"
                                    ? "New chat"
                                    : "Untitled mail")}
                              </Text>
                              <Text
                                as="span"
                                className="break-words"
                                size="sm"
                                tone="muted"
                              >
                                {item.snippet}
                              </Text>
                              <Text as="span" size="caption" tone="muted">
                                {new Date(item.updatedAt).toLocaleDateString()}
                              </Text>
                            </span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            {search.data !== undefined ||
            kind === "mail" ||
            preparation.data?.active === true ? (
              <Collapsible key={kind}>
                <CollapsibleTrigger
                  render={<Button size="sm" type="button" variant="ghost" />}
                >
                  Search coverage
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="min-h-0 space-y-3 overflow-hidden pt-2">
                    {search.data ? (
                      <div className="space-y-2">
                        <Text size="caption" tone="muted">
                          {search.data.coverage.indexedSources} of{" "}
                          {search.data.coverage.totalSources} retained messages
                          ready to search by meaning.
                          {preparation.data?.active === true
                            ? " New content continues preparing in the background."
                            : ""}
                        </Text>
                        {search.data.coverage.complete ? null : (
                          <Button
                            onClick={() => {
                              setSubmitted((previous) =>
                                previous === null
                                  ? null
                                  : {
                                      ...previous,
                                      request: previous.request + 1,
                                    }
                              );
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Continue preparing search
                          </Button>
                        )}
                      </div>
                    ) : null}
                    {kind === "mail" ? (
                      <div className="space-y-2">
                        <Text size="caption" tone="muted">
                          Normal mail search covers your full mailbox.
                        </Text>
                        {preparation.data?.canImport === true &&
                        preparation.data.importRequested ? (
                          <Text size="caption" tone="muted">
                            {preparation.data.importComplete
                              ? "Older mail has been imported."
                              : "Older mail is being prepared in the background. Results may be incomplete."}
                          </Text>
                        ) : null}
                        {preparation.data?.canImport === true &&
                        !preparation.data.importRequested ? (
                          <>
                            <Text size="caption" tone="muted">
                              Preparing older mail for search uses your AI
                              balance.
                            </Text>
                            <Button
                              disabled={
                                prepareMail.isPending || search.isFetching
                              }
                              onClick={() => {
                                prepareMail.mutate();
                              }}
                              type="button"
                              variant="secondary"
                            >
                              {prepareMail.isPending
                                ? "Starting preparation…"
                                : "Prepare older mail"}
                            </Button>
                          </>
                        ) : null}
                        {preparation.data?.waiting === true ? (
                          <Text size="caption" tone="muted">
                            Preparation is waiting for access or available
                            usage. It will retry automatically.
                          </Text>
                        ) : null}
                      </div>
                    ) : null}
                    {preparation.data?.active === true ? (
                      <div className="space-y-2">
                        <Button
                          disabled={pausePreparation.isPending}
                          onClick={() => {
                            pausePreparation.mutate();
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Stop background preparation
                        </Button>
                        <Text size="caption" tone="muted">
                          The current batch can finish. Search again to resume
                          preparing retained content.
                        </Text>
                      </div>
                    ) : null}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Close</DialogCloseButton>
            <Button
              disabled={query.trim() === "" || search.isFetching}
              pending={search.isFetching}
              pendingLabel="Searching"
              type="submit"
            >
              Search
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
