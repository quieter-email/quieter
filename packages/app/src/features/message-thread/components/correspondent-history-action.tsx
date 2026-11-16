"use client";

import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { authClient } from "@quieter/app/lib/auth";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { getHistoryCorrespondents } from "@quieter/mail/correspondent-history";
import type { MessageListItem } from "@quieter/mail/messages";
import {
  buildThreadListEntries,
  formatMessageListDate,
} from "@quieter/mail/thread-list";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  MailListRowDetails,
  MailListRowMetadata,
  mailListRowFrameVariants,
  mailListRowParts,
} from "@quieter/ui/mail-list-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@quieter/ui/tabs";
import { Text } from "@quieter/ui/text";
import { useId } from "react";
import type { ReactNode } from "react";

import { useReminderClock } from "../../reminders/reminder-query";
import { ReminderRowTime } from "../../reminders/reminder-row-time";
import { MemoryEditor } from "../../settings/components/personalization-memory-editor";
import { MemoryProvenance } from "../../settings/components/personalization-memory-provenance";
import { useCorrespondentHistory } from "./use-correspondent-history";
import type { HistorySection } from "./use-correspondent-history";

type HistoryPage = RouterOutputs["correspondentHistory"]["list"];
type History = ReturnType<typeof useCorrespondentHistory>;
type SelectedHistory = Extract<History["view"], { kind: "selected" }>;

export type CorrespondentHistoryActionProps = {
  mailboxId: string;
  mailboxEmail: string | null;
  threadId: string;
  messages: readonly Pick<
    MessageListItem,
    "threadId" | "from" | "to" | "cc" | "bcc" | "labelIds"
  >[];
  onOpenConversation: Parameters<
    typeof useCorrespondentHistory
  >[0]["onOpenConversation"];
};

const sections = [
  { label: "Mail", value: "mail" },
  { label: "Context", value: "memory" },
  { label: "Commitments", value: "commitments" },
] satisfies { label: string; value: HistorySection }[];

const MailHistoryRows = ({
  items,
  history,
  sourceState,
}: {
  items: Extract<HistoryPage, { section: "mail" }>["items"];
  history: History;
  sourceState: SelectedHistory["source"];
}) => {
  const sources = new Map(items.map((item) => [item.message.id, item.source]));
  const threads = buildThreadListEntries(items.map((item) => item.message));

  return (
    <ul>
      {threads.map((thread) => {
        const source = sources.get(thread.anchorMessage.id);
        const unavailable =
          !source ||
          (sourceState.kind === "unavailable" &&
            sourceState.source.messageId === source.messageId);
        const pending =
          sourceState.kind === "opening" &&
          sourceState.source.messageId === source?.messageId;
        const stale =
          sourceState.kind === "stale" &&
          sourceState.source.messageId === source?.messageId;
        let sourceLabel: string | null = null;
        if (pending) {
          sourceLabel = "Opening";
        } else if (stale) {
          sourceLabel = "Refresh needed";
        } else if (unavailable) {
          sourceLabel = "Source unavailable";
        }
        return (
          <li
            className={mailListRowFrameVariants({
              accent: thread.isImportant ? "yellow" : undefined,
            })}
            key={thread.threadId}
          >
            {unavailable ? null : (
              <span
                aria-hidden
                className={cn(
                  mailListRowParts.overlay,
                  "opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
                )}
              />
            )}
            {thread.unreadCount > 0 ? (
              <span aria-hidden className={mailListRowParts.unreadIndicator} />
            ) : null}
            <button
              aria-busy={pending || undefined}
              aria-label={`Open conversation, ${thread.subject}`}
              className={mailListRowParts.trigger}
              disabled={unavailable || stale || pending}
              onClick={() => {
                if (source) {
                  void history.openSource(source, "mail");
                }
              }}
              type="button"
            />
            <MailListRowDetails
              metadata={
                <MailListRowMetadata
                  attachmentCount={thread.attachmentCount}
                  attachmentNames={thread.attachmentNames}
                  messageCount={thread.messageCount}
                  title={thread.attachmentNames.join(", ")}
                />
              }
              sender={thread.participants
                .map((person) => person.label)
                .join(", ")}
              subject={thread.subject}
              subjectTrailing={
                sourceLabel ? (
                  <Text as="span" size="caption" tone="muted">
                    {sourceLabel}
                  </Text>
                ) : null
              }
              timestamp={formatMessageListDate(thread.anchorMessage)}
              unread={thread.unreadCount > 0}
            />
          </li>
        );
      })}
    </ul>
  );
};

const PersonalContextRows = ({
  items,
  history,
}: {
  items: Extract<HistoryPage, { section: "memory" }>["items"];
  history: History;
}) => (
  <div className="space-y-4">
    <Text size="caption" tone="muted">
      These are your personal notes and may be wrong. They are separate from
      mail sources.
    </Text>
    <ul className="space-y-4">
      {items.map((memory) => (
        <li className="flex items-start gap-3" key={memory.id}>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Text className="break-words whitespace-pre-wrap" size="sm">
              {memory.content}
            </Text>
            <MemoryProvenance provenance={memory.provenance} />
          </div>
          <Button
            onClick={() => {
              history.editMemory(memory);
            }}
            size="sm"
            variant="secondary"
          >
            Edit
          </Button>
        </li>
      ))}
    </ul>
  </div>
);

const CommitmentRows = ({
  items,
  history,
  sourceState,
  triggerId,
}: {
  items: Extract<HistoryPage, { section: "commitments" }>["items"];
  history: History;
  sourceState: SelectedHistory["source"];
  triggerId: string;
}) => {
  const now = useReminderClock(items.map((item) => item.reminder));
  return (
    <ul className="space-y-4">
      {items.map(({ reminder, source }) => {
        const unavailable =
          !source ||
          (sourceState.kind === "unavailable" &&
            sourceState.source.messageId === source.messageId);
        const pending =
          sourceState.kind === "opening" &&
          sourceState.source.messageId === source?.messageId;
        const stale =
          sourceState.kind === "stale" &&
          sourceState.source.messageId === source?.messageId;
        let sourceLabel = "Open source";
        if (unavailable) {
          sourceLabel = "Source unavailable";
        } else if (stale) {
          sourceLabel = "Refresh needed";
        }
        return (
          <li className="space-y-2" key={reminder.id}>
            <div className="space-y-1">
              <Text size="sm">{reminder.title}</Text>
              <div className="flex flex-wrap items-center gap-2">
                <ReminderRowTime now={now} reminder={reminder} />
                {reminder.status === "suspended" ? (
                  <Text as="span" size="caption" tone="muted">
                    Paused
                  </Text>
                ) : null}
                {reminder.evaluationStatus === "pending" ? (
                  <Text as="span" size="caption" tone="muted">
                    Checking reply
                  </Text>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={unavailable || stale || pending}
                onClick={() => {
                  if (source) {
                    void history.openSource(source, "commitments");
                  }
                }}
                pending={pending}
                pendingLabel="Opening"
                size="sm"
                variant="secondary"
              >
                {sourceLabel}
              </Button>
              {history.canOpenReminder ? (
                <Button
                  onClick={() => {
                    const trigger = document.querySelector(
                      `#${CSS.escape(triggerId)}`
                    );
                    void history.openReminder(
                      reminder.id,
                      trigger instanceof HTMLButtonElement ? trigger : undefined
                    );
                  }}
                  size="sm"
                  variant="ghost"
                >
                  View reminder
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const HistorySectionContent = ({
  history,
  view,
  triggerId,
}: {
  history: History;
  view: SelectedHistory;
  triggerId: string;
}) => {
  const query = history.queries[view.section];
  const pages = query.data?.pages ?? [];
  const mail = [
    ...new Map(
      pages
        .flatMap((page) => (page.section === "mail" ? page.items : []))
        .map((item) => [item.message.threadId, item])
    ).values(),
  ];
  const memories = [
    ...new Map(
      pages
        .flatMap((page) => (page.section === "memory" ? page.items : []))
        .map((item) => [item.id, item])
    ).values(),
  ];
  const commitments = [
    ...new Map(
      pages
        .flatMap((page) => (page.section === "commitments" ? page.items : []))
        .map((item) => [item.reminder.id, item])
    ).values(),
  ];
  let count = mail.length;
  let rows: ReactNode = (
    <MailHistoryRows history={history} items={mail} sourceState={view.source} />
  );
  if (view.section === "memory") {
    count = memories.length;
    rows = <PersonalContextRows history={history} items={memories} />;
  } else if (view.section === "commitments") {
    count = commitments.length;
    rows = (
      <CommitmentRows
        history={history}
        items={commitments}
        sourceState={view.source}
        triggerId={triggerId}
      />
    );
  }
  let status = `${count} ${count === 1 ? "item" : "items"}`;
  if (query.isPending) {
    status = "Loading history…";
  } else if (query.isFetchingNextPage) {
    status = "Checking more history…";
  } else if (query.isError && count === 0) {
    status = "History could not be loaded.";
  } else if (count === 0 && query.isSuccess) {
    status = query.hasNextPage
      ? "No matches on this page. You can check more."
      : "No history found in this section.";
  }
  let sourceFeedback: ReactNode = null;
  if (view.source.kind === "stale") {
    sourceFeedback = (
      <div className="flex flex-wrap items-center gap-2">
        <Text size="sm" tone="muted">
          This mail changed. Refresh history before opening it.
        </Text>
        <Button
          onClick={() => {
            if (view.source.kind === "stale") {
              history.refreshSection(view.source.section);
            }
          }}
          size="sm"
          variant="secondary"
        >
          Refresh history
        </Button>
      </div>
    );
  } else if (view.source.kind === "unavailable") {
    sourceFeedback = (
      <output className="block">
        <Text as="span" size="sm" tone="muted">
          This mail is no longer available.
        </Text>
      </output>
    );
  } else if (view.source.kind === "failed") {
    sourceFeedback = (
      <Text role="alert" size="sm" tone="muted">
        Could not open this mail. Please try again.
      </Text>
    );
  }
  return (
    <div aria-busy={query.isFetching} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text aria-live="polite" size="caption" tone="muted">
          {status}
        </Text>
        {query.isError || query.hasNextPage ? (
          <Button
            disabled={query.isFetching}
            onClick={() => {
              if (query.isError && !query.isFetchNextPageError) {
                history.retrySection(view.section);
              } else {
                history.loadMore(view.section);
              }
            }}
            pending={query.isFetchingNextPage}
            pendingLabel="Loading"
            size="sm"
            variant="secondary"
          >
            {query.isError ? "Try again" : "Load more"}
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <Text role="alert" size="sm" tone="muted">
          {query.isFetchNextPageError
            ? "Could not load more history. Your earlier results are still here."
            : "Could not load this section. Please try again."}
        </Text>
      ) : null}
      {sourceFeedback}
      {rows}
    </div>
  );
};

const CorrespondentHistoryOwner = ({
  actorId,
  sessionId,
  ...props
}: CorrespondentHistoryActionProps & {
  actorId: string;
  sessionId: string;
}) => {
  const triggerId = useId();
  const selectorId = useId();
  const choices = getHistoryCorrespondents(
    props.messages.filter((message) => message.threadId === props.threadId)
  ).filter(
    (person) => person.email !== props.mailboxEmail?.trim().toLowerCase()
  );
  const history = useCorrespondentHistory({
    actorId,
    correspondentEmails: choices.map((person) => person.email),
    mailboxId: props.mailboxId,
    onOpenConversation: props.onOpenConversation,
    sessionId,
    threadId: props.threadId,
  });
  const { view } = history;
  const selected = view.kind === "selected" ? view : null;
  const editingMemory = selected?.editingMemory;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          history.open();
        } else {
          history.close();
        }
      }}
      open={view.kind !== "closed"}
    >
      <IconButtonTooltip label="Correspondent history">
        <DialogTrigger
          aria-label="Correspondent history"
          disabled={history.sessionEnded || choices.length === 0}
          id={triggerId}
          render={<Button chrome="toolbar" size="icon-sm" variant="ghost" />}
        >
          <Icon aria-hidden icon={UserGroupIcon} />
        </DialogTrigger>
      </IconButtonTooltip>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col"
        finalFocus={() =>
          history.consumeFocusHandoff()
            ? false
            : document.querySelector<HTMLElement>(`#${CSS.escape(triggerId)}`)
        }
        initialFocus={() =>
          document.querySelector<HTMLElement>(`#${CSS.escape(selectorId)}`)
        }
      >
        <DialogHeader>
          <DialogTitle>Correspondent history</DialogTitle>
          <DialogDescription>
            Recent mail, personal context and pending commitments.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
          {view.kind === "closed" ? null : (
            <>
              <Select
                items={choices.map((person) => ({
                  label: person.name
                    ? `${person.name}, ${person.email}`
                    : person.email,
                  value: person.email,
                }))}
                onValueChange={(email) => {
                  if (email !== null) {
                    history.selectCorrespondent(email);
                  }
                }}
                value={selected?.scope.correspondentEmail ?? null}
              >
                <SelectTrigger
                  aria-label="Correspondent"
                  id={selectorId}
                  size="sm"
                >
                  <SelectValue placeholder="Choose a person" />
                </SelectTrigger>
                <SelectContent
                  className="w-(--anchor-width) max-w-(--available-width)"
                  size="compact"
                >
                  <SelectList>
                    {choices.map((person) => (
                      <SelectItem
                        className="min-w-0 [&>span]:min-w-0"
                        key={person.email}
                        value={person.email}
                      >
                        <div className="min-w-0">
                          {person.name ? (
                            <Text
                              as="span"
                              className="block"
                              size="sm"
                              truncate
                            >
                              {person.name}
                            </Text>
                          ) : null}
                          <Text
                            as="span"
                            className="block"
                            size="caption"
                            truncate
                          >
                            {person.email}
                          </Text>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
              {selected ? (
                <>
                  <Text className="break-all" size="caption" tone="muted">
                    {selected.scope.correspondentEmail}
                  </Text>
                  <Tabs
                    onValueChange={(section: unknown) => {
                      if (
                        section === "mail" ||
                        section === "memory" ||
                        section === "commitments"
                      ) {
                        history.selectSection(section);
                      }
                    }}
                    value={selected.section}
                  >
                    <TabsList
                      activateOnFocus={false}
                      aria-label="History section"
                      variant="plain"
                    >
                      {sections.map((section) => (
                        <TabsTab key={section.value} value={section.value}>
                          {section.label}
                        </TabsTab>
                      ))}
                    </TabsList>
                    {sections.map((section) => (
                      <TabsPanel key={section.value} value={section.value}>
                        {selected.section === section.value ? (
                          <HistorySectionContent
                            history={history}
                            triggerId={triggerId}
                            view={selected}
                          />
                        ) : null}
                      </TabsPanel>
                    ))}
                  </Tabs>
                </>
              ) : (
                <Text size="sm" tone="muted">
                  Choose an exact address to load its history. Personal context
                  and reminders stay private to you in shared mailboxes.
                </Text>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton variant="default">Done</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
      {selected && editingMemory ? (
        <MemoryEditor
          key={`${selected.scope.instanceId}:${editingMemory.id}:${editingMemory.version}`}
          memory={editingMemory}
          onClose={() => {
            history.closeEditor(selected.scope, editingMemory.id);
          }}
          onSaved={() => {
            history.memorySaved(selected.scope, editingMemory.id);
          }}
        />
      ) : null}
    </Dialog>
  );
};

export const CorrespondentHistoryAction = (
  props: CorrespondentHistoryActionProps
) => {
  const session = authClient.useSession();
  const actorId = session.data?.user.id;
  const sessionId = session.data?.session.id;
  if (!actorId || !sessionId || isSandboxMailboxId(props.mailboxId)) {
    return null;
  }
  return (
    <CorrespondentHistoryOwner
      {...props}
      actorId={actorId}
      key={JSON.stringify([
        actorId,
        sessionId,
        props.mailboxId,
        props.threadId,
      ])}
      sessionId={sessionId}
    />
  );
};
