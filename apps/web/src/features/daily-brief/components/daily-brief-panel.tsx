"use client";

import { Loading03Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { Input } from "@quieter/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Tabs, TabsList, TabsTab } from "@quieter/ui/tabs";
import { toast } from "@quieter/ui/toast";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { buildComposeDraftFromMessageAction } from "#/features/compose/domain/compose-actions";
import { textToComposeBodyHtml } from "#/features/compose/domain/draft";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type { UnifiedInboxMailbox } from "#/features/mailbox/domain/unified-inbox";
import { toastError } from "#/lib/error-toast";
import type { MessageListItem } from "#/lib/mail";
import { orpc, rpc } from "#/lib/orpc";

import { DailyBriefCard } from "./daily-brief-card";

type Brief = RouterOutputs["dailyBrief"]["get"];
type BriefItem = Brief["items"][number];

type DailyBriefPanelProps = {
  mailboxes: UnifiedInboxMailbox[];
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

const DailyBriefScheduleForm = ({
  mailbox,
  settings,
  pending,
  onSave,
}: {
  mailbox: UnifiedInboxMailbox;
  settings: Brief["settings"];
  pending: boolean;
  onSave: (settings: Brief["settings"]) => Promise<void>;
}) => {
  const formId = useId();
  const needsReconnect = mailbox.connectionStatus === "needs_reconnect";
  const [enabled, setEnabled] = useState(settings.enabled);
  const [scheduleEnabled, setScheduleEnabled] = useState(
    settings.scheduleEnabled
  );
  const [localTime, setLocalTime] = useState(settings.localTime);
  const [timeZone, setTimeZone] = useState(() =>
    settings.enabled
      ? settings.timeZone
      : Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  return (
    <form
      className="grid gap-4 border-t border-border py-5 first:border-t-0"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ enabled, localTime, scheduleEnabled, timeZone });
      }}
    >
      <div>
        <p className="text-body font-medium text-fg">
          {mailbox.displayName || mailbox.emailAddress}
        </p>
        {mailbox.displayName ? (
          <p className="text-caption text-muted-fg">{mailbox.emailAddress}</p>
        ) : null}
      </div>
      {needsReconnect ? (
        <p className="text-caption text-muted-fg">
          Reconnect this inbox to prepare editions. You can still turn off Daily
          Brief here.
        </p>
      ) : null}
      <label
        className="flex items-center gap-3 text-body text-fg"
        htmlFor={`${formId}-enabled`}
      >
        <Checkbox
          id={`${formId}-enabled`}
          checked={enabled}
          disabled={pending || (needsReconnect && !settings.enabled)}
          onCheckedChange={setEnabled}
        >
          <CheckboxIndicator />
        </Checkbox>
        Include this inbox in Daily Brief
      </label>
      <label
        className="flex items-center gap-3 text-body text-fg"
        htmlFor={`${formId}-schedule`}
      >
        <Checkbox
          id={`${formId}-schedule`}
          checked={scheduleEnabled}
          disabled={!enabled || needsReconnect || pending}
          onCheckedChange={setScheduleEnabled}
        >
          <CheckboxIndicator />
        </Checkbox>
        Prepare a daily edition
      </label>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <label
          className="grid gap-1.5 text-caption text-muted-fg"
          htmlFor={`${formId}-time`}
        >
          Local time
          <Input
            id={`${formId}-time`}
            disabled={!enabled || !scheduleEnabled || needsReconnect || pending}
            onChange={(event) => {
              setLocalTime(event.target.value);
            }}
            required
            type="time"
            value={localTime}
          />
        </label>
        <label
          className="grid gap-1.5 text-caption text-muted-fg"
          htmlFor={`${formId}-zone`}
        >
          Timezone
          <Input
            id={`${formId}-zone`}
            autoComplete="off"
            disabled={!enabled || !scheduleEnabled || needsReconnect || pending}
            onChange={(event) => {
              setTimeZone(event.target.value);
            }}
            placeholder="Europe/Berlin"
            required
            value={timeZone}
          />
        </label>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending} size="sm" type="submit" variant="secondary">
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
};

export const DailyBriefPanel = ({
  mailboxes,
  onOpenSidebar,
  onOpenSource,
  onComposeDraftRequested,
}: DailyBriefPanelProps) => {
  const availableMailboxes = mailboxes.filter(
    (mailbox) => mailbox.provider !== "api"
  );
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"presentation" | "list">("presentation");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // oxlint-disable-next-line react/hook-use-state -- Capture the header date once when the reader opens the brief.
  const [openedAt] = useState(() => new Date());
  const queryClient = useQueryClient();
  const queries = useQueries({
    queries: availableMailboxes.map((mailbox) =>
      orpc.dailyBrief.get.queryOptions({
        input: { mailboxId: mailbox.id },
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
      })
    ),
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
      toastError(error, { boundary: "daily-brief-settings" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
    },
  });
  const refresh = useMutation({
    ...orpc.dailyBrief.refresh.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "daily-brief-refresh" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
    },
  });
  const feedback = useMutation({
    ...orpc.dailyBrief.feedback.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "daily-brief-feedback" });
    },
    onSuccess: (data, input) => {
      updateBrief(input.mailboxId, data);
      if (input.action === "defer") {
        toast.success(
          "Set aside for one hour. Your original mail stays in your inbox."
        );
      }
    },
  });
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation -- Reply suggestions generate text without writing mail or brief state.
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
        toast.info(
          "This source mail is no longer available. Refresh your Daily Brief."
        );
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
      toastError(error, { boundary: "daily-brief-draft" });
    },
  });
  const prepareItemDraft = (mailbox: UnifiedInboxMailbox, item: BriefItem) => {
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
  };
  const sources = availableMailboxes.flatMap((mailbox, index) => {
    const query = queries[index];
    return query === undefined ? [] : [{ mailbox, query }];
  });
  const selectedSources = sources.filter(
    ({ mailbox }) =>
      !excludedIds.includes(mailbox.id) &&
      mailbox.connectionStatus === "connected"
  );
  const items = selectedSources.flatMap(({ mailbox, query }) =>
    !query.isError && query.data?.settings.enabled === true
      ? query.data.items.map((item) => ({ item, mailbox }))
      : []
  );
  const urgentItems = items.filter(({ item }) => item.urgentAddition === true);
  const editionItems = items.filter(({ item }) => item.urgentAddition !== true);
  const rankedItems =
    mode === "list"
      ? editionItems.toSorted((a, b) => b.item.priority - a.item.priority)
      : editionItems;
  const groups = [
    ...new Set(
      rankedItems.map(({ mailbox, item }) => `${mailbox.id}:${item.group}`)
    ),
  ];
  const enabledSources = selectedSources.filter(
    ({ query }) => query.data?.settings.enabled === true
  );
  const loading = selectedSources.some(({ query }) => query.isPending);
  const failed = selectedSources.some(({ query }) => query.isError);
  const busy =
    refresh.isPending ||
    feedback.isPending ||
    prepareDraft.isPending ||
    selectedSources.some(
      ({ query }) => query.data?.generationInProgress === true
    );

  const renderBriefItem = ({
    item,
    mailbox,
  }: {
    item: BriefItem;
    mailbox: UnifiedInboxMailbox;
  }) => (
    <DailyBriefCard
      key={`${mailbox.id}:${item.id}`}
      item={item}
      mailbox={mailbox}
      compact={mode === "list" || item.urgentAddition === true}
      busy={busy}
      onOpenSource={onOpenSource}
      onFeedback={(action, preference) => {
        feedback.mutate({
          action,
          itemId: item.id,
          mailboxId: mailbox.id,
          preference,
          ...(action === "defer"
            ? { deferUntil: new Date(Date.now() + 3_600_000).toISOString() }
            : {}),
        });
      }}
      onPrepareDraft={() => {
        prepareItemDraft(mailbox, item);
      }}
    />
  );

  return (
    <WorkspaceSection aria-label="Daily Brief">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title="Daily Brief"
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-10 sm:py-12">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-caption text-muted-fg">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "full",
                }).format(openedAt)}
              </p>
              <h1 className="mt-2 text-2xl font-medium tracking-tight text-fg sm:text-3xl">
                Daily Brief
              </h1>
              <p className="mt-2 text-body text-muted-fg">
                The important mail, in one place.
              </p>
            </div>
            <Button
              onClick={() => {
                setSettingsOpen((open) => !open);
              }}
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Settings01Icon} />
              Edition settings
            </Button>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
            <Tabs
              value={mode}
              onValueChange={(value: unknown) => {
                if (value === "list" || value === "presentation") {
                  setMode(value);
                }
              }}
            >
              <TabsList aria-label="Reading mode">
                <TabsTab value="presentation">Overview</TabsTab>
                <TabsTab value="list">Priority list</TabsTab>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
                  Inboxes
                </PopoverTrigger>
                <PopoverContent align="end">
                  <div className="grid gap-3">
                    <p className="text-body font-medium">Show in this view</p>
                    {availableMailboxes.map((mailbox) => (
                      <label
                        className="flex items-center gap-3 text-body"
                        key={mailbox.id}
                      >
                        <Checkbox
                          disabled={
                            mailbox.connectionStatus === "needs_reconnect"
                          }
                          checked={!excludedIds.includes(mailbox.id)}
                          onCheckedChange={(checked) => {
                            setExcludedIds((ids) =>
                              checked
                                ? ids.filter((id) => id !== mailbox.id)
                                : [...ids, mailbox.id]
                            );
                          }}
                        >
                          <CheckboxIndicator />
                        </Checkbox>
                        {mailbox.displayName || mailbox.emailAddress}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                disabled={busy || enabledSources.length === 0}
                onClick={() => {
                  void (async () => {
                    for (const { mailbox } of enabledSources) {
                      try {
                        await refresh.mutateAsync({ mailboxId: mailbox.id });
                      } catch {
                        // The mutation surfaces this inbox's failure; other inboxes can still refresh.
                      }
                    }
                  })();
                }}
                size="sm"
                variant="secondary"
              >
                {refresh.isPending ? (
                  <HugeiconsIcon
                    aria-hidden
                    className="animate-spin"
                    icon={Loading03Icon}
                  />
                ) : null}
                {refresh.isPending ? "Preparing…" : "Refresh edition"}
              </Button>
            </div>
          </div>
          {settingsOpen ? (
            <section
              aria-label="Edition settings"
              className="mt-5 rounded-lg border border-border px-5"
            >
              <p className="pt-5 text-caption leading-relaxed text-muted-fg">
                Choose which inboxes to summarize. Scheduled editions stay in
                Quieter. Setting mail aside here does not create a reminder or
                move the original message.
              </p>
              {sources.map(({ mailbox, query }) =>
                query.data ? (
                  <DailyBriefScheduleForm
                    key={`${mailbox.id}:${JSON.stringify(query.data.settings)}`}
                    mailbox={mailbox}
                    settings={query.data.settings}
                    pending={configure.isPending}
                    onSave={async (settings) => {
                      try {
                        await configure.mutateAsync({
                          mailboxId: mailbox.id,
                          ...settings,
                        });
                      } catch {
                        /* The mutation surfaces the failure. */
                      }
                    }}
                  />
                ) : null
              )}
            </section>
          ) : null}
          {loading ? (
            <output className="py-10 text-body text-muted-fg">
              Loading your Daily Brief…
            </output>
          ) : null}
          {enabledSources.map(({ mailbox, query }) =>
            query.data?.lastError ? (
              <p className="mt-5 text-body text-muted-fg" key={mailbox.id}>
                {mailbox.displayName || mailbox.emailAddress}:{" "}
                {query.data.lastError} Your saved edition and original mail are
                still available.
              </p>
            ) : null
          )}
          {enabledSources.some(
            ({ query }) => query.data?.generationInProgress === true
          ) ? (
            <output className="mt-5 block text-body text-muted-fg">
              Preparing your next edition. You can keep reading.
            </output>
          ) : null}
          {failed ? (
            <div className="mt-6 rounded-lg border border-border p-5">
              <p className="text-body text-muted-fg">
                Could not load one of your inboxes. Your mail is still available
                in Inbox.
              </p>
              <Button
                onClick={() => {
                  for (const { query } of selectedSources) {
                    void query.refetch();
                  }
                }}
                size="sm"
                variant="ghost"
              >
                Try again
              </Button>
            </div>
          ) : null}
          {!loading && !failed && items.length === 0 ? (
            <div className="py-14">
              <h2 className="text-body-lg font-medium text-fg">
                {enabledSources.length === 0
                  ? "Make room for the important mail"
                  : "You're caught up"}
              </h2>
              <p className="mt-2 max-w-md text-body leading-relaxed text-muted-fg">
                {enabledSources.length === 0
                  ? "Include an inbox in edition settings, then prepare your first Daily Brief."
                  : "Nothing to read here yet. Refresh to check recent mail. Items you set aside stay out of your brief."}
              </p>
              {enabledSources.length === 0 ? (
                <Button
                  onClick={() => {
                    setSettingsOpen(true);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Choose inboxes
                </Button>
              ) : null}
            </div>
          ) : null}
          {urgentItems.length > 0 ? (
            <section
              aria-label="Urgent updates"
              className="mt-7 rounded-lg border border-border bg-muted/30 px-5"
            >
              <h2 className="pt-5 text-body font-medium text-fg">
                Since your edition
              </h2>
              <p className="mt-1 text-caption text-muted-fg">
                Time-sensitive mail, kept separate so your reading order stays
                put.
              </p>
              {urgentItems.map(({ item, mailbox }) =>
                renderBriefItem({ item, mailbox })
              )}
            </section>
          ) : null}
          {mode === "presentation"
            ? groups.map((group) => {
                const entries = rankedItems.filter(
                  ({ item, mailbox }) => `${mailbox.id}:${item.group}` === group
                );
                return (
                  <section aria-label={entries[0]?.item.group} key={group}>
                    {entries.map(({ item, mailbox }) =>
                      renderBriefItem({ item, mailbox })
                    )}
                  </section>
                );
              })
            : rankedItems.map(({ item, mailbox }) =>
                renderBriefItem({ item, mailbox })
              )}
          {enabledSources.map(({ mailbox, query }) =>
            query.data?.edition ? (
              <p
                key={mailbox.id}
                className="mt-5 text-caption leading-relaxed text-muted-fg"
              >
                {mailbox.displayName || mailbox.emailAddress}, generated{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(query.data.edition.generatedAt))}
                {query.data.edition.updatedAt.slice(0, 16) ===
                query.data.edition.generatedAt.slice(0, 16)
                  ? ""
                  : `, updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(query.data.edition.updatedAt))}`}
                .{query.data.stale ? " This edition is out of date." : ""} Mail
                may have changed since this edition. AI can make mistakes. Check
                source mail before acting.
              </p>
            ) : null
          )}
        </div>
      </div>
    </WorkspaceSection>
  );
};
