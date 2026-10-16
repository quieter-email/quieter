"use client";

import {
  Loading03Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { MobileHeader } from "#/components/mobile-header";
import { buildComposeDraftFromMessageAction } from "#/features/compose/domain/compose-actions";
import { textToComposeBodyHtml } from "#/features/compose/domain/draft";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { useBriefMailboxActivity } from "#/features/mailbox/components/use-brief-mailbox-activity";
import type { UnifiedInboxMailbox } from "#/features/mailbox/domain/unified-inbox";
import { toastError } from "#/lib/error-toast";
import type { MessageListItem } from "#/lib/mail";
import { orpc, rpc } from "#/lib/orpc";

import { DailyBriefCard } from "./daily-brief-card";

type Brief = RouterOutputs["dailyBrief"]["get"];
type BriefItem = Brief["items"][number];

type DailyBriefPanelProps = {
  mailboxes: UnifiedInboxMailbox[];
  combined: boolean;
  onOpenSidebar: () => void;
  onOpenSource: (
    mailboxId: string,
    messageId: string,
    threadId: string
  ) => void;
  onComposeDraftRequested: (
    draft: ComposeDraftState,
    mailboxId: string
  ) => void;
};

export const DailyBriefPanel = ({
  mailboxes,
  combined,
  onOpenSidebar,
  onOpenSource,
  onComposeDraftRequested,
}: DailyBriefPanelProps) => {
  const availableMailboxes = mailboxes.filter(
    (mailbox) => mailbox.provider !== "api"
  );
  const queryClient = useQueryClient();
  const queries = useQueries({
    queries: availableMailboxes.map((mailbox) => ({
      ...orpc.dailyBrief.get.queryOptions({ input: { mailboxId: mailbox.id } }),
      queryFn: async () =>
        mailbox.connectionStatus === "connected"
          ? await rpc.dailyBrief.prepare({
              mailboxId: mailbox.id,
              onlyIfActive: combined,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
          : await rpc.dailyBrief.get({ mailboxId: mailbox.id }),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });
  const updateBrief = (mailboxId: string, data: Brief) => {
    queryClient.setQueryData(
      orpc.dailyBrief.get.queryOptions({ input: { mailboxId } }).queryKey,
      data
    );
  };
  const configure = useMutation({
    ...orpc.dailyBrief.configure.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "brief-settings" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
    },
  });
  const refresh = useMutation({
    ...orpc.dailyBrief.refresh.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "brief-refresh" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
    },
  });
  const feedback = useMutation({
    ...orpc.dailyBrief.feedback.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "brief-feedback" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
    },
  });
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Suggestions prepare composer text without writing mail or brief state.
  const prepareDraft = useMutation({
    mutationFn: async ({
      mailbox,
      item,
    }: {
      mailbox: UnifiedInboxMailbox;
      item: BriefItem;
    }) => {
      let message: MessageListItem | undefined;
      for (const source of item.sources) {
        try {
          const thread = await rpc.mail.getThread({
            mailboxId: mailbox.id,
            threadId: source.threadId,
          });
          message = thread.messages.find(
            (candidate) =>
              candidate.id === source.messageId &&
              candidate.threadId === source.threadId
          );
          if (message !== undefined) {
            break;
          }
        } catch (error) {
          if (
            error instanceof Error &&
            "status" in error &&
            error.status === 404
          ) {
            continue;
          }
          throw error;
        }
      }
      if (message === undefined) {
        toast.info("This email is no longer available.");
        return null;
      }
      const suggestion = await rpc.ai.suggestReply({
        mailboxId: mailbox.id,
        messageId: message.id,
        threadId: message.threadId,
      });
      if (suggestion.status === "not_needed") {
        toast.info(suggestion.reason);
        return null;
      }
      const draft = buildComposeDraftFromMessageAction({
        action: "reply",
        currentUserEmail: mailbox.emailAddress,
        message,
      });
      return {
        ...draft,
        assistantUnsaved: true,
        bodyHtml: `${textToComposeBodyHtml(suggestion.bodyText)}${draft.bodyHtml}`,
        bodyText: `${suggestion.bodyText}\n\n${draft.bodyText}`,
      };
    },
    onError: (error) => {
      toastError(error, { boundary: "brief-reply" });
    },
  });
  const sources = availableMailboxes.flatMap((mailbox, index) => {
    const query = queries[index];
    return query === undefined ? [] : [{ mailbox, query }];
  });
  const enabledSources = sources.filter(
    ({ mailbox, query }) =>
      mailbox.connectionStatus === "connected" &&
      query.data?.settings.enabled === true &&
      (!combined ||
        (query.data.settings.lastUsedAt !== null &&
          Date.parse(query.data.settings.lastUsedAt) >
            query.dataUpdatedAt - 7 * 86_400_000))
  );
  useBriefMailboxActivity(
    combined
      ? enabledSources.flatMap(({ mailbox, query }) =>
          (query.data?.items.length ?? 0) > 0 ? [{ mailboxId: mailbox.id }] : []
        )
      : [],
    combined
  );
  const items = (combined ? enabledSources : sources)
    .flatMap(({ mailbox, query }) =>
      query.data?.settings.enabled === true
        ? query.data.items.map((item) => ({ item, mailbox }))
        : []
    )
    .toSorted((left, right) => right.item.priority - left.item.priority)
    .slice(0, 8);
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some(
    (query) => query.isError || (query.data?.lastError ?? null) !== null
  );
  const busy =
    refresh.isPending ||
    feedback.isPending ||
    prepareDraft.isPending ||
    configure.isPending ||
    queries.some((query) => query.data?.generationInProgress === true);
  const [source] = sources;
  const disabled = !combined && source?.query.data?.settings.enabled === false;
  const settingsSearch = {
    mailboxId: combined ? "" : (source?.mailbox.id ?? ""),
    section: "brief",
    tab: "mailboxes" as const,
  };
  const lastUpdated = queries
    .flatMap((query) =>
      query.data?.edition ? [query.data.edition.updatedAt] : []
    )
    .toSorted()
    .at(-1);

  return (
    <WorkspaceSection aria-label="Brief">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title="Brief"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-7 sm:px-12 sm:py-14">
          <header className="mb-6 sm:mb-9">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-caption text-muted-fg">
                {combined
                  ? "All inboxes"
                  : source?.mailbox.displayName ||
                    source?.mailbox.emailAddress ||
                    "Inbox"}
              </p>
              <div className="flex items-center gap-0.5">
                <IconButtonTooltip label="Refresh brief">
                  <Button
                    aria-label="Refresh brief"
                    disabled={busy || enabledSources.length === 0}
                    onClick={() => {
                      void (async () => {
                        for (const { mailbox } of enabledSources) {
                          try {
                            await refresh.mutateAsync({
                              mailboxId: mailbox.id,
                            });
                          } catch {
                            /* Each inbox surfaces its own error. */
                          }
                        }
                      })();
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      icon={refresh.isPending ? Loading03Icon : RefreshIcon}
                      className={cn({ "animate-spin": refresh.isPending })}
                    />
                  </Button>
                </IconButtonTooltip>
                <DropdownMenu>
                  <IconButtonTooltip label="Brief options">
                    <DropdownMenuTrigger
                      appearance="icon"
                      aria-label="Brief options"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        icon={MoreHorizontalIcon}
                        className="size-4"
                      />
                    </DropdownMenuTrigger>
                  </IconButtonTooltip>
                  <DropdownMenuContent align="end" size="compact">
                    <DropdownMenuItem
                      render={<Link to="/settings" search={settingsSearch} />}
                    >
                      Brief settings
                    </DropdownMenuItem>
                    {!combined &&
                    source?.query.data?.settings.enabled === true ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() => {
                            const settings = source.query.data?.settings;
                            if (settings) {
                              configure.mutate({
                                cadence: settings.cadence,
                                enabled: false,
                                localTime: settings.localTime,
                                mailboxId: source.mailbox.id,
                                scheduleEnabled: settings.scheduleEnabled,
                                timeZone: settings.timeZone,
                                weekday: settings.weekday,
                              });
                            }
                          }}
                        >
                          Disable Brief for this mailbox
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h1 className="text-title-md font-medium text-fg">Your brief</h1>
              {lastUpdated ? (
                <p className="text-caption text-muted-fg">
                  {new Intl.DateTimeFormat(undefined, {
                    day: "numeric",
                    month: "long",
                    weekday: "long",
                  }).format(new Date(lastUpdated))}
                </p>
              ) : null}
            </div>
          </header>
          {disabled ? (
            <div className="py-10">
              <p className="text-body text-muted-fg">
                Brief is off for this mailbox.
              </p>
              <LinkButton
                className="mt-3"
                to="/settings"
                search={settingsSearch}
                size="sm"
                variant="secondary"
              >
                Enable in settings
              </LinkButton>
            </div>
          ) : null}
          {!disabled && loading && items.length === 0 ? (
            <output className="block py-10 text-body text-muted-fg">
              Preparing your brief…
            </output>
          ) : null}
          {failed ? (
            <p className="mb-4 text-caption text-muted-fg">
              Couldn’t update your brief. Try again in a moment.
            </p>
          ) : null}
          {!disabled && !loading && !failed && items.length === 0 ? (
            <p className="py-10 text-body text-muted-fg">
              Nothing needs your attention right now.
            </p>
          ) : null}
          <div className="grid gap-6 sm:gap-8">
            {items.map(({ item, mailbox }) => (
              <DailyBriefCard
                key={`${mailbox.id}:${item.id}`}
                item={item}
                mailbox={mailbox}
                showMailbox={combined}
                busy={busy}
                onOpenSource={onOpenSource}
                onFeedback={(action, preference) => {
                  feedback.mutate({
                    action,
                    itemId: item.id,
                    mailboxId: mailbox.id,
                    preference,
                    ...(action === "defer"
                      ? {
                          deferUntil: new Date(
                            Date.now() + 3_600_000
                          ).toISOString(),
                        }
                      : {}),
                  });
                }}
                onPrepareDraft={() => {
                  prepareDraft.mutate(
                    { item, mailbox },
                    {
                      onSuccess: (draft) => {
                        if (draft !== null) {
                          onComposeDraftRequested(draft, mailbox.id);
                        }
                      },
                    }
                  );
                }}
              />
            ))}
          </div>
          {lastUpdated && !disabled ? (
            <p className="mt-7 text-caption text-muted-fg sm:mt-9">
              Updated{" "}
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(lastUpdated))}
            </p>
          ) : null}
        </div>
      </div>
    </WorkspaceSection>
  );
};
