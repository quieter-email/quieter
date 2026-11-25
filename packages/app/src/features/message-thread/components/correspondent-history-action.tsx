"use client";

import { Cancel01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { authClient } from "@quieter/app/lib/auth";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { getHistoryCorrespondents } from "@quieter/mail/correspondent-history";
import type { MessageListItem } from "@quieter/mail/messages";
import {
  buildThreadListEntries,
  formatMessageDate,
  formatMessageListDate,
  getParsedMessageDate,
  parseSender,
} from "@quieter/mail/thread-list";
import type { ThreadListEntry } from "@quieter/mail/thread-list";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Pill } from "@quieter/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
} from "@quieter/ui/select";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { Surface } from "@quieter/ui/surface";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@quieter/ui/tabs";
import { Text } from "@quieter/ui/text";
import { WorkspaceHeader } from "@quieter/ui/workspace-section";
import { useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useReminderClock } from "../../reminders/reminder-query";
import { ReminderRowTime } from "../../reminders/reminder-row-time";
import { MemoryEditor } from "../../settings/components/personalization-memory-editor";
import { MemoryProvenance } from "../../settings/components/personalization-memory-provenance";
import { useCorrespondentHistory } from "./use-correspondent-history";
import type { HistorySection, MailSource } from "./use-correspondent-history";

type HistoryPage = RouterOutputs["correspondentHistory"]["list"];
type History = ReturnType<typeof useCorrespondentHistory>;
type SelectedHistory = Extract<History["view"], { kind: "selected" }>;

export type CorrespondentHistoryActionProps = {
  mailboxId: string;
  mailboxEmail: string | null;
  threadId: string;
  messages: readonly Pick<
    MessageListItem,
    "threadId" | "from" | "to" | "cc" | "bcc" | "labelIds" | "senderAvatarUrls"
  >[];
  onOpenConversation: Parameters<
    typeof useCorrespondentHistory
  >[0]["onOpenConversation"];
};

type Correspondent = ReturnType<typeof getHistoryCorrespondents>[number] & {
  avatarUrls: MessageListItem["senderAvatarUrls"];
};

const sections = {
  commitments: {
    empty: "No pending commitments with this person.",
    label: "Commitments",
    noun: ["pending commitment", "pending commitments"],
  },
  mail: {
    empty: "No mail with this person in this mailbox.",
    label: "Mail",
    noun: ["recent conversation", "recent conversations"],
  },
  memory: {
    empty: "No private notes about this person.",
    label: "Context",
    noun: ["private note", "private notes"],
  },
} satisfies Record<
  HistorySection,
  { empty: string; label: string; noun: [string, string] }
>;
const sectionOrder = [
  "mail",
  "memory",
  "commitments",
] satisfies HistorySection[];

const todayTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: "short",
});

const formatHistoryDate = (message: MessageListItem) => {
  const date = getParsedMessageDate(message);
  return date?.toDateString() === new Date().toDateString()
    ? `Today, ${todayTimeFormatter.format(date)}`
    : formatMessageListDate(message);
};

const getSourceStatus = (
  source: MailSource | null | undefined,
  state: SelectedHistory["source"]
) => {
  if (!source) {
    return "unavailable";
  }
  if (state.kind === "idle" || state.source.messageId !== source.messageId) {
    return "available";
  }
  return state.kind === "failed" ? "available" : state.kind;
};

const CorrespondentIdentity = ({ person }: { person: Correspondent }) => (
  <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
    <SenderAvatar
      avatarUrlDark={person.avatarUrls?.dark}
      avatarUrlLight={person.avatarUrls?.light}
      fallbackLabel={(person.name ?? person.email).charAt(0).toUpperCase()}
    />
    <span className="min-w-0 flex-1 whitespace-normal">
      {person.name ? (
        <Text as="span" className="block" size="sm" truncate weight="medium">
          {person.name}
        </Text>
      ) : null}
      <Text
        as="span"
        className="block break-all"
        size={person.name ? "caption" : "sm"}
        title={person.email}
        tone={person.name ? "muted" : "default"}
      >
        {person.email}
      </Text>
    </span>
  </span>
);

const MailHistoryRow = ({
  correspondentEmail,
  currentThreadId,
  history,
  mailboxEmail,
  source,
  sourceState,
  thread,
}: {
  correspondentEmail: string;
  currentThreadId: string;
  history: History;
  mailboxEmail: string | undefined;
  source: MailSource | null | undefined;
  sourceState: SelectedHistory["source"];
  thread: ThreadListEntry;
}) => {
  const status = getSourceStatus(source, sourceState);
  const date = getParsedMessageDate(thread.anchorMessage);
  const dateLabel = formatHistoryDate(thread.anchorMessage);
  const [sender] = thread.participants;
  let author: string | undefined;
  if (mailboxEmail !== undefined && sender?.email === mailboxEmail) {
    author = "You";
  } else if (sender?.email !== correspondentEmail) {
    author = sender?.label;
  }
  let trailing: ReactNode = null;
  if (status === "available") {
    trailing =
      thread.threadId === currentThreadId ? (
        <Pill size="xs" tone="neutral">
          This conversation
        </Pill>
      ) : null;
  } else {
    trailing = (
      <Text as="span" className="shrink-0" size="caption" tone="muted">
        {
          {
            opening: "Opening",
            stale: "Refresh needed",
            unavailable: "Source unavailable",
          }[status]
        }
      </Text>
    );
  }
  return (
    <li
      className={mailListRowFrameVariants({
        accent: thread.isImportant ? "yellow" : undefined,
      })}
    >
      {status === "unavailable" ? null : (
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
        aria-busy={status === "opening" || undefined}
        aria-disabled={status === "opening" || undefined}
        aria-label={`Open conversation, ${thread.subject}, ${dateLabel}`}
        className={mailListRowParts.trigger}
        disabled={status === "unavailable" || status === "stale"}
        onClick={() => {
          if (source && status !== "opening") {
            void history.openSource(source, "mail");
          }
        }}
        type="button"
      />
      {/* The header already names the person, so rows lead with the subject. */}
      <div className="flex min-w-0 flex-1 pl-2">
        <MailListRowDetails
          metadata={
            <MailListRowMetadata
              attachmentCount={thread.attachmentCount}
              attachmentNames={thread.attachmentNames}
              messageCount={thread.messageCount}
              title={thread.attachmentNames.join(", ")}
            />
          }
          sender={thread.subject}
          subject={
            <span className="text-caption font-normal text-muted-fg">
              {[author, thread.preview].filter(Boolean).join(": ")}
            </span>
          }
          subjectTrailing={trailing}
          timestamp={
            <time
              dateTime={date?.toISOString()}
              title={formatMessageDate(thread.anchorMessage, "full")}
            >
              {dateLabel}
            </time>
          }
          unread={thread.unreadCount > 0}
        />
      </div>
    </li>
  );
};

const PersonalContextRows = ({
  items,
  history,
}: {
  items: Extract<HistoryPage, { section: "memory" }>["items"];
  history: History;
}) => (
  <ul className="space-y-4 px-4 py-2">
    {items.map((memory) => (
      <li className="flex items-start gap-3" key={memory.id}>
        <div className="min-w-0 flex-1 space-y-1">
          <Text className="wrap-break-word whitespace-pre-wrap" size="sm">
            {memory.content}
          </Text>
          <MemoryProvenance provenance={memory.provenance} />
        </div>
        <Button
          aria-label={`Edit note, ${memory.summary}`}
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
    <ul className="space-y-4 px-4 py-2">
      {items.map(({ reminder, source }) => {
        const status = getSourceStatus(source, sourceState);
        return (
          <li className="space-y-2" key={reminder.id}>
            <div className="flex items-baseline justify-between gap-3">
              <Text className="min-w-0 wrap-break-word" size="sm">
                {reminder.title}
              </Text>
              <div className="shrink-0">
                <ReminderRowTime now={now} reminder={reminder} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                disabled={status !== "available"}
                onClick={() => {
                  if (source) {
                    void history.openSource(source, "commitments");
                  }
                }}
                pending={status === "opening"}
                pendingLabel="Opening"
                size="sm"
                variant="secondary"
              >
                {
                  {
                    available: "Open source",
                    opening: "Opening",
                    stale: "Refresh needed",
                    unavailable: "Source unavailable",
                  }[status]
                }
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
              {reminder.status === "suspended" ? (
                <Pill className="ms-auto" size="xs" tone="neutral">
                  Paused
                </Pill>
              ) : null}
              {reminder.evaluationStatus === "pending" ? (
                <Pill className="ms-auto" size="xs" tone="neutral">
                  Checking reply
                </Pill>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const HistoryLoadingRows = () => (
  <div aria-hidden className="animate-pulse">
    {["first", "second", "third"].map((row) => (
      <div className="flex h-17 flex-col justify-center gap-2 px-4" key={row}>
        <div className="flex items-center justify-between gap-6">
          <div className="h-3 w-1/2 rounded-md bg-muted" />
          <div className="h-3 w-12 rounded-md bg-muted" />
        </div>
        <div className="h-3 w-3/4 rounded-md bg-muted" />
      </div>
    ))}
  </div>
);

const SourceFeedback = ({
  history,
  source,
}: {
  history: History;
  source: SelectedHistory["source"];
}) => {
  if (source.kind === "idle") {
    return null;
  }
  if (source.kind === "opening") {
    return <output className="sr-only">Opening conversation</output>;
  }
  if (source.kind === "failed") {
    return (
      <Surface className="mx-2" padding="snug">
        <Text role="alert" size="sm">
          Could not open this mail. Please try again.
        </Text>
      </Surface>
    );
  }
  return (
    <Surface className="mx-2" padding="snug">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <output className="min-w-0 flex-1 basis-48">
          <Text as="span" size="sm">
            {source.kind === "stale"
              ? "This mail changed. Refresh history before opening it."
              : "This mail is no longer available."}
          </Text>
        </output>
        {source.kind === "stale" ? (
          <Button
            onClick={() => {
              history.refreshSection(source.section);
            }}
            size="sm"
            variant="secondary"
          >
            Refresh history
          </Button>
        ) : null}
      </div>
    </Surface>
  );
};

const HistorySectionContent = ({
  currentThreadId,
  history,
  mailboxEmail,
  view,
  triggerId,
}: {
  currentThreadId: string;
  history: History;
  mailboxEmail: string | undefined;
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
  let rows: ReactNode = null;
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
  } else {
    const sources = new Map(mail.map((item) => [item.message.id, item.source]));
    rows = (
      <ul>
        {buildThreadListEntries(mail.map((item) => item.message)).map(
          (thread) => (
            <MailHistoryRow
              correspondentEmail={view.scope.correspondentEmail}
              currentThreadId={currentThreadId}
              history={history}
              key={thread.threadId}
              mailboxEmail={mailboxEmail}
              source={sources.get(thread.anchorMessage.id)}
              sourceState={view.source}
              thread={thread}
            />
          )
        )}
      </ul>
    );
  }
  const { empty, noun } = sections[view.section];
  let status = `${count} ${count === 1 ? noun[0] : noun[1]}${query.hasNextPage ? " loaded" : ""}`;
  if (query.isPending) {
    status = "Loading history…";
  } else if (query.isFetchingNextPage) {
    status = "Checking more history…";
  } else if (count === 0 && query.isError) {
    status = "History could not be loaded.";
  } else if (count === 0) {
    status = query.hasNextPage
      ? "No matches on this page. You can check more."
      : empty;
  }
  const continuation =
    query.isError || query.hasNextPage ? (
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
    ) : null;
  const blank = count === 0 && !query.isPending;
  return (
    <div
      aria-busy={query.isFetching}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <SourceFeedback history={history} source={view.source} />
      <div
        className={cn({
          "flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center":
            blank,
          "space-y-0.5 px-4": !blank,
        })}
      >
        <Text aria-live="polite" size={blank ? "sm" : "caption"} tone="muted">
          {status}
        </Text>
        {view.section === "memory" && !query.isPending ? (
          <Text size="caption" tone="muted">
            These are your personal notes and may be wrong. They are separate
            from mail sources.
          </Text>
        ) : null}
        {query.isError && (count > 0 || query.isFetchNextPageError) ? (
          <Text role="alert" size="caption" tone="muted">
            Could not load more history. Your earlier results are still here.
          </Text>
        ) : null}
        {blank ? continuation : null}
      </div>
      {blank ? null : (
        <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto pb-2">
          {query.isPending ? <HistoryLoadingRows /> : rows}
          {continuation ? (
            <div className="px-4 py-2">{continuation}</div>
          ) : null}
        </div>
      )}
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
  const initialFocusId = useId();
  const focusAfterSelection = useRef(false);
  const mailboxEmail = props.mailboxEmail?.trim().toLowerCase();
  const messages = props.messages.filter(
    (message) => message.threadId === props.threadId
  );
  const avatars = new Map(
    messages.map((message) => [
      parseSender(message.from).email.toLowerCase(),
      message.senderAvatarUrls,
    ])
  );
  const choices: Correspondent[] = getHistoryCorrespondents(messages)
    .filter((person) => person.email !== mailboxEmail)
    .map((person) => ({ ...person, avatarUrls: avatars.get(person.email) }));
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
  const person = choices.find(
    (choice) => choice.email === selected?.scope.correspondentEmail
  );
  const editingMemory = selected?.editingMemory;
  const hasSelection = selected !== null;
  useLayoutEffect(() => {
    if (hasSelection && focusAfterSelection.current) {
      focusAfterSelection.current = false;
      document
        .querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)
        ?.focus({ preventScroll: true });
    }
  }, [hasSelection, initialFocusId]);
  const title = person
    ? `Contact history for ${person.name ?? person.email}`
    : "Choose a contact";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          history.close();
          return;
        }
        history.open();
        // Without a known mailbox address, the only choice could be the owner.
        if (choices.length === 1 && mailboxEmail) {
          history.selectCorrespondent(choices[0].email);
        }
      }}
      open={view.kind !== "closed"}
    >
      <IconButtonTooltip label="Contact history">
        <DialogTrigger
          aria-label="Contact history"
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
          document.querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)
        }
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Recent mail, personal context and pending commitments.
        </DialogDescription>
        {view.kind === "closed" ? null : (
          <>
            <WorkspaceHeader>
              <div className="flex min-w-0 items-center gap-2">
                {person && choices.length > 1 ? (
                  <Select
                    items={choices.map((choice) => ({
                      label: choice.name
                        ? `${choice.name}, ${choice.email}`
                        : choice.email,
                      value: choice.email,
                    }))}
                    onValueChange={(email) => {
                      if (email !== null) {
                        history.selectCorrespondent(email);
                      }
                    }}
                    value={person.email}
                  >
                    <SelectTrigger
                      aria-label="Switch contact"
                      className="-my-1.5 -ms-2 min-w-0 flex-1"
                      size="auto"
                      variant="ghost"
                    >
                      <CorrespondentIdentity person={person} />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="w-(--anchor-width) max-w-(--available-width)"
                    >
                      <SelectList>
                        {choices.map((choice) => (
                          <SelectItem
                            className="min-w-0 [&>span]:min-w-0"
                            key={choice.email}
                            value={choice.email}
                          >
                            <CorrespondentIdentity person={choice} />
                          </SelectItem>
                        ))}
                      </SelectList>
                    </SelectContent>
                  </Select>
                ) : null}
                {person && choices.length === 1 ? (
                  <CorrespondentIdentity person={person} />
                ) : null}
                {person ? null : (
                  <Text
                    as="span"
                    className="min-w-0 flex-1"
                    size="sm"
                    weight="medium"
                  >
                    Choose a contact
                  </Text>
                )}
                <IconButtonTooltip label="Close">
                  <Button
                    aria-label="Close contact history"
                    chrome="toolbar"
                    onClick={() => {
                      history.close();
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Icon aria-hidden icon={Cancel01Icon} />
                  </Button>
                </IconButtonTooltip>
              </div>
            </WorkspaceHeader>
            {selected ? (
              <Tabs
                className="flex min-h-0 flex-1 flex-col"
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
                  className="mx-2 flex shrink-0"
                  variant="plain"
                >
                  {sectionOrder.map((section) => (
                    <TabsTab
                      className="flex-1"
                      id={section === "mail" ? initialFocusId : undefined}
                      key={section}
                      value={section}
                    >
                      {sections[section].label}
                    </TabsTab>
                  ))}
                </TabsList>
                {sectionOrder.map((section) => (
                  <TabsPanel
                    className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
                    key={section}
                    value={section}
                  >
                    {selected.section === section ? (
                      <HistorySectionContent
                        currentThreadId={props.threadId}
                        history={history}
                        mailboxEmail={mailboxEmail}
                        triggerId={triggerId}
                        view={selected}
                      />
                    ) : null}
                  </TabsPanel>
                ))}
              </Tabs>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <ul className="min-h-0 flex-1 scroll-fade-y overflow-y-auto px-2">
                  {choices.map((choice, index) => (
                    <li key={choice.email}>
                      <Button
                        className="w-full"
                        id={index === 0 ? initialFocusId : undefined}
                        onClick={() => {
                          focusAfterSelection.current = true;
                          history.selectCorrespondent(choice.email);
                        }}
                        size="auto"
                        variant="ghost"
                      >
                        <CorrespondentIdentity person={choice} />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Text className="m-4 mt-2" size="caption" tone="muted">
                  Personal context and reminders stay private to you in shared
                  mailboxes.
                </Text>
              </div>
            )}
          </>
        )}
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
